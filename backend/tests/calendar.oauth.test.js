import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, getTestFixtures, resetDatabase } from './helpers.js';
import prisma from '../src/utils/db.js';
import { getDoctorScheduleSlots } from '../src/routes/doctors.js';
import {
  setCalendarClientMock,
  createOAuthState,
  verifyOAuthState,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../src/services/calendar.js';

describe('Phase 4: Google Calendar & OAuth Tests', () => {
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

  it('verifies Google Calendar lifecycle: Create on booking -> Update on reschedule -> Delete on cancel', async () => {
    const calendarLog = [];
    setCalendarClientMock({
      createEvent: async (userId, data) => {
        const id = 'evt_' + Math.random().toString(36).slice(2, 8);
        calendarLog.push({ type: 'CREATE', userId, id, data });
        return id;
      },
      updateEvent: async (userId, eventId, data) => {
        calendarLog.push({ type: 'UPDATE', userId, eventId, data });
      },
      deleteEvent: async (userId, eventId) => {
        calendarLog.push({ type: 'DELETE', userId, eventId });
      },
    });

    const slots = getDoctorScheduleSlots(fixtures.doctor, '2026-11-30');
    const slot1 = slots[0];
    const slot2 = slots[1];

    // 1. Hold and Confirm -> creates events
    const holdRes = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot1.toISOString() }),
    });
    const holdData = await holdRes.json();

    const confirmRes = await fetch(`${baseUrl}/appointments/${holdData.appointmentId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ symptomText: 'General checkup' }),
    });
    assert.equal(confirmRes.status, 200);

    const creates = calendarLog.filter((l) => l.type === 'CREATE');
    assert.equal(creates.length, 2, 'Should create calendar events for patient and doctor');

    // 2. Reschedule -> updates existing events with new time
    const rescheduleRes = await fetch(`${baseUrl}/appointments/${holdData.appointmentId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ newSlotStart: slot2.toISOString() }),
    });
    assert.equal(rescheduleRes.status, 200);

    const updates = calendarLog.filter((l) => l.type === 'UPDATE');
    assert.equal(updates.length, 2, 'Should update calendar events for patient and doctor');
    assert.equal(updates[0].data.start.toISOString(), slot2.toISOString());

    // 3. Cancel -> deletes calendar events
    const cancelRes = await fetch(`${baseUrl}/appointments/${holdData.appointmentId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fixtures.patient1.token}` },
    });
    assert.equal(cancelRes.status, 200);

    const deletes = calendarLog.filter((l) => l.type === 'DELETE');
    assert.equal(deletes.length, 2, 'Should delete calendar events on cancel');
  });

  it('guarantees appointment database state remains correct when Calendar API is down', async () => {
    // Mock throwing error on all calendar operations
    setCalendarClientMock({
      createEvent: async () => {
        throw new Error('Google Calendar 500 Internal Error');
      },
      updateEvent: async () => {
        throw new Error('Google Calendar 500 Internal Error');
      },
      deleteEvent: async () => {
        throw new Error('Google Calendar 500 Internal Error');
      },
    });

    const slots = getDoctorScheduleSlots(fixtures.doctor, '2026-11-30');
    const slot1 = slots[2];

    const holdRes = await fetch(`${baseUrl}/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ doctorId: fixtures.doctor.id, slotStart: slot1.toISOString() }),
    });
    const holdData = await holdRes.json();

    // Confirm booking must succeed in DB even if Google Calendar throws
    const confirmRes = await fetch(`${baseUrl}/appointments/${holdData.appointmentId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ symptomText: 'Ear pain' }),
    });
    assert.equal(confirmRes.status, 200);

    const appt = await prisma.appointment.findUnique({ where: { id: holdData.appointmentId } });
    assert.equal(appt.status, 'BOOKED');
  });

  it('verifies OAuth state security: one-time consumption, tamper protection, replay prevention, and expiration', async () => {
    const userId = fixtures.patient1.id;

    // 1. Valid state creation and consumption
    const state = await createOAuthState(userId);
    assert.ok(state);

    const firstVerify = await verifyOAuthState(state);
    assert.equal(firstVerify, userId);

    // 2. Replay attack attempt on consumed state -> returns null
    const replayVerify = await verifyOAuthState(state);
    assert.equal(replayVerify, null);

    // 3. Expired state -> returns null
    const expiredState = await createOAuthState(userId);
    await prisma.oAuthState.update({
      where: { state: expiredState },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expiredVerify = await verifyOAuthState(expiredState);
    assert.equal(expiredVerify, null);

    // 4. Unknown/tampered state -> returns null
    const badVerify = await verifyOAuthState('non-existent-or-tampered-state-token');
    assert.equal(badVerify, null);
  });
});
