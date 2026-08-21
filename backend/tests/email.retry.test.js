import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase } from './helpers.js';
import prisma from '../src/utils/db.js';
import { sendEmail, retryFailedEmails, setEmailTransportMock } from '../src/services/email.js';

describe('Phase 4: Email & Retry Tests', () => {
  after(async () => {
    setEmailTransportMock(null);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    setEmailTransportMock(null);
  });

  it('records SENT EmailLog on successful email dispatch', async () => {
    setEmailTransportMock({
      sendMail: async () => ({ messageId: 'test-success-id' }),
    });

    const success = await sendEmail({
      to: 'patient@clinic.test',
      subject: 'Welcome to Clinic',
      text: 'Thank you for registering.',
      type: 'BOOKING_CONFIRMATION',
    });

    assert.equal(success, true);
    const logs = await prisma.emailLog.findMany();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'SENT');
    assert.equal(logs[0].toEmail, 'patient@clinic.test');
    assert.equal(logs[0].subject, 'Welcome to Clinic');
    assert.equal(logs[0].body, 'Thank you for registering.');
  });

  it('records FAILED EmailLog and lastError when transporter fails', async () => {
    setEmailTransportMock({
      sendMail: async () => {
        throw new Error('SMTP connection timeout 504');
      },
    });

    const success = await sendEmail({
      to: 'patient@clinic.test',
      subject: 'Appointment Notice',
      text: 'Your slot is confirmed.',
      type: 'BOOKING_CONFIRMATION',
    });

    assert.equal(success, false);
    const logs = await prisma.emailLog.findMany();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'FAILED');
    assert.equal(logs[0].lastError, 'SMTP connection timeout 504');
  });

  it('retries failed emails preserving recipient, subject, and body, and increments attempts', async () => {
    // 1. Manually create a failed log
    const failed = await prisma.emailLog.create({
      data: {
        toEmail: 'retry.recipient@test.com',
        subject: 'Important Clinical Instructions',
        body: 'Fast 12 hours prior to visit.',
        type: 'REMINDER',
        status: 'FAILED',
        attempts: 1,
        lastError: 'Temporary network failure',
      },
    });

    // 2. Transporter is now working
    let sentPayload = null;
    setEmailTransportMock({
      sendMail: async (opts) => {
        sentPayload = opts;
        return { messageId: 'retry-sent' };
      },
    });

    await retryFailedEmails();

    // 3. Verify sent content and updated database row
    assert.equal(sentPayload.to, 'retry.recipient@test.com');
    assert.equal(sentPayload.subject, 'Important Clinical Instructions');
    assert.equal(sentPayload.text, 'Fast 12 hours prior to visit.');

    const updatedLog = await prisma.emailLog.findUnique({ where: { id: failed.id } });
    assert.equal(updatedLog.status, 'SENT');
    assert.equal(updatedLog.attempts, 2);
    assert.equal(updatedLog.toEmail, 'retry.recipient@test.com');
    assert.equal(updatedLog.subject, 'Important Clinical Instructions');
    assert.equal(updatedLog.body, 'Fast 12 hours prior to visit.');
  });
});
