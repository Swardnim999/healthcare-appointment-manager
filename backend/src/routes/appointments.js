import { Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../utils/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { generatePreVisitSummary, generatePostVisitSummary, normalizeUrgency } from "../services/llm.js";
import { sendEmail } from "../services/email.js";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "../services/calendar.js";
import { isValidDoctorSlotTime } from "./doctors.js";

const router = Router();
const HOLD_TTL_MS = (Number(process.env.SLOT_HOLD_TTL_SECONDS) || 300) * 1000;

/**
 * STEP 1 — HOLD a slot.
 *
 * Double-booking prevention strategy:
 *  - `slotStart` + `doctorId` has a DB-level UNIQUE constraint (see schema).
 *  - We attempt to INSERT a row with status=HELD. If two patients race for
 *    the same slot, the database itself rejects the second INSERT with a
 *    unique-constraint violation (P2002) — this is atomic and correct even
 *    under concurrent requests, unlike a "check-then-insert" pattern which
 *    has a race window.
 *  - The HELD row expires after SLOT_HOLD_TTL_SECONDS (default 5 min) via
 *    `holdExpiresAt`. Expired holds are treated as free by the slots query
 *    and get overwritten/cleaned up lazily (see /confirm and the sweep in
 *    doctors.js's availability query, which filters out expired holds).
 *  - This models a real "shopping cart hold" pattern: hold slot -> fill
 *    symptom form -> confirm within the TTL, or the slot is released.
 */
router.post("/hold", requireAuth, requireRole("PATIENT"), async (req, res) => {
  const { doctorId, slotStart } = req.body;
  if (!doctorId || !slotStart) return res.status(400).json({ error: "doctorId and slotStart required" });

  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) return res.status(404).json({ error: "Doctor not found" });

  const start = new Date(slotStart);
  const end = new Date(start.getTime() + doctor.slotDurationMin * 60 * 1000);

  // Check if doctor is on leave on this date
  const isoDate = start.toISOString().slice(0, 10);
  const localDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  const onLeave = await prisma.doctorLeave.findFirst({
    where: {
      doctorId,
      OR: [{ date: isoDate }, { date: localDate }],
    },
  });
  if (onLeave) {
    return res.status(409).json({ error: "Doctor is on leave on this date" });
  }

  try {
    const held = await prisma.$transaction(async (tx) => {
      // Clean up this exact slot if it is stale (an expired hold or previously cancelled appointment),
      // releasing the unique constraint on (doctorId, slotStart) so it can be re-held/booked.
      const stale = await tx.appointment.findMany({
        where: {
          doctorId,
          slotStart: start,
          OR: [
            { status: "HELD", holdExpiresAt: { lt: new Date() } },
            { status: { in: ["CANCELLED", "CANCELLED_BY_LEAVE"] } },
          ],
        },
        select: { id: true },
      });

      if (stale.length > 0) {
        const staleIds = stale.map((s) => s.id);
        await tx.emailLog.updateMany({
          where: { appointmentId: { in: staleIds } },
          data: { appointmentId: null },
        });
        await tx.medicationReminder.deleteMany({
          where: { appointmentId: { in: staleIds } },
        });
        await tx.appointment.deleteMany({
          where: { id: { in: staleIds } },
        });
      }

      return tx.appointment.create({
        data: {
          doctorId,
          patientId: req.user.id,
          slotStart: start,
          slotEnd: end,
          status: "HELD",
          holdExpiresAt: new Date(Date.now() + HOLD_TTL_MS),
        },
      });
    });

    res.status(201).json({ appointmentId: held.id, holdExpiresAt: held.holdExpiresAt });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "This slot was just taken by another patient. Please pick another slot." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to hold slot" });
  }
});

/**
 * STEP 2 — CONFIRM booking with symptom form. Generates the AI pre-visit
 * summary (never blocks booking if the LLM call fails), sends confirmation
 * emails to patient + doctor, and creates calendar events for both.
 */
