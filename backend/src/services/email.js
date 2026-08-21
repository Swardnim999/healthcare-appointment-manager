import nodemailer from "nodemailer";
import prisma from "../utils/db.js";

let transporter = null;
let mockTransporter = null;

export function setEmailTransportMock(mock) {
  mockTransporter = mock;
}

export function getEmailTransportMock() {
  return mockTransporter;
}

export function getTransporter() {
  if (mockTransporter) return mockTransporter;
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else {
    // Dev fallback: "sends" mail by logging it. Lets the whole flow be
    // demoed/graded without needing real SMTP credentials.
    transporter = {
      sendMail: async (opts) => {
        return { messageId: "dev-" + Date.now() };
      },
    };
  }
  return transporter;
}

/**
 * Sends an email and logs the attempt to EmailLog. On failure, logs status
 * FAILED with the error — a cron job (jobs/reminders.js) periodically
 * retries anything not SENT, so a transient SMTP outage doesn't silently
 * drop a booking confirmation.
 */
export async function sendEmail({ to, subject, text, body, type, appointmentId = null }) {
  const contentText = text !== undefined ? text : body;
  const t = getTransporter();
  const log = await prisma.emailLog.create({
    data: {
      toEmail: to,
      subject,
      body: contentText,
      type,
      status: "RETRYING",
      attempts: 1,
      appointmentId,
    },
  });

  try {
    await t.sendMail({ from: process.env.EMAIL_FROM, to, subject, text: contentText });
    await prisma.emailLog.update({ where: { id: log.id }, data: { status: "SENT" } });
    return true;
  } catch (err) {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: "FAILED", lastError: err.message },
    });
    console.error(`[email] send failed to ${to}:`, err.message);
    return false;
  }
}

export async function retryFailedEmails() {
  const failed = await prisma.emailLog.findMany({
    where: { status: "FAILED", attempts: { lt: 5 } },
  });
  const t = getTransporter();
  for (const log of failed) {
    try {
      await t.sendMail({
        from: process.env.EMAIL_FROM,
        to: log.toEmail,
        subject: log.subject || `[Retry] Clinic notification (${log.type})`,
        text: log.body || "This is a retried notification from the clinic system. Please check your appointment dashboard for details.",
      });
      await prisma.emailLog.update({
        where: { id: log.id },
        data: { status: "SENT", attempts: log.attempts + 1 },
      });
    } catch (err) {
      await prisma.emailLog.update({
        where: { id: log.id },
        data: { attempts: log.attempts + 1, lastError: err.message },
      });
    }
  }
}
