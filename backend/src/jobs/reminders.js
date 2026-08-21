import cron from "node-cron";
import prisma from "../utils/db.js";
import { sendEmail, retryFailedEmails, getTransporter } from "../services/email.js";

/**
 * Every 5 minutes: send any due, unsent medication reminders, 24-hour appointment
 * reminders, and retry any emails that previously failed.
 */
export function startBackgroundJobs() {
  cron.schedule("*/5 * * * *", async () => {
    await sendDueMedicationReminders();
    await sendDueAppointmentReminders();
    await retryFailedEmails();
  });
  console.log("[jobs] background jobs scheduled (every 5 min)");
}

export async function sendDueMedicationReminders() {
  const due = await prisma.medicationReminder.findMany({
    where: { sent: false, scheduledAt: { lte: new Date() } },
    include: { appointment: { include: { patient: true } } },
  });

  for (const reminder of due) {
    if (!reminder.appointment?.patient?.email) continue;

    // Atomically claim this reminder to ensure idempotency under concurrent/repeated executions
    const claimed = await prisma.medicationReminder.updateMany({
      where: { id: reminder.id, sent: false },
      data: { sent: true },
    });

    if (claimed.count === 0) {
      // Already claimed or processed by another execution
      continue;
    }

    await sendEmail({
      to: reminder.appointment.patient.email,
      subject: "Medication Reminder",
      text: `Reminder: take ${reminder.drugName} (${reminder.dose}) now.`,
      type: "REMINDER",
      appointmentId: reminder.appointmentId,
    });
  }
}

/**
 * Sends 24-hour advance email reminders for upcoming BOOKED appointments.
 * Targets a narrow ~24h window (23h55m to 24h05m) appropriate for a 5-minute cron.
 * Ensures DB-level uniqueness via EmailLog.idempotencyKey unique constraint.
 * Skips past, cancelled, and completed appointments.
 */
export async function sendDueAppointmentReminders() {
  const now = Date.now();
  // Narrow window around the 24-hour mark (23h 55m to 24h 05m from now)
  const minSlotStart = new Date(now + (23 * 60 + 55) * 60 * 1000);
  const maxSlotStart = new Date(now + (24 * 60 + 5) * 60 * 1000);

  const upcoming = await prisma.appointment.findMany({
    where: {
      status: "BOOKED",
      slotStart: {
        gte: minSlotStart,
        lte: maxSlotStart,
      },
    },
    include: {
      patient: true,
      doctor: { include: { user: true } },
    },
  });

  const t = getTransporter();

  for (const appt of upcoming) {
    if (!appt.patient?.email) continue;

    let claimedLog = null;
    const when = appt.slotStart.toLocaleString();
    const subject = "Upcoming Appointment Reminder (24 Hours)";
    const text = `Reminder: You have an upcoming appointment with Dr. ${appt.doctor.user.name} on ${when}. Please arrive 10 minutes early.`;

    try {
      claimedLog = await prisma.emailLog.create({
        data: {
          toEmail: appt.patient.email,
          subject,
          body: text,
          type: "APPOINTMENT_REMINDER",
          status: "RETRYING",
          attempts: 1,
          idempotencyKey: `APPOINTMENT_REMINDER:${appt.id}`,
          appointmentId: appt.id,
        },
      });
    } catch (err) {
      if (err.code === "P2002") {
        // Unique constraint violation: already created for this appointment
        continue;
      }
      console.error("[reminders] Failed to reserve appointment reminder log:", err.message);
      continue;
    }

    if (!claimedLog) continue;

    try {
      await t.sendMail({
        from: process.env.EMAIL_FROM,
        to: claimedLog.toEmail,
        subject: claimedLog.subject,
        text: claimedLog.body,
      });
      await prisma.emailLog.update({
        where: { id: claimedLog.id },
        data: { status: "SENT" },
      });
    } catch (err) {
      await prisma.emailLog.update({
        where: { id: claimedLog.id },
        data: { status: "FAILED", lastError: err.message },
      });
    }
  }
}
