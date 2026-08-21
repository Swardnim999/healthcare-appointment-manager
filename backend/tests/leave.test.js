import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, getTestFixtures, resetDatabase } from './helpers.js';
import prisma from '../src/utils/db.js';
import { getDoctorScheduleSlots } from '../src/routes/doctors.js';

describe('Phase 4: Leave Management Tests', () => {
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

  it('cancels affected booked appointments, invalidates held slots, and notifies patients', async () => {
    const leaveDate = '2026-11-23'; // Monday
    const slots = getDoctorScheduleSlots(fixtures.doctor, leaveDate);
    const slotA = slots[0];
    const slotB = slots[1];

    const unrelatedDate = '2026-11-24'; // Tuesday
    const unrelatedSlots = getDoctorScheduleSlots(fixtures.doctor, unrelatedDate);
    const unrelatedSlot = unrelatedSlots[0];

    // 1. Booked appointment on leave date
    const bookedAppt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slotA,
        slotEnd: new Date(slotA.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    // 2. Active hold on leave date
    const heldAppt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient2.id,
        slotStart: slotB,
        slotEnd: new Date(slotB.getTime() + 30 * 60000),
        status: 'HELD',
        holdExpiresAt: new Date(Date.now() + 5 * 60000),
      },
    });

    // 3. Unrelated appointment on Tuesday
    const unrelatedAppt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: unrelatedSlot,
        slotEnd: new Date(unrelatedSlot.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    // Admin sets doctor leave
    const leaveRes = await fetch(`${baseUrl}/admin/doctors/${fixtures.doctor.id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.admin.token}` },
      body: JSON.stringify({ date: leaveDate, reason: 'Annual Medical Summit' }),
    });
    assert.equal(leaveRes.status, 200);

    // Verify booked appointment was marked CANCELLED_BY_LEAVE
    const updatedBooked = await prisma.appointment.findUnique({ where: { id: bookedAppt.id } });
    assert.equal(updatedBooked.status, 'CANCELLED_BY_LEAVE');

    // Verify held slot was marked CANCELLED_BY_LEAVE
    const updatedHeld = await prisma.appointment.findUnique({ where: { id: heldAppt.id } });
    assert.equal(updatedHeld.status, 'CANCELLED_BY_LEAVE');

    // Verify unrelated appointment on Tuesday remained BOOKED
    const updatedUnrelated = await prisma.appointment.findUnique({ where: { id: unrelatedAppt.id } });
    assert.equal(updatedUnrelated.status, 'BOOKED');

    // Verify cancellation notification was logged for affected patient
    const emailLogs = await prisma.emailLog.findMany({
      where: { appointmentId: bookedAppt.id, type: 'LEAVE_CANCELLATION' },
    });
    assert.equal(emailLogs.length, 1);
    assert.equal(emailLogs[0].toEmail, fixtures.patient1.email);
  });
});