router.post("/:id/confirm", requireAuth, requireRole("PATIENT"), async (req, res) => {
  const { id } = req.params;
  const { symptomText } = req.body;

  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: { doctor: { include: { user: true } }, patient: true },
  });
  if (!appt || appt.patientId !== req.user.id) return res.status(404).json({ error: "Appointment not found" });
  if (appt.status !== "HELD") return res.status(400).json({ error: "Appointment is not in a holdable state" });
  if (appt.holdExpiresAt && appt.holdExpiresAt < new Date()) {
    await prisma.appointment.delete({ where: { id } });
    return res.status(410).json({ error: "Your slot hold expired. Please select a slot again." });
  }

  // Re-check doctor leave before confirming
  const apptIsoDate = appt.slotStart.toISOString().slice(0, 10);
  const apptLocalDate = `${appt.slotStart.getFullYear()}-${String(appt.slotStart.getMonth() + 1).padStart(2, "0")}-${String(appt.slotStart.getDate()).padStart(2, "0")}`;
  const doctorOnLeave = await prisma.doctorLeave.findFirst({
    where: {
      doctorId: appt.doctorId,
      OR: [{ date: apptIsoDate }, { date: apptLocalDate }],
    },
  });
  if (doctorOnLeave) {
    await prisma.appointment.update({
      where: { id },
      data: { status: "CANCELLED_BY_LEAVE", holdExpiresAt: null },
    });
    return res.status(409).json({ error: "Doctor is on leave on this date. Please select another slot." });
  }

  // LLM call — wrapped so failures never break the booking.
  const aiSummary = await generatePreVisitSummary(symptomText || "No symptoms provided");

  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      status: "BOOKED",
      symptomText,
      preVisitSummary: JSON.stringify(aiSummary),
      urgency: normalizeUrgency(aiSummary.urgency),
      holdExpiresAt: null,
    },
  });

  // Fire-and-forget-ish side effects (awaited, but individually try/caught
  // inside each service so one failing doesn't block the others).
  const when = appt.slotStart.toLocaleString();
  await sendEmail({
    to: appt.patient.email,
    subject: "Appointment Confirmed",
    text: `Your appointment with Dr. ${appt.doctor.user.name} is confirmed for ${when}.`,
    type: "BOOKING_CONFIRMATION",
    appointmentId: id,
  });
  await sendEmail({
    to: appt.doctor.user.email,
    subject: "New Appointment Booked",
    text: `New appointment with ${appt.patient.name} on ${when}. Urgency: ${aiSummary.urgency}. Chief complaint: ${aiSummary.chiefComplaint}`,
    type: "BOOKING_CONFIRMATION",
    appointmentId: id,
  });

  const patientEventId = await createCalendarEvent(appt.patientId, {
    summary: `Appointment with Dr. ${appt.doctor.user.name}`,
    description: `Clinic visit. Chief complaint: ${aiSummary.chiefComplaint || "N/A"}`,
    start: appt.slotStart,
    end: appt.slotEnd,
  });
  const doctorEventId = await createCalendarEvent(appt.doctor.userId, {
    summary: `Patient: ${appt.patient.name}`,
    description: `Urgency: ${aiSummary.urgency}. ${aiSummary.chiefComplaint || ""}`,
    start: appt.slotStart,
    end: appt.slotEnd,
  });

  await prisma.appointment.update({
    where: { id },
    data: { patientCalendarEventId: patientEventId, doctorCalendarEventId: doctorEventId },
  });

  res.json({ ...updated, preVisitSummary: aiSummary });
});

// Doctor's upcoming appointments with pre-visit AI summary
router.get("/doctor/mine", requireAuth, requireRole("DOCTOR"), async (req, res) => {
  const doctorProfile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } });
  if (!doctorProfile) return res.status(404).json({ error: "Doctor profile not found" });

  const appts = await prisma.appointment.findMany({
    where: { doctorId: doctorProfile.id, status: { in: ["BOOKED", "COMPLETED"] } },
    include: { patient: { select: { name: true, email: true } } },
    orderBy: { slotStart: "asc" },
  });
  res.json(appts.map((a) => ({ ...a, preVisitSummary: safeParse(a.preVisitSummary) })));
});

