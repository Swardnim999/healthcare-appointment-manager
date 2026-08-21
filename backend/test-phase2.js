import 'dotenv/config';
import prisma from './src/utils/db.js';
import jwt from 'jsonwebtoken';
import express from 'express';
import authRoutes from './src/routes/auth.js';
import doctorRoutes from './src/routes/doctors.js';
import appointmentRoutes, { parseFrequencyToTimesPerDay, calculateDailyDoseHours } from './src/routes/appointments.js';
import adminRoutes from './src/routes/admin.js';
import { sendEmail, retryFailedEmails } from './src/services/email.js';
import { sendDueMedicationReminders } from './src/jobs/reminders.js';
import { normalizeUrgency, generatePreVisitSummary } from './src/services/llm.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/admin', adminRoutes);

let server;
const PORT = 5556;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runPhase2Tests() {
  server = app.listen(PORT, '127.0.0.1', () => console.log('Phase 2 test server running on http://127.0.0.1:' + PORT));
  const baseUrl = 'http://127.0.0.1:' + PORT + '/api';

  try {
    console.log('\n======================================================');
    console.log('>>> RUNNING PHASE 2 CORRECTNESS & SECURITY SUITE <<<');
    console.log('======================================================\n');

    // -------------------------------------------------------------------------
    // TEST SUITE 1: EMAIL RETRY PERSISTENCE
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: EMAIL RETRY PERSISTENCE ---');
    
    // Clear existing logs
    await prisma.emailLog.deleteMany({});

    const originalRecipient = 'retry.test@clinic.test';
    const originalSubject = 'Important Pre-Op Instructions';
    const originalBody = 'Please do not consume food or liquids after midnight.';
    const originalType = 'REMINDER';

    // 1a. Create a failed email log simulating an SMTP outage
    const failedLog = await prisma.emailLog.create({
      data: {
        toEmail: originalRecipient,
        subject: originalSubject,
        body: originalBody,
        type: originalType,
        status: 'FAILED',
        attempts: 1,
        lastError: 'Connection refused (Simulated SMTP Error)',
      },
    });
    console.log('Logged failed email ID:', failedLog.id);
    assert(failedLog.subject === originalSubject, 'Subject should be persisted on creation');
    assert(failedLog.body === originalBody, 'Body should be persisted on creation');

    // 1b. Trigger email retry
    await retryFailedEmails();

    // 1c. Verify the original subject/body are preserved and status updated to SENT
    const retriedLog = await prisma.emailLog.findUnique({ where: { id: failedLog.id } });
    console.log('Retried Email Status:', retriedLog.status, 'Attempts:', retriedLog.attempts);
    assert(retriedLog.status === 'SENT', 'Retried email status should be SENT');
    assert(retriedLog.attempts === 2, 'Attempts should increment to 2');
    assert(retriedLog.toEmail === originalRecipient, 'Recipient must be preserved');
    assert(retriedLog.subject === originalSubject, 'Original subject must be preserved on retry');
    assert(retriedLog.body === originalBody, 'Original body must be preserved on retry');
    console.log('✔ Test 1 Passed: Email retry persistence verified.\n');

    // -------------------------------------------------------------------------
    // TEST SUITE 2: MEDICATION REMINDER CRON IDEMPOTENCY
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: MEDICATION REMINDER CRON IDEMPOTENCY ---');

    // Clean previous reminders & logs
    await prisma.emailLog.deleteMany({});
    await prisma.medicationReminder.deleteMany({});

    // Find or create doctor & patient
    let doctor = await prisma.doctorProfile.findFirst({ include: { user: true } });
    if (!doctor) throw new Error('Doctor profile not found. Run seed.');
    let patient = await prisma.user.findFirst({ where: { role: 'PATIENT' } });
    if (!patient) throw new Error('Patient not found. Run seed.');

    // Create an appointment for medication reminder test
    const dummySlotStart = new Date('2026-08-30T10:00:00.000Z');
    await prisma.appointment.deleteMany({ where: { doctorId: doctor.id, slotStart: dummySlotStart } });
    const appt = await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId: patient.id,
        slotStart: dummySlotStart,
        slotEnd: new Date('2026-08-30T10:30:00.000Z'),
        status: 'COMPLETED',
      },
    });

    // Create a due medication reminder (scheduled in the past)
    const pastDate = new Date(Date.now() - 60000);
    const reminder = await prisma.medicationReminder.create({
      data: {
        appointmentId: appt.id,
        drugName: 'Amoxicillin',
        dose: '500mg',
        scheduledAt: pastDate,
        sent: false,
      },
    });

    // Execute cron job repeatedly (5 sequential runs + concurrent triggers)
    console.log('Triggering sendDueMedicationReminders repeatedly (idempotency check)...');
    await Promise.all([
      sendDueMedicationReminders(),
      sendDueMedicationReminders(),
      sendDueMedicationReminders(),
    ]);
    await sendDueMedicationReminders();
    await sendDueMedicationReminders();

    // Verify reminder is marked sent: true
    const updatedReminder = await prisma.medicationReminder.findUnique({ where: { id: reminder.id } });
    assert(updatedReminder.sent === true, 'Reminder should be marked sent: true');

    // Verify only ONE email log was created
    const reminderEmailLogs = await prisma.emailLog.findMany({
      where: { appointmentId: appt.id, type: 'REMINDER' },
    });
    console.log('Reminder Email Logs created count:', reminderEmailLogs.length);
    assert(reminderEmailLogs.length === 1, `Expected exactly 1 email log, found ${reminderEmailLogs.length}`);
    console.log('✔ Test 2 Passed: Medication reminder cron is fully idempotent.\n');

    // -------------------------------------------------------------------------
    // TEST SUITE 3: PUBLIC REGISTRATION SECURITY
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: PUBLIC REGISTRATION SECURITY ---');

    const adminAttackerEmail = 'attacker_admin_' + Date.now() + '@test.test';
    const doctorAttackerEmail = 'attacker_doctor_' + Date.now() + '@test.test';

    // 3a. Attempt registration with role: ADMIN
    const regAdminRes = await fetch(baseUrl + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Malicious Admin',
        email: adminAttackerEmail,
        password: 'Password@123',
        role: 'ADMIN',
      }),
    });
    const regAdminData = await regAdminRes.json();
    assert(regAdminRes.status === 201, 'Registration should succeed');
    assert(regAdminData.user.role === 'PATIENT', `Expected role PATIENT, got ${regAdminData.user.role}`);
    
    // Check DB directly
    const userInDbAdmin = await prisma.user.findUnique({ where: { email: adminAttackerEmail } });
    assert(userInDbAdmin.role === 'PATIENT', `DB record must have role PATIENT, got ${userInDbAdmin.role}`);

    // Verify token cannot access admin routes
    const adminCheckRes = await fetch(baseUrl + '/admin/doctors', {
      headers: { Authorization: 'Bearer ' + regAdminData.token },
    });
    assert(adminCheckRes.status === 403, `Attacker with role ADMIN payload must be forbidden (403), got ${adminCheckRes.status}`);

    // 3b. Attempt registration with role: DOCTOR
    const regDocRes = await fetch(baseUrl + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Malicious Doctor',
        email: doctorAttackerEmail,
        password: 'Password@123',
        role: 'DOCTOR',
      }),
    });
    const regDocData = await regDocRes.json();
    assert(regDocRes.status === 201, 'Registration should succeed');
    assert(regDocData.user.role === 'PATIENT', `Expected role PATIENT, got ${regDocData.user.role}`);

    const userInDbDoc = await prisma.user.findUnique({ where: { email: doctorAttackerEmail } });
    assert(userInDbDoc.role === 'PATIENT', `DB record must have role PATIENT, got ${userInDbDoc.role}`);

    console.log('✔ Test 3 Passed: Public registration strictly creates PATIENT accounts.\n');

    // -------------------------------------------------------------------------
    // TEST SUITE 4: DOCTOR LEAVE CONFLICTS
    // -------------------------------------------------------------------------
    console.log('--- TEST 4: DOCTOR LEAVE CONFLICTS ---');

    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const adminToken = jwt.sign(
      { id: adminUser.id, role: adminUser.role, email: adminUser.email, name: adminUser.name },
      JWT_SECRET
    );
    const patientToken = jwt.sign(
      { id: patient.id, role: patient.role, email: patient.email, name: patient.name },
      JWT_SECRET
    );

    const leaveDate = '2026-09-15';
    const leaveSlotStart = new Date(`${leaveDate}T09:00:00.000Z`).toISOString();
    const leaveSlotStart2 = new Date(`${leaveDate}T09:30:00.000Z`).toISOString();

    // Clean up test slots & leaves for this date
    await prisma.doctorLeave.deleteMany({ where: { doctorId: doctor.id, date: leaveDate } });
    await prisma.appointment.deleteMany({ where: { doctorId: doctor.id, slotStart: { in: [new Date(leaveSlotStart), new Date(leaveSlotStart2)] } } });

    // 4a. Booked appointment + leave
    console.log('[4a] Testing booked appointment + leave cancellation...');
    const bookedAppt = await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId: patient.id,
        slotStart: new Date(leaveSlotStart),
        slotEnd: new Date(new Date(leaveSlotStart).getTime() + 30 * 60000),
        status: 'BOOKED',
      },
    });

    // 4b. Active hold + leave
    console.log('[4b] Testing active hold + leave invalidation...');
    const holdRes = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + patientToken },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: leaveSlotStart2 }),
    });
    const holdData = await holdRes.json();
    assert(holdRes.status === 201, 'Hold creation before leave should succeed');
    const heldApptId = holdData.appointmentId;

    // Admin marks doctor on leave for leaveDate
    console.log('Admin marking doctor on leave for date:', leaveDate);
    const leaveRes = await fetch(baseUrl + `/admin/doctors/${doctor.id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
      body: JSON.stringify({ date: leaveDate, reason: 'Annual Medical Conference' }),
    });
    const leaveData = await leaveRes.json();
    assert(leaveRes.status === 200, 'Marking leave should succeed');
    console.log('Leave response:', leaveData);

    // Verify 4a: Booked appointment status changed to CANCELLED_BY_LEAVE
    const updatedBookedAppt = await prisma.appointment.findUnique({ where: { id: bookedAppt.id } });
    assert(
      updatedBookedAppt.status === 'CANCELLED_BY_LEAVE',
      `Expected status CANCELLED_BY_LEAVE, got ${updatedBookedAppt.status}`
    );
    console.log('✔ 4a: Booked appointment successfully cancelled by leave.');

    // Verify 4b: Active hold appointment was invalidated / status CANCELLED_BY_LEAVE
    const updatedHeldAppt = await prisma.appointment.findUnique({ where: { id: heldApptId } });
    assert(
      updatedHeldAppt.status === 'CANCELLED_BY_LEAVE',
      `Expected hold status CANCELLED_BY_LEAVE, got ${updatedHeldAppt.status}`
    );
    console.log('✔ 4b: Active hold invalidated by doctor leave.');

    // 4c. Confirm hold after leave: attempt to confirm heldApptId -> MUST fail
    console.log('[4c] Testing confirm hold after leave...');
    const confirmHeldRes = await fetch(baseUrl + `/appointments/${heldApptId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + patientToken },
      body: JSON.stringify({ symptomText: 'Attempting to confirm held slot after leave' }),
    });
    console.log('Confirm held slot after leave status:', confirmHeldRes.status);
    assert(
      confirmHeldRes.status === 400 || confirmHeldRes.status === 409,
      `Expected 400 or 409 when confirming after leave, got ${confirmHeldRes.status}`
    );
    const finalHeldCheck = await prisma.appointment.findUnique({ where: { id: heldApptId } });
    assert(finalHeldCheck.status !== 'BOOKED', 'Appointment must not be BOOKED after doctor marked on leave');
    console.log('✔ 4c: Confirm hold after leave correctly rejected.');

    // 4d. New booking during leave: slots query returns available: false and hold is rejected
    console.log('[4d] Testing new booking during leave...');
    const slotsRes = await fetch(baseUrl + `/doctors/${doctor.id}/slots?date=${leaveDate}`);
    const slotsData = await slotsRes.json();
    console.log('Slots response for leave date:', slotsData);
    assert(slotsData.available === false, 'Slots query must indicate doctor is on leave');

    const newHoldDuringLeaveRes = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + patientToken },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: leaveSlotStart }),
    });
    console.log('Hold attempt during leave status:', newHoldDuringLeaveRes.status);
    assert(
      newHoldDuringLeaveRes.status === 409 || newHoldDuringLeaveRes.status === 400,
      `Expected 409 or 400 when holding during leave, got ${newHoldDuringLeaveRes.status}`
    );
    console.log('✔ 4d: New booking during leave correctly prevented.\n');

    // -------------------------------------------------------------------------
    // TEST SUITE 5: MEDICATION REMINDER TIME CALCULATION
    // -------------------------------------------------------------------------
    console.log('--- TEST 5: MEDICATION REMINDER TIME CALCULATION ---');

    // Test parser frequencies
    assert(parseFrequencyToTimesPerDay('once daily') === 1, 'once daily should be 1');
    assert(parseFrequencyToTimesPerDay('once a day') === 1, 'once a day should be 1');
    assert(parseFrequencyToTimesPerDay('twice daily') === 2, 'twice daily should be 2');
    assert(parseFrequencyToTimesPerDay('2 times a day') === 2, '2 times a day should be 2');
    assert(parseFrequencyToTimesPerDay('three times daily') === 3, 'three times daily should be 3');
    assert(parseFrequencyToTimesPerDay('thrice daily') === 3, 'thrice daily should be 3');
    assert(parseFrequencyToTimesPerDay('four times daily') === 4, 'four times daily should be 4');
    assert(parseFrequencyToTimesPerDay('4 times a day') === 4, '4 times a day should be 4');
    assert(parseFrequencyToTimesPerDay('every 8 hours') === 3, 'every 8 hours should be 3');
    assert(parseFrequencyToTimesPerDay('every 6 hours') === 4, 'every 6 hours should be 4');
    assert(parseFrequencyToTimesPerDay('every 12 hours') === 2, 'every 12 hours should be 2');

    // Test waking hours dose distribution (between 08:00 and 22:00)
    const hours1 = calculateDailyDoseHours(1);
    const hours2 = calculateDailyDoseHours(2);
    const hours3 = calculateDailyDoseHours(3);
    const hours4 = calculateDailyDoseHours(4);

    console.log('1 dose/day hours:', hours1);
    console.log('2 doses/day hours:', hours2);
    console.log('3 doses/day hours:', hours3);
    console.log('4 doses/day hours:', hours4);

    [hours1, hours2, hours3, hours4].forEach((hoursList, idx) => {
      assert(hoursList.length === idx + 1, `Expected ${idx + 1} dose hours`);
      hoursList.forEach((h) => {
        assert(h >= 8 && h <= 22, `Hour ${h} must be within waking hours (08:00 - 22:00)`);
      });
    });

    // Verify 4-times daily doses are spaced and within waking hours
    assert(JSON.stringify(hours1) === JSON.stringify([9]), 'Once daily should be 09:00');
    assert(JSON.stringify(hours2) === JSON.stringify([8, 20]), 'Twice daily should be 08:00, 20:00');
    assert(JSON.stringify(hours3) === JSON.stringify([8, 14, 20]), 'Three times daily should be 08:00, 14:00, 20:00');
    assert(JSON.stringify(hours4) === JSON.stringify([8, 12, 16, 20]), 'Four times daily should be 08:00, 12:00, 16:00, 20:00');
    console.log('✔ Test 5 Passed: Medication reminder time calculation verified.\n');

    // -------------------------------------------------------------------------
    // TEST SUITE 6: LLM URGENCY VALIDATION
    // -------------------------------------------------------------------------
    console.log('--- TEST 6: LLM URGENCY VALIDATION ---');

    // 6a. Valid values
    assert(normalizeUrgency('LOW') === 'LOW', 'LOW must normalize to LOW');
    assert(normalizeUrgency('MEDIUM') === 'MEDIUM', 'MEDIUM must normalize to MEDIUM');
    assert(normalizeUrgency('HIGH') === 'HIGH', 'HIGH must normalize to HIGH');

    // 6b. Lowercase / mixed case values
    assert(normalizeUrgency('low') === 'LOW', 'low must normalize to LOW');
    assert(normalizeUrgency('medium') === 'MEDIUM', 'medium must normalize to MEDIUM');
    assert(normalizeUrgency('high') === 'HIGH', 'high must normalize to HIGH');
    assert(normalizeUrgency('  High  ') === 'HIGH', '  High  must normalize to HIGH');

    // 6c. Invalid values fall back to MEDIUM
    assert(normalizeUrgency('CRITICAL') === 'MEDIUM', 'CRITICAL must fall back to MEDIUM');
    assert(normalizeUrgency('URGENT') === 'MEDIUM', 'URGENT must fall back to MEDIUM');
    assert(normalizeUrgency('UNKNOWN') === 'MEDIUM', 'UNKNOWN must fall back to MEDIUM');
    assert(normalizeUrgency('') === 'MEDIUM', 'Empty string must fall back to MEDIUM');
    assert(normalizeUrgency(null) === 'MEDIUM', 'null must fall back to MEDIUM');
    assert(normalizeUrgency(undefined) === 'MEDIUM', 'undefined must fall back to MEDIUM');
    assert(normalizeUrgency(123) === 'MEDIUM', 'number must fall back to MEDIUM');

    // 6d. Malformed & API failure fallback behavior in generatePreVisitSummary
    console.log('Testing generatePreVisitSummary fallback behavior when Anthropic API key is absent/mocked...');
    const summary = await generatePreVisitSummary('Persistent fever and chest tightness');
    console.log('Pre-visit summary result:', summary);
    assert(['LOW', 'MEDIUM', 'HIGH'].includes(summary.urgency), 'Pre-visit urgency must be LOW, MEDIUM, or HIGH');
    assert(typeof summary.chiefComplaint === 'string' && summary.chiefComplaint.length > 0, 'Chief complaint must be a string');
    assert(Array.isArray(summary.suggestedQuestions) && summary.suggestedQuestions.length === 3, 'Must contain 3 suggested questions');
    console.log('✔ Test 6 Passed: LLM urgency validation and fallback handling verified.\n');

    console.log('======================================================');
    console.log('>>> ALL PHASE 2 REGRESSION TESTS PASSED (6/6) <<<');
    console.log('======================================================\n');
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
    await prisma.$disconnect();
  }
}

runPhase2Tests();
