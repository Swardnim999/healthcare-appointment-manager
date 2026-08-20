import cron from "node-cron";
import prisma from "../utils/db.js";
import { sendEmail, retryFailedEmails } from "../services/email.js";

/**
 * Every 5 minutes: send any due, unsent medication reminders, and retry any
 * emails that previously failed (transient SMTP errors etc.) — this is the
 * "background job for medication reminders and email retries" required by
 * the spec.
 */
export function startBackgroundJobs() {
  cron.schedule("*/5 * * * *", async () => {
    await sendDueMedicationReminders();
    await retryFailedEmails();
  });
  console.log("[jobs] background jobs scheduled (every 5 min)");
}

async function sendDueMedicationReminders() {
  const due = await prisma.medicationReminder.findMany({
    where: { sent: false, scheduledAt: { lte: new Date() } },
    include: { appointment: { include: { patient: true } } },
  });

  for (const reminder of due) {
    const ok = await sendEmail({
      to: reminder.appointment.patient.email,
      subject: "Medication Reminder",
      text: `Reminder: take ${reminder.drugName} (${reminder.dose}) now.`,
      type: "REMINDER",
      appointmentId: reminder.appointmentId,
    });
    if (ok) {
      await prisma.medicationReminder.update({ where: { id: reminder.id }, data: { sent: true } });
    }
  }
}