// Patient's own appointments
router.get("/patient/mine", requireAuth, requireRole("PATIENT"), async (req, res) => {
  const appts = await prisma.appointment.findMany({
    where: { patientId: req.user.id, status: { in: ["BOOKED", "COMPLETED"] } },
    include: { doctor: { include: { user: { select: { name: true } } } } },
    orderBy: { slotStart: "asc" },
  });
  res.json(appts.map((a) => ({ ...a, postVisitSummary: safeParse(a.postVisitSummary) })));
});

/**
 * Doctor submits post-visit notes + prescription -> LLM generates a
 * patient-friendly summary -> medication reminders are scheduled based on
 * prescription frequency.
 */
router.post("/:id/complete", requireAuth, requireRole("DOCTOR"), async (req, res) => {
  const { id } = req.params;
  const { clinicalNotes, prescription } = req.body; // prescription: [{drug, dose, frequency, days}]

  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: { doctor: true, patient: true },
  });
  if (!appt) return res.status(404).json({ error: "Appointment not found" });
  const doctorProfile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } });
  if (!doctorProfile || appt.doctorId !== doctorProfile.id) return res.status(403).json({ error: "Not your appointment" });

  const aiSummary = await generatePostVisitSummary(clinicalNotes, prescription);

  await prisma.appointment.update({
    where: { id },
    data: {
      status: "COMPLETED",
      clinicalNotes,
      prescription: JSON.stringify(prescription || []),
      postVisitSummary: JSON.stringify(aiSummary),
    },
  });

  // Schedule medication reminders distributed reasonably across waking hours (08:00 -> 22:00)
  const reminders = [];
  for (const med of prescription || []) {
    const timesPerDay = parseFrequencyToTimesPerDay(med.frequency);
    const doseHours = calculateDailyDoseHours(timesPerDay);
    const days = Number(med.days) || 1;
    for (let d = 0; d < days; d++) {
      for (const hour of doseHours) {
        const scheduledAt = new Date();
        scheduledAt.setDate(scheduledAt.getDate() + d);
        scheduledAt.setHours(hour, 0, 0, 0);
        reminders.push({
          appointmentId: id,
          drugName: med.drug,
          dose: med.dose,
          scheduledAt,
        });
      }
    }
  }
  if (reminders.length) {
    await prisma.medicationReminder.createMany({ data: reminders });
  }

  await sendEmail({
    to: appt.patient.email,
    subject: "Your Visit Summary Is Ready",
    text: `Your visit summary: ${aiSummary.summary}`,
    type: "BOOKING_CONFIRMATION",
    appointmentId: id,
  });

  res.json({ postVisitSummary: aiSummary, reminderCount: reminders.length });
});

// Cancel / reschedule
router.post("/:id/cancel", requireAuth, async (req, res) => {
  const { id } = req.params;
  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: { doctor: { include: { user: true } }, patient: true },
  });
  if (!appt) return res.status(404).json({ error: "Appointment not found" });

  const isOwnerPatient = req.user.role === "PATIENT" && appt.patientId === req.user.id;
  const doctorProfile = req.user.role === "DOCTOR" ? await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } }) : null;
  const isOwnerDoctor = doctorProfile && appt.doctorId === doctorProfile.id;
  if (!isOwnerPatient && !isOwnerDoctor && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Not authorized to cancel this appointment" });
  }

  await prisma.appointment.update({ where: { id }, data: { status: "CANCELLED" } });

  await deleteCalendarEvent(appt.patientId, appt.patientCalendarEventId);
  await deleteCalendarEvent(appt.doctor.userId, appt.doctorCalendarEventId);

  await sendEmail({
    to: appt.patient.email,
    subject: "Appointment Cancelled",
    text: `Your appointment on ${appt.slotStart.toLocaleString()} has been cancelled.`,
    type: "CANCELLATION",
    appointmentId: id,
  });
  await sendEmail({
    to: appt.doctor.user.email,
    subject: "Appointment Cancelled",
    text: `Appointment with ${appt.patient.name} on ${appt.slotStart.toLocaleString()} has been cancelled.`,
    type: "CANCELLATION",
    appointmentId: id,
  });

  res.json({ status: "CANCELLED" });
});

