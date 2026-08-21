import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, getTestFixtures, resetDatabase } from './helpers.js';
import prisma from '../src/utils/db.js';
import { getDoctorScheduleSlots } from '../src/routes/doctors.js';
import { setCalendarClientMock } from '../src/services/calendar.js';

describe('Phase 4: Rescheduling Tests', () => {
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
    setCalendarClientMock(null);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    setCalendarClientMock(null);
  });

  it('allows authorized patient, doctor, and admin to reschedule', async () => {
    const mondaySlots = getDoctorScheduleSlots(fixtures.doctor, '2026-11-16');
    const slotA = mondaySlots[0];
    const slotB = mondaySlots[1];
    const slotC = mondaySlots[2];
    const slotD = mondaySlots[3];

    // Create BOOKED appointment for Patient 1 with Doctor 1
    const appt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slotA,
        slotEnd: new Date(slotA.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    // 1. Patient reschedules to slotB
    const resPatient = await fetch(`${baseUrl}/appointments/${appt.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ newSlotStart: slotB.toISOString() }),
    });
    assert.equal(resPatient.status, 200);

    // 2. Doctor reschedules to slotC
    const resDoctor = await fetch(`${baseUrl}/appointments/${appt.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.doctor.token}` },
      body: JSON.stringify({ newSlotStart: slotC.toISOString() }),
    });
    assert.equal(resDoctor.status, 200);

    // 3. Admin reschedules to slotD
    const resAdmin = await fetch(`${baseUrl}/appointments/${appt.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.admin.token}` },
      body: JSON.stringify({ newSlotStart: slotD.toISOString() }),
    });
    assert.equal(resAdmin.status, 200);

    const finalAppt = await prisma.appointment.findUnique({ where: { id: appt.id } });
    assert.equal(finalAppt.slotStart.toISOString(), slotD.toISOString());
  });

  it('rejects invalid timestamps, off-hours, non-working days, and doctor leave (400 / 409)', async () => {
    const mondaySlots = getDoctorScheduleSlots(fixtures.doctor, '2026-11-16');
    const slotA = mondaySlots[0];

    const appt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slotA,
        slotEnd: new Date(slotA.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    // Arbitrary unaligned minutes (e.g. 09:13:21) -> 400
    const arbitraryTime = new Date(slotA.getTime() + 13 * 60000 + 21000).toISOString();
    const resArbitrary = await fetch(`${baseUrl}/appointments/${appt.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ newSlotStart: arbitraryTime }),
    });
    assert.equal(resArbitrary.status, 400);

    // Non-working day (Sunday 2026-11-15) -> 400
    const sundayTime = '2026-11-15T09:00:00.000Z';
    const resSunday = await fetch(`${baseUrl}/appointments/${appt.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ newSlotStart: sundayTime }),
    });
    assert.equal(resSunday.status, 400);

    // Doctor leave date -> 409
    const tuesdaySlots = getDoctorScheduleSlots(fixtures.doctor, '2026-11-17');
    await prisma.doctorLeave.create({
      data: { doctorId: fixtures.doctor.id, date: '2026-11-17', reason: 'Personal leave' },
    });
    const resLeave = await fetch(`${baseUrl}/appointments/${appt.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ newSlotStart: tuesdaySlots[0].toISOString() }),
    });
    assert.equal(resLeave.status, 409);
  });

  it('releases previous slot and protects new slot against double-booking', async () => {
    const mondaySlots = getDoctorScheduleSlots(fixtures.doctor, '2026-11-16');
    const slotA = mondaySlots[0];
    const slotB = mondaySlots[1];

    const appt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slotA,
        slotEnd: new Date(slotA.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    // Reschedule to slotB
    const res = await fetch(`${baseUrl}/appointments/${appt.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ newSlotStart: slotB.toISOString() }),
    });
    assert.equal(res.status, 200);

    // Patient 2 can now hold old slotA
    const reholdA = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slotA.toISOString() }),
    });
    assert.equal(reholdA.status, 201);

    // Patient 2 cannot hold new slotB (409)
    const doubleHoldB = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slotB.toISOString() }),
    });
    assert.equal(doubleHoldB.status, 409);
  });

  it('maintains non-blocking error semantics when Google Calendar API fails during reschedule', async () => {
    const mondaySlots = getDoctorScheduleSlots(fixtures.doctor, '2026-11-16');
    const slotA = mondaySlots[0];
    const slotB = mondaySlots[1];

    const appt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slotA,
        slotEnd: new Date(slotA.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    // Set mock to throw on updateEvent
    setCalendarClientMock({
      updateEvent: async () => {
        throw new Error('Google Calendar 503 Service Unavailable');
      },
    });

    const res = await fetch(`${baseUrl}/appointments/${appt.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ newSlotStart: slotB.toISOString() }),
    });

    // Must return 200 OK and persist the new slot in DB
    assert.equal(res.status, 200);
    const updated = await prisma.appointment.findUnique({ where: { id: appt.id } });
    assert.equal(updated.slotStart.toISOString(), slotB.toISOString());
  });
});
