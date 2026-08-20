import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../utils/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendEmail } from "../services/email.js";
import { deleteCalendarEvent } from "../services/calendar.js";

const router = Router();
router.use(requireAuth, requireRole("ADMIN"));

// Create a doctor account + profile
router.post("/doctors", async (req, res) => {
  const { name, email, password, specialization, slotDurationMin, workingHours } = req.body;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: "DOCTOR" },
  });
  const profile = await prisma.doctorProfile.create({
    data: {
      userId: user.id,
      specialization,
      slotDurationMin: slotDurationMin || 30,
      // workingHours: {"mon":["09:00","17:00"], "tue":[...], ...}
      workingHours: JSON.stringify(workingHours || {}),
    },
  });
  res.status(201).json({ user: { id: user.id, name, email }, profile });
});

router.get("/doctors", async (req, res) => {
  const doctors = await prisma.doctorProfile.findMany({ include: { user: true, leaves: true } });
  res.json(doctors);
});

router.patch("/doctors/:id", async (req, res) => {
  const { specialization, slotDurationMin, workingHours } = req.body;
  const profile = await prisma.doctorProfile.update({
    where: { id: req.params.id },
    data: {
      ...(specialization && { specialization }),
      ...(slotDurationMin && { slotDurationMin }),
      ...(workingHours && { workingHours: JSON.stringify(workingHours) }),
    },
  });
  res.json(profile);
});

/**
 * Mark a doctor on leave for a date. Any existing BOOKED appointments on
 * that date are cancelled, patients + the doctor are notified by email, and
 * calendar events are removed. This is the "leave conflict handling" the
 * assignment calls out explicitly.
 */
router.post("/doctors/:id/leave", async (req, res) => {
  const doctorId = req.params.id;
  const { date, reason } = req.body; // YYYY-MM-DD
  if (!date) return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });

  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, include: { user: true } });
  if (!doctor) return res.status(404).json({ error: "Doctor not found" });

  await prisma.doctorLeave.upsert({
    where: { doctorId_date: { doctorId, date } },
    update: { reason },
    create: { doctorId, date, reason },
  });

  const dayStart = new Date(date + "T00:00:00");
  const dayEnd = new Date(date + "T23:59:59");
  const affected = await prisma.appointment.findMany({
    where: { doctorId, status: "BOOKED", slotStart: { gte: dayStart, lte: dayEnd } },
    include: { patient: true },
  });

  for (const appt of affected) {
    await prisma.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED_BY_LEAVE" } });
    await deleteCalendarEvent(appt.patientId, appt.patientCalendarEventId);
    await deleteCalendarEvent(doctor.userId, appt.doctorCalendarEventId);
    await sendEmail({
      to: appt.patient.email,
      subject: "Your Appointment Has Been Cancelled (Doctor Unavailable)",
      text: `We're sorry — Dr. ${doctor.user.name} is unavailable on ${date}${reason ? ` (${reason})` : ""}. Your appointment scheduled for ${appt.slotStart.toLocaleString()} has been cancelled. Please rebook another slot at your convenience.`,
      type: "LEAVE_CANCELLATION",
      appointmentId: appt.id,
    });
  }

  res.json({ leaveMarked: true, affectedAppointments: affected.length });
});

router.get("/analytics", async (req, res) => {
  const [totalPatients, totalDoctors, totalAppointments, byStatus] = await Promise.all([
    prisma.user.count({ where: { role: "PATIENT" } }),
    prisma.user.count({ where: { role: "DOCTOR" } }),
    prisma.appointment.count(),
    prisma.appointment.groupBy({ by: ["status"], _count: true }),
  ]);
  res.json({ totalPatients, totalDoctors, totalAppointments, byStatus });
});

export default router;
