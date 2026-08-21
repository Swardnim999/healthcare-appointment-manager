import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, getTestFixtures, resetDatabase } from './helpers.js';
import prisma from '../src/utils/db.js';

describe('Phase 4: Booking & Concurrency Tests', () => {
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

  it('handles simultaneous concurrent holds for the same slot (exactly 1 wins, other gets 409)', async () => {
    const targetSlot = new Date('2026-11-09T03:30:00.000Z').toISOString();

    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/appointments/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
        body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: targetSlot }),
      }),
      fetch(`${baseUrl}/appointments/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
        body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: targetSlot }),
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [201, 409], 'One request must succeed (201) and one must be rejected (409)');
  });

  it('prevents double-booking on active HELD and BOOKED slots', async () => {
    const slot = new Date('2026-11-09T04:00:00.000Z').toISOString();

    // Patient 1 holds
    const holdRes = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot }),
    });
    assert.equal(holdRes.status, 201);
    const holdData = await holdRes.json();

    // Patient 2 attempts to hold active held slot -> 409
    const doubleHold = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot }),
    });
    assert.equal(doubleHold.status, 409);

    // Patient 1 confirms
    const confirmRes = await fetch(`${baseUrl}/appointments/${holdData.appointmentId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ symptomText: 'Routine test' }),
    });
    assert.equal(confirmRes.status, 200);

    // Patient 2 attempts to hold confirmed BOOKED slot -> 409
    const doubleBook = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot }),
    });
    assert.equal(doubleBook.status, 409);
  });

  it('allows re-holding an expired hold', async () => {
    const slot = new Date('2026-11-09T04:30:00.000Z');

    // Create an expired hold in DB
    await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slot,
        slotEnd: new Date(slot.getTime() + 30 * 60000),
        status: 'HELD',
        holdExpiresAt: new Date(Date.now() - 10000), // expired 10s ago
      },
    });

    // Patient 2 should be able to hold the expired slot
    const reholdRes = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot.toISOString() }),
    });
    assert.equal(reholdRes.status, 201);
  });

  it('allows re-holding a CANCELLED appointment slot', async () => {
    const slot = new Date('2026-11-09T05:00:00.000Z');

    // Create a cancelled appointment
    await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slot,
        slotEnd: new Date(slot.getTime() + 30 * 60000),
        status: 'CANCELLED',
      },
    });

    // Patient 2 should be able to hold the cancelled slot
    const reholdRes = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot.toISOString() }),
    });
    assert.equal(reholdRes.status, 201);
  });

  it('prevents re-booking or holding a COMPLETED appointment slot (409)', async () => {
    const slot = new Date('2026-11-09T05:30:00.000Z');

    await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: slot,
        slotEnd: new Date(slot.getTime() + 30 * 60000),
        status: 'COMPLETED',
      },
    });

    const holdRes = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot.toISOString() }),
    });
    assert.equal(holdRes.status, 409);
  });

  it('blocks booking and confirmation when doctor is on leave', async () => {
    const leaveDate = '2026-11-10';
    const slot = new Date('2026-11-10T03:30:00.000Z');

    // Hold the slot before leave is recorded
    const holdRes = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot.toISOString() }),
    });
    assert.equal(holdRes.status, 201);
    const holdData = await holdRes.json();

    // Mark doctor on leave
    await prisma.doctorLeave.create({
      data: { doctorId: fixtures.doctor.id, date: leaveDate, reason: 'Conference' },
    });

    // Attempting to confirm existing hold after leave is set -> 409 (Doctor on leave)
    const confirmRes = await fetch(`${baseUrl}/appointments/${holdData.appointmentId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ symptomText: 'Test after leave' }),
    });
    assert.equal(confirmRes.status, 409);

    // New hold attempt during leave -> 409
    const newHold = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot.toISOString() }),
    });
    assert.equal(newHold.status, 409);
  });
});