// Reschedule appointment
router.post("/:id/reschedule", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { newSlotStart, newDoctorId } = req.body;

  if (!newSlotStart) {
    return res.status(400).json({ error: "newSlotStart is required" });
  }

  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: { doctor: { include: { user: true } }, patient: true },
  });
  if (!appt) return res.status(404).json({ error: "Appointment not found" });

  // Authorization check
  const isOwnerPatient = req.user.role === "PATIENT" && appt.patientId === req.user.id;
  const doctorProfile = req.user.role === "DOCTOR" ? await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } }) : null;
  const isOwnerDoctor = doctorProfile && appt.doctorId === doctorProfile.id;
  if (!isOwnerPatient && !isOwnerDoctor && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Not authorized to reschedule this appointment" });
  }

  // Reschedulable state check: only BOOKED appointments can be rescheduled
  if (appt.status !== "BOOKED") {
    return res.status(400).json({ error: `Appointment in '${appt.status}' status cannot be rescheduled` });
  }

  const targetDoctorId = newDoctorId || appt.doctorId;
  const targetDoctor = targetDoctorId === appt.doctorId
    ? appt.doctor
    : await prisma.doctorProfile.findUnique({ where: { id: targetDoctorId }, include: { user: true } });
  if (!targetDoctor) return res.status(404).json({ error: "Target doctor not found" });

  const newStart = new Date(newSlotStart);
  if (isNaN(newStart.getTime())) {
    return res.status(400).json({ error: "Invalid newSlotStart date" });
  }

  // Validate that the slot matches doctor's working schedule and slot duration
  if (!isValidDoctorSlotTime(targetDoctor, newStart)) {
    return res.status(400).json({ error: "The selected time is not a valid appointment slot for this doctor" });
  }

  const newEnd = new Date(newStart.getTime() + targetDoctor.slotDurationMin * 60 * 1000);

  // Check doctor leave on the new date
  const isoDate = newStart.toISOString().slice(0, 10);
  const localDate = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`;
  const onLeave = await prisma.doctorLeave.findFirst({
    where: {
      doctorId: targetDoctorId,
      OR: [{ date: isoDate }, { date: localDate }],
    },
  });
  if (onLeave) {
    return res.status(409).json({ error: "Doctor is on leave on the selected date" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // 1. Clean up stale records (expired holds, cancelled) at the target slot if any
      const stale = await tx.appointment.findMany({
        where: {
          doctorId: targetDoctorId,
          slotStart: newStart,
          id: { not: appt.id },
          OR: [
            { status: "HELD", holdExpiresAt: { lt: new Date() } },
            { status: { in: ["CANCELLED", "CANCELLED_BY_LEAVE"] } },
          ],
        },
        select: { id: true },
      });

      if (stale.length > 0) {
        const staleIds = stale.map((s) => s.id);
        await tx.emailLog.updateMany({
          where: { appointmentId: { in: staleIds } },
          data: { appointmentId: null },
        });
        await tx.medicationReminder.deleteMany({
          where: { appointmentId: { in: staleIds } },
        });
        await tx.appointment.deleteMany({
          where: { id: { in: staleIds } },
        });
      }

      // 2. Check for active conflicts at target slot
      const conflicting = await tx.appointment.findFirst({
        where: {
          doctorId: targetDoctorId,
          slotStart: newStart,
          id: { not: appt.id },
          OR: [
            { status: { in: ["BOOKED", "COMPLETED"] } },
            { status: "HELD", holdExpiresAt: { gt: new Date() } },
          ],
        },
      });
      if (conflicting) {
        throw new Error("SLOT_CONFLICT");
      }

      // 3. Atomically update the appointment to the new slot
      return tx.appointment.update({
        where: { id: appt.id },
        data: {
          doctorId: targetDoctorId,
          slotStart: newStart,
          slotEnd: newEnd,
        },
      });
    });

    // Side-effects outside transaction: Google Calendar & Email failures must NOT roll back DB or return 500
    try {
      await updateCalendarEvent(appt.patientId, appt.patientCalendarEventId, {
        summary: `Appointment with Dr. ${targetDoctor.user.name}`,
        start: newStart,
        end: newEnd,
      });
      await updateCalendarEvent(targetDoctor.userId, appt.doctorCalendarEventId, {
        summary: `Patient: ${appt.patient.name}`,
        start: newStart,
        end: newEnd,
      });
    } catch (calErr) {
      console.error("[reschedule] Google Calendar update failed (non-blocking):", calErr.message);
    }

    try {
      const when = newStart.toLocaleString();
      await sendEmail({
        to: appt.patient.email,
        subject: "Appointment Rescheduled",
        text: `Your appointment with Dr. ${targetDoctor.user.name} has been rescheduled to ${when}.`,
        type: "BOOKING_CONFIRMATION",
        appointmentId: appt.id,
      });
      await sendEmail({
        to: targetDoctor.user.email,
        subject: "Appointment Rescheduled",
        text: `Appointment with ${appt.patient.name} has been rescheduled to ${when}.`,
        type: "BOOKING_CONFIRMATION",
        appointmentId: appt.id,
      });
    } catch (emailErr) {
      console.error("[reschedule] Reschedule email notification failed (non-blocking):", emailErr.message);
    }

    return res.json(updated);
  } catch (err) {
    if (err.message === "SLOT_CONFLICT" || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
      return res.status(409).json({ error: "The selected slot is already taken. Please choose another slot." });
    }
    console.error("[reschedule error]", err);
    return res.status(500).json({ error: "Failed to reschedule appointment" });
  }
});

function safeParse(json) {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export function parseFrequencyToTimesPerDay(freq = "") {
  if (typeof freq !== "string") return 1;
  const f = freq.toLowerCase().trim();
  if (f.includes("four") || f.includes("4 times") || f.includes("4x") || f.includes("qid")) return 4;
  if (f.includes("three") || f.includes("thrice") || f.includes("3 times") || f.includes("3x") || f.includes("tid")) return 3;
  if (f.includes("twice") || f.includes("2 times") || f.includes("2x") || f.includes("bid")) return 2;
  if (f.includes("once") || f.includes("1 time") || f.includes("1x") || f.includes("qd") || f.includes("daily")) return 1;

  const everyHoursMatch = f.match(/every\s+(\d+)\s*hours?/);
  if (everyHoursMatch) {
    const hours = Number(everyHoursMatch[1]);
    if (hours > 0) return Math.max(1, Math.min(24, Math.floor(24 / hours)));
  }
  const timesMatch = f.match(/(\d+)\s*(?:times|x)\s*(?:a|per|\/)?\s*day/);
  if (timesMatch) {
    return Math.max(1, Math.min(24, Number(timesMatch[1])));
  }
  return 1;
}

export function calculateDailyDoseHours(timesPerDay) {
  switch (timesPerDay) {
    case 1:
      return [9]; // 09:00 morning dose
    case 2:
      return [8, 20]; // 08:00, 20:00 (12h interval, awake)
    case 3:
      return [8, 14, 20]; // 08:00, 14:00, 20:00 (6h interval, awake)
    case 4:
      return [8, 12, 16, 20]; // 08:00, 12:00, 16:00, 20:00 (4h interval, awake)
    default: {
      if (timesPerDay <= 0) return [9];
      const startHour = 8;
      const endHour = 22;
      const step = (endHour - startHour) / (timesPerDay - 1);
      const hours = [];
      for (let i = 0; i < timesPerDay; i++) {
        hours.push(Math.round(startHour + i * step));
      }
      return hours;
    }
  }
}

export default router;
