import 'dotenv/config';
import prisma from './src/utils/db.js';
import jwt from 'jsonwebtoken';
import express from 'express';
import authRoutes from './src/routes/auth.js';
import doctorRoutes, { getDoctorScheduleSlots } from './src/routes/doctors.js';
import appointmentRoutes from './src/routes/appointments.js';
import adminRoutes from './src/routes/admin.js';
import calendarRoutes from './src/routes/calendar.js';
import {
  setCalendarClientMock,
  createOAuthState,
  verifyOAuthState,
} from './src/services/calendar.js';
import { sendDueAppointmentReminders } from './src/jobs/reminders.js';
import { retryFailedEmails } from './src/services/email.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/calendar', calendarRoutes);

let server;
const PORT = 5557;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runPhase3Tests() {
  server = app.listen(PORT, '127.0.0.1', () => console.log('Phase 3 test server running on http://127.0.0.1:' + PORT));
  const baseUrl = 'http://127.0.0.1:' + PORT + '/api';

  try {
    console.log('\n======================================================');
    console.log('>>> RUNNING PHASE 3 INTEGRATIONS TEST SUITE <<<');
    console.log('======================================================\n');

    // Setup Doctor & Patients
    const doctor = await prisma.doctorProfile.findFirst({ include: { user: true } });
    if (!doctor) throw new Error('Doctor profile not found. Run seed.');

    const patient1 = await prisma.user.findUnique({ where: { email: 'patient@clinic.test' } });
    const token1 = jwt.sign(
      { id: patient1.id, role: patient1.role, email: patient1.email, name: patient1.name },
      JWT_SECRET
    );

    let patient2 = await prisma.user.findUnique({ where: { email: 'patient2@clinic.test' } });
    if (!patient2) {
      patient2 = await prisma.user.create({
        data: { name: 'Second Test Patient', email: 'patient2@clinic.test', passwordHash: 'dummy', role: 'PATIENT' },
      });
    }
    const token2 = jwt.sign(
      { id: patient2.id, role: patient2.role, email: patient2.email, name: patient2.name },
      JWT_SECRET
    );

    // -------------------------------------------------------------------------
    // TEST SUITE 1: APPOINTMENT RESCHEDULING & SLOT VALIDATION
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: APPOINTMENT RESCHEDULING & SLOT VALIDATION ---');

    const testDate = '2026-10-05';
    const calDate = '2026-10-12';

    // Clean up test dates and logs
    await prisma.emailLog.deleteMany({});
    await prisma.medicationReminder.deleteMany({});
    await prisma.oAuthState.deleteMany({});
    await prisma.appointment.deleteMany({
      where: {
        doctorId: doctor.id,
        OR: [
          { slotStart: { gte: new Date('2026-10-05T00:00:00'), lte: new Date('2026-10-05T23:59:59') } },
          { slotStart: { gte: new Date('2026-10-12T00:00:00'), lte: new Date('2026-10-12T23:59:59') } },
        ],
      },
    });

    const slotsRes = await fetch(baseUrl + `/doctors/${doctor.id}/slots?date=${testDate}`).then((r) => r.json());
    assert(slotsRes.slots && slotsRes.slots.length >= 3, 'Doctor should have at least 3 available slots on Monday');

    const slotA = slotsRes.slots[0];
    const slotB = slotsRes.slots[1];
    const slotC = slotsRes.slots[2];
    const invalidSlotTimestamp = new Date(new Date(slotA).getTime() + 17 * 60 * 1000 + 23 * 1000).toISOString(); // arbitrary minutes/seconds
    const offHoursSlot = new Date('2026-10-05T23:00:00.000Z').toISOString(); // 11 PM

    // 1a. Patient 1 holds and confirms slotA
    const holdResA = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: slotA }),
    });
    const holdDataA = await holdResA.json();
    assert(holdResA.status === 201, 'Hold for Slot A failed');

    const confirmResA = await fetch(baseUrl + `/appointments/${holdDataA.appointmentId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ symptomText: 'Initial consultation' }),
    });
    const confirmDataA = await confirmResA.json();
    assert(confirmResA.status === 200 && confirmDataA.status === 'BOOKED', 'Confirmation for Slot A failed');

    // 1b. Reject rescheduling to invalid timestamps (arbitrary minutes / outside doctor slots)
    console.log('[1b] Verifying invalid slot timestamp rejection (arbitrary time & off-hours)...');
    const invalidTimeRes = await fetch(baseUrl + `/appointments/${holdDataA.appointmentId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ newSlotStart: invalidSlotTimestamp }),
    });
    assert(invalidTimeRes.status === 400, `Expected 400 for arbitrary timestamp, got ${invalidTimeRes.status}`);

    const offHoursRes = await fetch(baseUrl + `/appointments/${holdDataA.appointmentId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ newSlotStart: offHoursSlot }),
    });
    assert(offHoursRes.status === 400, `Expected 400 for off-hours slot, got ${offHoursRes.status}`);
    console.log('✔ Invalid slot timestamps correctly rejected with 400.');

    // 1c. Unauthorized user attempts to reschedule Patient 1's appointment -> 403
    console.log('[1c] Verifying unauthorized reschedule rejection...');
    const unauthReschedule = await fetch(baseUrl + `/appointments/${holdDataA.appointmentId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token2 },
      body: JSON.stringify({ newSlotStart: slotB }),
    });
    assert(unauthReschedule.status === 403, `Expected 403 for unauthorized reschedule, got ${unauthReschedule.status}`);
    console.log('✔ Unauthorized reschedule correctly rejected (403).');

    // 1d. Patient 1 reschedules from slotA to slotB
    console.log('[1d] Rescheduling from Slot A to Slot B...');
    const rescheduleRes = await fetch(baseUrl + `/appointments/${holdDataA.appointmentId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ newSlotStart: slotB }),
    });
    const rescheduleData = await rescheduleRes.json();
    assert(rescheduleRes.status === 200, `Reschedule failed: ${JSON.stringify(rescheduleData)}`);
    assert(new Date(rescheduleData.slotStart).toISOString() === slotB, 'SlotStart should be updated to Slot B');
    console.log('✔ Reschedule to Slot B succeeded.');

    // 1e. Verify Old Slot A is now FREE and can be held by Patient 2
    console.log('[1e] Verifying old Slot A was released atomically...');
    const reholdARes = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token2 },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: slotA }),
    });
    assert(reholdARes.status === 201, 'Old Slot A should be freely bookable after reschedule');
    console.log('✔ Old Slot A successfully re-held by Patient 2.');

    // 1f. Patient 2 tries to hold Slot B (which is currently booked by Patient 1) -> 409
    console.log('[1f] Verifying double-booking prevention on newly rescheduled Slot B...');
    const doubleBookBRes = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token2 },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: slotB }),
    });
    assert(doubleBookBRes.status === 409, `Expected 409 on booked slot B, got ${doubleBookBRes.status}`);
    console.log('✔ Double-booking prevention preserved on rescheduled slot (409).');

    // 1g. Reschedule to doctor leave date is rejected
    console.log('[1g] Verifying reschedule rejection during doctor leave...');
    const leaveDate = '2026-10-06';
    const leaveSlots = getDoctorScheduleSlots(doctor, leaveDate);
    const leaveSlot = leaveSlots[0].toISOString();
    await prisma.doctorLeave.upsert({
      where: { doctorId_date: { doctorId: doctor.id, date: leaveDate } },
      update: { reason: 'Leave day' },
      create: { doctorId: doctor.id, date: leaveDate, reason: 'Leave day' },
    });
    const leaveRescheduleRes = await fetch(baseUrl + `/appointments/${holdDataA.appointmentId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ newSlotStart: leaveSlot }),
    });
    assert(leaveRescheduleRes.status === 409, `Expected 409 when rescheduling to leave date, got ${leaveRescheduleRes.status}`);
    console.log('✔ Reschedule during doctor leave correctly rejected (409).\n');

    // -------------------------------------------------------------------------
    // TEST SUITE 2: GOOGLE CALENDAR LIFECYCLE & RESILIENCE
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: GOOGLE CALENDAR LIFECYCLE & RESILIENCE ---');

    const calendarEventsLog = [];
    let throwOnUpdate = false;
    const mockClient = {
      createEvent: async (userId, data) => {
        const id = 'cal_event_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        calendarEventsLog.push({ action: 'CREATE', userId, eventId: id, data });
        return id;
      },
      updateEvent: async (userId, eventId, data) => {
        if (throwOnUpdate) {
          throw new Error('Simulated Google Calendar API Outage');
        }
        calendarEventsLog.push({ action: 'UPDATE', userId, eventId, data });
      },
      deleteEvent: async (userId, eventId) => {
        calendarEventsLog.push({ action: 'DELETE', userId, eventId });
      },
    };
    setCalendarClientMock(mockClient);

    const calSlotsRes = await fetch(baseUrl + `/doctors/${doctor.id}/slots?date=${calDate}`).then((r) => r.json());
    assert(calSlotsRes.slots && calSlotsRes.slots.length >= 3, 'Doctor should have at least 3 available slots on Monday');

    const slotCal1 = calSlotsRes.slots[0];
    const slotCal2 = calSlotsRes.slots[1];
    const slotCal3 = calSlotsRes.slots[2];
    await prisma.appointment.deleteMany({
      where: { doctorId: doctor.id, slotStart: { in: [new Date(slotCal1), new Date(slotCal2), new Date(slotCal3)] } },
    });

    // 2a. Book appointment -> triggers Calendar CREATE
    console.log('[2a] Booking appointment with calendar sync...');
    const calHold = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: slotCal1 }),
    }).then((r) => r.json());

    await fetch(baseUrl + `/appointments/${calHold.appointmentId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ symptomText: 'Routine checkup' }),
    }).then((r) => r.json());

    const createdEvents = calendarEventsLog.filter((e) => e.action === 'CREATE');
    assert(createdEvents.length === 2, `Expected 2 calendar CREATE events (patient + doctor), got ${createdEvents.length}`);
    console.log('✔ Calendar events created on booking.');

    // 2b. Reschedule appointment -> triggers Calendar UPDATE with new time
    console.log('[2b] Rescheduling appointment with calendar sync...');
    await fetch(baseUrl + `/appointments/${calHold.appointmentId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ newSlotStart: slotCal2 }),
    });

    const updatedEvents = calendarEventsLog.filter((e) => e.action === 'UPDATE');
    assert(updatedEvents.length === 2, `Expected 2 calendar UPDATE events, got ${updatedEvents.length}`);
    assert(
      updatedEvents[0].data.start.toISOString() === slotCal2,
      'Updated event start time should match rescheduled slot'
    );
    console.log('✔ Calendar events updated on reschedule with preserved IDs.');

    // 2c. Non-blocking error semantics: calendar outage does NOT fail database reschedule
    console.log('[2c] Testing non-blocking reschedule resilience during calendar outage...');
    throwOnUpdate = true;
    const resilientReschedule = await fetch(baseUrl + `/appointments/${calHold.appointmentId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ newSlotStart: slotCal3 }),
    });
    assert(resilientReschedule.status === 200, `Expected 200 despite calendar error, got ${resilientReschedule.status}`);
    const resilientData = await resilientReschedule.json();
    assert(new Date(resilientData.slotStart).toISOString() === slotCal3, 'Database appointment slot should be updated');
    throwOnUpdate = false;
    console.log('✔ Reschedule endpoint safely returns 200 when calendar service errors.');

    // 2d. Cancel appointment -> triggers Calendar DELETE
    console.log('[2d] Cancelling appointment with calendar sync...');
    await fetch(baseUrl + `/appointments/${calHold.appointmentId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
    });

    const deletedEvents = calendarEventsLog.filter((e) => e.action === 'DELETE');
    assert(deletedEvents.length === 2, `Expected 2 calendar DELETE events, got ${deletedEvents.length}`);
    console.log('✔ Calendar events deleted on cancellation.');

    // Reset mock
    setCalendarClientMock(null);
    console.log('✔ Test 2 Passed: Google Calendar lifecycle and resilience verified.\n');

    // -------------------------------------------------------------------------
    // TEST SUITE 3: ONE-TIME GOOGLE CALENDAR OAUTH STATE & REPLAY PROTECTION
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: GOOGLE CALENDAR OAUTH STATE & ONE-TIME USE ---');

    const testUserId = patient1.id;
    // 3a. Generate one-time state
    const oneTimeState = await createOAuthState(testUserId);
    assert(typeof oneTimeState === 'string' && oneTimeState.length > 20, 'State should be a random token');

    // 3b. First verification succeeds
    const firstVerification = await verifyOAuthState(oneTimeState);
    assert(firstVerification === testUserId, `Expected verified userId ${testUserId}, got ${firstVerification}`);
    console.log('✔ Initial OAuth state verification succeeded.');

    // 3c. Second verification (replay attack) fails because state is single-use
    const replayVerification = await verifyOAuthState(oneTimeState);
    assert(replayVerification === null, 'Replay of consumed OAuth state must return null');
    console.log('✔ Replay attempt of consumed OAuth state successfully rejected.');

    // 3d. Expired state must be rejected
    const expiredState = await createOAuthState(testUserId);
    await prisma.oAuthState.update({
      where: { state: expiredState },
      data: { expiresAt: new Date(Date.now() - 5000) },
    });
    const expiredCheck = await verifyOAuthState(expiredState);
    assert(expiredCheck === null, 'Expired OAuth state must return null');
    console.log('✔ Expired OAuth state successfully rejected.');

    // 3e. OAuth callback route rejects invalid / already-used state
    const badCallbackRes = await fetch(baseUrl + '/calendar/oauth/callback?code=mock-code&state=' + oneTimeState);
    assert(badCallbackRes.status === 400, `Expected 400 on reused OAuth state in callback, got ${badCallbackRes.status}`);
    console.log('✔ OAuth callback endpoint rejects replayed/invalid state.\n');

    // -------------------------------------------------------------------------
    // TEST SUITE 4: 24-HOUR APPOINTMENT REMINDER TIMING & DB IDEMPOTENCY
    // -------------------------------------------------------------------------
    console.log('--- TEST 4: 24-HOUR APPOINTMENT REMINDER TIMING & DB IDEMPOTENCY ---');

    await prisma.emailLog.deleteMany({});

    const now = Date.now();
    // Exactly 24h in advance (within the 23h55m - 24h05m window)
    const exactly24hSlot = new Date(now + 24 * 60 * 60 * 1000);
    // Cancelled appointment at 24h 1m (in window, but cancelled)
    const cancelledSlot = new Date(now + 24 * 60 * 60 * 1000 + 60 * 1000);
    // Completed appointment at 24h 2m (in window, but completed)
    const completedSlot = new Date(now + 24 * 60 * 60 * 1000 + 2 * 60 * 1000);
    // 12h in advance (outside the 24h window)
    const in12hSlot = new Date(now + 12 * 60 * 60 * 1000);
    // 48h in advance (outside the 24h window)
    const farFutureSlot = new Date(now + 48 * 60 * 60 * 1000);
    // Past appointment (2h ago)
    const pastSlot = new Date(now - 2 * 60 * 60 * 1000);

    const targetAppt = await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId: patient1.id,
        slotStart: exactly24hSlot,
        slotEnd: new Date(exactly24hSlot.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    const in12hAppt = await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId: patient1.id,
        slotStart: in12hSlot,
        slotEnd: new Date(in12hSlot.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    const farFutureAppt = await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId: patient1.id,
        slotStart: farFutureSlot,
        slotEnd: new Date(farFutureSlot.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    const pastAppt = await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId: patient1.id,
        slotStart: pastSlot,
        slotEnd: new Date(pastSlot.getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    const cancelledAppt = await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId: patient1.id,
        slotStart: cancelledSlot,
        slotEnd: new Date(cancelledSlot.getTime() + 30 * 60000),
        status: 'CANCELLED',
      },
    });

    const completedAppt = await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId: patient1.id,
        slotStart: completedSlot,
        slotEnd: new Date(completedSlot.getTime() + 30 * 60000),
        status: 'COMPLETED',
      },
    });

    // 4a. Run appointment reminder job concurrently and sequentially
    console.log('Running sendDueAppointmentReminders concurrently (testing DB uniqueness constraint race)...');
    await Promise.all([
      sendDueAppointmentReminders(),
      sendDueAppointmentReminders(),
      sendDueAppointmentReminders(),
      sendDueAppointmentReminders(),
    ]);
    await sendDueAppointmentReminders();

    // 4b. Verify only target 24h appointment received exactly 1 reminder
    const targetLogs = await prisma.emailLog.findMany({
      where: { appointmentId: targetAppt.id, type: 'APPOINTMENT_REMINDER' },
    });
    assert(targetLogs.length === 1, `Expected exactly 1 reminder email for 24h appt, got ${targetLogs.length}`);
    assert(
      targetLogs[0].idempotencyKey === `APPOINTMENT_REMINDER:${targetAppt.id}`,
      'Idempotency key must match format'
    );

    const in12hLogs = await prisma.emailLog.findMany({
      where: { appointmentId: in12hAppt.id, type: 'APPOINTMENT_REMINDER' },
    });
    assert(in12hLogs.length === 0, '12h appointment should not receive 24h reminder (outside narrow window)');

    const farFutureLogs = await prisma.emailLog.findMany({
      where: { appointmentId: farFutureAppt.id, type: 'APPOINTMENT_REMINDER' },
    });
    assert(farFutureLogs.length === 0, '48h appointment should not receive 24h reminder');

    const pastLogs = await prisma.emailLog.findMany({
      where: { appointmentId: pastAppt.id, type: 'APPOINTMENT_REMINDER' },
    });
    assert(pastLogs.length === 0, 'Past appointment should not receive 24h reminder');

    const cancelledLogs = await prisma.emailLog.findMany({
      where: { appointmentId: cancelledAppt.id, type: 'APPOINTMENT_REMINDER' },
    });
    assert(cancelledLogs.length === 0, 'Cancelled appointment should not receive reminder');

    const completedLogs = await prisma.emailLog.findMany({
      where: { appointmentId: completedAppt.id, type: 'APPOINTMENT_REMINDER' },
    });
    assert(completedLogs.length === 0, 'Completed appointment should not receive reminder');

    // 4c. Verify retry behavior on FAILED reminder email
    console.log('[4c] Testing retry behavior for failed reminder emails...');
    const failedReminder = await prisma.emailLog.create({
      data: {
        toEmail: 'failed.reminder@clinic.test',
        subject: 'Upcoming Appointment Reminder (24 Hours)',
        body: 'Reminder: You have an upcoming appointment.',
        type: 'APPOINTMENT_REMINDER',
        status: 'FAILED',
        attempts: 1,
        lastError: 'Simulated network drop',
        idempotencyKey: 'APPOINTMENT_REMINDER:mock-retry-appt',
      },
    });

    await retryFailedEmails();
    const retriedLog = await prisma.emailLog.findUnique({ where: { id: failedReminder.id } });
    assert(retriedLog.status === 'SENT', `Expected retried reminder status SENT, got ${retriedLog.status}`);
    assert(retriedLog.attempts === 2, `Expected attempts 2, got ${retriedLog.attempts}`);
    console.log('✔ Failed reminder emails are successfully retried by retryFailedEmails().\n');

    console.log('======================================================');
    console.log('>>> ALL PHASE 3 TESTS PASSED SUCCESSFULLY! (4/4) <<<');
    console.log('======================================================\n');
  } catch (err) {
    console.error('TEST SUITE FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
    await prisma.$disconnect();
  }
}

runPhase3Tests();
