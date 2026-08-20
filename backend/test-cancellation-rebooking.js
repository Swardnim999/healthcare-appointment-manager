import 'dotenv/config';
import prisma from './src/utils/db.js';
import jwt from 'jsonwebtoken';
import express from 'express';
import authRoutes from './src/routes/auth.js';
import doctorRoutes from './src/routes/doctors.js';
import appointmentRoutes from './src/routes/appointments.js';
import adminRoutes from './src/routes/admin.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/admin', adminRoutes);

let server;
const PORT = 5555;

async function runTests() {
  server = app.listen(PORT, () => console.log('Test server running on port ' + PORT));
  const baseUrl = 'http://localhost:' + PORT + '/api';

  try {
    console.log('\n--- STARTING CANCELLATION -> REBOOKING & CONCURRENCY VERIFICATION ---');

    // 1. Setup Doctor and Patients
    const doctor = await prisma.doctorProfile.findFirst({ include: { user: true } });
    if (!doctor) throw new Error('Doctor profile not found. Seed first.');
    console.log('Doctor found:', doctor.user.name, '(', doctor.id, ')');

    const patient1 = await prisma.user.findUnique({ where: { email: 'patient@clinic.test' } });
    const token1 = jwt.sign({ id: patient1.id, role: patient1.role, email: patient1.email, name: patient1.name }, process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production');

    // Create Patient 2 for testing
    let patient2 = await prisma.user.findUnique({ where: { email: 'patient2@clinic.test' } });
    if (!patient2) {
      patient2 = await prisma.user.create({
        data: {
          name: 'Second Test Patient',
          email: 'patient2@clinic.test',
          passwordHash: 'dummy',
          role: 'PATIENT'
        }
      });
    }
    const token2 = jwt.sign({ id: patient2.id, role: patient2.role, email: patient2.email, name: patient2.name }, process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production');

    const testSlot = new Date('2026-08-26T09:00:00.000Z').toISOString();

    // Clean any previous test appointments for this slot
    await prisma.emailLog.deleteMany({});
    await prisma.medicationReminder.deleteMany({});
    await prisma.appointment.deleteMany({ where: { doctorId: doctor.id, slotStart: new Date(testSlot) } });

    // Step A: Patient 1 holds the slot
    console.log('\n[TEST 1] Patient 1 holds slot:', testSlot);
    const holdRes1 = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: testSlot })
    });
    const holdData1 = await holdRes1.json();
    console.log('Hold Response 1 (Status ' + holdRes1.status + '):', holdData1);
    if (holdRes1.status !== 201) throw new Error('Patient 1 hold failed');

    // Step B: Simultaneous / duplicate hold attempt by Patient 2 -> MUST return 409
    console.log('\n[TEST 2] Patient 2 attempts to hold already held slot (Double-Booking Check):');
    const holdRes2 = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token2 },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: testSlot })
    });
    const holdData2 = await holdRes2.json();
    console.log('Hold Response 2 (Status ' + holdRes2.status + '):', holdData2);
    if (holdRes2.status !== 409) throw new Error('Double-booking hold prevention failed: expected 409, got ' + holdRes2.status);
    console.log('? Double-booking prevention on active hold passed!');

    // Step C: Patient 1 confirms the booking with symptoms
    console.log('\n[TEST 3] Patient 1 confirms booking with symptoms:');
    const confirmRes1 = await fetch(baseUrl + '/appointments/' + holdData1.appointmentId + '/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ symptomText: 'Frequent headaches and mild fever for 2 days' })
    });
    const confirmData1 = await confirmRes1.json();
    console.log('Confirm Response 1 (Status ' + confirmRes1.status + '): Status =', confirmData1.status, ', Urgency =', confirmData1.urgency);
    if (confirmRes1.status !== 200 || confirmData1.status !== 'BOOKED') throw new Error('Confirmation failed');
    console.log('? Booking confirmed successfully!');

    // Step D: Patient 1 cancels the appointment
    console.log('\n[TEST 4] Patient 1 cancels the appointment:');
    const cancelRes = await fetch(baseUrl + '/appointments/' + holdData1.appointmentId + '/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 }
    });
    const cancelData = await cancelRes.json();
    console.log('Cancel Response (Status ' + cancelRes.status + '):', cancelData);
    if (cancelRes.status !== 200 || cancelData.status !== 'CANCELLED') throw new Error('Cancellation failed');
    console.log('? Appointment successfully cancelled!');

    // Step E: Patient 2 now holds the previously cancelled slot (CRITICAL FIX VERIFICATION)
    console.log('\n[TEST 5] Patient 2 attempts to hold the CANCELLED slot (Rebooking Fix Verification):');
    const reholdRes = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token2 },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: testSlot })
    });
    const reholdData = await reholdRes.json();
    console.log('Re-hold Response (Status ' + reholdRes.status + '):', reholdData);
    if (reholdRes.status !== 201) throw new Error('Rebooking cancelled slot failed: expected 201, got ' + reholdRes.status);
    console.log('? Re-hold of cancelled slot succeeded! (Slot was cleanly released)');

    // Step F: Patient 2 confirms the rebooked appointment
    console.log('\n[TEST 6] Patient 2 confirms the rebooked appointment:');
    const reconfirmRes = await fetch(baseUrl + '/appointments/' + reholdData.appointmentId + '/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token2 },
      body: JSON.stringify({ symptomText: 'Persistent cough and sore throat' })
    });
    const reconfirmData = await reconfirmRes.json();
    console.log('Re-confirm Response (Status ' + reconfirmRes.status + '): Status =', reconfirmData.status);
    if (reconfirmRes.status !== 200 || reconfirmData.status !== 'BOOKED') throw new Error('Re-confirm failed');
    console.log('? Rebooked appointment confirmed successfully!');

    // Step G: Patient 1 attempts to hold the newly rebooked slot -> MUST return 409
    console.log('\n[TEST 7] Patient 1 attempts to hold newly rebooked slot:');
    const doubleBookRes = await fetch(baseUrl + '/appointments/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token1 },
      body: JSON.stringify({ doctorId: doctor.id, slotStart: testSlot })
    });
    const doubleBookData = await doubleBookRes.json();
    console.log('Double-Book Attempt (Status ' + doubleBookRes.status + '):', doubleBookData);
    if (doubleBookRes.status !== 409) throw new Error('Double-booking prevention failed on rebooked slot');
    console.log('? Double-booking prevention preserved on rebooked slot!');

    console.log('\n======================================================');
    console.log('>>> ALL PHASE 1 TESTS PASSED SUCCESSFULLY! <<<');
    console.log('======================================================\n');
  } catch (err) {
    console.error('TEST SUITE FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
    await prisma.$disconnect();
  }
}

runTests();
