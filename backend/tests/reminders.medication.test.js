import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, getTestFixtures, resetDatabase } from './helpers.js';
import prisma from '../src/utils/db.js';
import { parseFrequencyToTimesPerDay, calculateDailyDoseHours } from '../src/routes/appointments.js';
import { sendDueMedicationReminders, sendDueAppointmentReminders } from '../src/jobs/reminders.js';
import { retryFailedEmails } from '../src/services/email.js';

describe('Phase 4: Medication Reminders & Cron Tests', () => {
  let serverInstance;
  let baseUrl;
  let fixtures;

  before(async () => {
    serverInstance = await startTestServer();
    baseUrl = serverInstance.baseUrl;
    fixtures = await getTestFixtures();
  });

  after(async () => {
    if (serverInstance) await serverInstance.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('correctly parses all standard and custom frequency expressions', () => {
    assert.equal(parseFrequencyToTimesPerDay('once daily'), 1);
    assert.equal(parseFrequencyToTimesPerDay('1x daily'), 1);
    assert.equal(parseFrequencyToTimesPerDay('qd'), 1);

    assert.equal(parseFrequencyToTimesPerDay('twice daily'), 2);
    assert.equal(parseFrequencyToTimesPerDay('2 times a day'), 2);
    assert.equal(parseFrequencyToTimesPerDay('bid'), 2);
    assert.equal(parseFrequencyToTimesPerDay('every 12 hours'), 2);

    assert.equal(parseFrequencyToTimesPerDay('three times daily'), 3);
    assert.equal(parseFrequencyToTimesPerDay('thrice daily'), 3);
    assert.equal(parseFrequencyToTimesPerDay('tid'), 3);
    assert.equal(parseFrequencyToTimesPerDay('every 8 hours'), 3);

    assert.equal(parseFrequencyToTimesPerDay('four times daily'), 4);
    assert.equal(parseFrequencyToTimesPerDay('4x per day'), 4);
    assert.equal(parseFrequencyToTimesPerDay('qid'), 4);
    assert.equal(parseFrequencyToTimesPerDay('every 6 hours'), 4);
  });

  it('distributes doses evenly across waking hours (08:00 to 22:00) with no midnight wrapping', () => {
    const hours1 = calculateDailyDoseHours(1);
    assert.deepEqual(hours1, [9]);

    const hours2 = calculateDailyDoseHours(2);
    assert.deepEqual(hours2, [8, 20]);

    const hours3 = calculateDailyDoseHours(3);
    assert.deepEqual(hours3, [8, 14, 20]);

    const hours4 = calculateDailyDoseHours(4);
    assert.deepEqual(hours4, [8, 12, 16, 20]);

    for (const h of [...hours1, ...hours2, ...hours3, ...hours4]) {
      assert.ok(h >= 8 && h <= 22, `Hour ${h} must be within waking hours (08:00 to 22:00)`);
    }
  });

  it('guarantees idempotency when sending due medication reminders under concurrent execution', async () => {
    // 1. Create an appointment with patient
    const appt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: new Date('2026-11-20T03:30:00.000Z'),
        slotEnd: new Date('2026-11-20T04:00:00.000Z'),
        status: 'COMPLETED',
      },
    });

    // 2. Create due medication reminders (scheduled in past)
    const dueReminder = await prisma.medicationReminder.create({
      data: {
        appointmentId: appt.id,
        drugName: 'Metformin',
        dose: '500mg',
        scheduledAt: new Date(Date.now() - 60000), // 1 min ago
        sent: false,
      },
    });

    // 3. Run job concurrently (simulating multiple cron triggers or worker processes)
    await Promise.all([
      sendDueMedicationReminders(),
      sendDueMedicationReminders(),
      sendDueMedicationReminders(),
    ]);

    // Verify reminder is marked sent: true and exactly 1 EmailLog was created
    const updated = await prisma.medicationReminder.findUnique({ where: { id: dueReminder.id } });
    assert.equal(updated.sent, true);

    const emailLogs = await prisma.emailLog.findMany({
      where: { appointmentId: appt.id, type: 'REMINDER' },
    });
    assert.equal(emailLogs.length, 1);
  });

  it('guarantees 24h appointment reminder timing and database-level idempotency', async () => {
    const now = Date.now();
    // 24h in advance (in window)
    const slot24h = new Date(now + 24 * 60 * 60 * 1000);
    // 12h in advance (outside window)
    const slot12h = new Date(now + 12 * 60 * 60 * 1000);

    const appt24h = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slot24h,
        slotEnd: new Date(slot24h.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    const appt12h = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slot12h,
        slotEnd: new Date(slot12h.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    // Run job concurrently
    await Promise.all([
      sendDueAppointmentReminders(),
      sendDueAppointmentReminders(),
      sendDueAppointmentReminders(),
    ]);

    const logs24h = await prisma.emailLog.findMany({
      where: { appointmentId: appt24h.id, type: 'APPOINTMENT_REMINDER' },
    });
    assert.equal(logs24h.length, 1);
    assert.equal(logs24h[0].idempotencyKey, `APPOINTMENT_REMINDER:${appt24h.id}`);

    const logs12h = await prisma.emailLog.findMany({
      where: { appointmentId: appt12h.id, type: 'APPOINTMENT_REMINDER' },
    });
    assert.equal(logs12h.length, 0, '12h appointment must be skipped outside 24h window');
  });
});
