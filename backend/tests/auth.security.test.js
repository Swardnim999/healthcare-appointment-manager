import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTestServer, getTestFixtures, resetDatabase, createToken, JWT_SECRET } from './helpers.js';
import prisma from '../src/utils/db.js';

describe('Phase 4: Authorization & Security Tests', () => {
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

  it('rejects unauthenticated requests to protected endpoints with 401', async () => {
    const res = await fetch(`${baseUrl}/appointments/patient/mine`);
    assert.equal(res.status, 401);
  });

  it('rejects malformed authorization header with 401', async () => {
    const headers = [
      'Bearer',
      'Basic 12345',
      'InvalidHeaderFormat',
      'Bearer ',
    ];
    for (const h of headers) {
      const res = await fetch(`${baseUrl}/appointments/patient/mine`, {
        headers: { Authorization: h },
      });
      assert.equal(res.status, 401);
    }
  });

  it('rejects invalid, forged, or expired JWT with 401', async () => {
    const forgedToken = jwt.sign({ id: fixtures.patient1.id, role: 'ADMIN' }, 'wrong-secret');
    const expiredToken = jwt.sign(
      { id: fixtures.patient1.id, role: 'PATIENT', exp: Math.floor(Date.now() / 1000) - 60 },
      JWT_SECRET
    );

    const res1 = await fetch(`${baseUrl}/admin/appointments`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    assert.equal(res1.status, 401);

    const res2 = await fetch(`${baseUrl}/appointments/patient/mine`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(res2.status, 401);
  });

  it('prevents patient from accessing admin endpoints (403)', async () => {
    const res1 = await fetch(`${baseUrl}/admin/appointments`, {
      headers: { Authorization: `Bearer ${fixtures.patient1.token}` },
    });
    assert.equal(res1.status, 403);

    const res2 = await fetch(`${baseUrl}/admin/doctors/${fixtures.doctor.id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient1.token}` },
      body: JSON.stringify({ date: '2026-11-01', reason: 'Test' }),
    });
    assert.equal(res2.status, 403);
  });

  it("prevents patient from accessing or cancelling another patient's appointment (403)", async () => {
    // Create an appointment for Patient 1
    const appt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: new Date('2026-11-02T03:30:00.000Z'),
        slotEnd: new Date('2026-11-02T04:00:00.000Z'),
        status: 'BOOKED',
      },
    });

    // Patient 2 attempts to cancel Patient 1's appointment
    const cancelRes = await fetch(`${baseUrl}/appointments/${appt.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fixtures.patient2.token}` },
    });
    assert.equal(cancelRes.status, 403);

    // Patient 2 attempts to reschedule Patient 1's appointment
    const rescheduleRes = await fetch(`${baseUrl}/appointments/${appt.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.patient2.token}` },
      body: JSON.stringify({ newSlotStart: '2026-11-02T04:00:00.000Z' }),
    });
    assert.equal(rescheduleRes.status, 403);
  });

  it("prevents doctor from completing or modifying another doctor's appointment (403)", async () => {
    // Appointment assigned to Doctor 1
    const appt = await prisma.appointment.create({
      data: {
        doctorId: fixtures.doctor.id,
        patientId: fixtures.patient1.id,
        slotStart: new Date('2026-11-02T03:30:00.000Z'),
        slotEnd: new Date('2026-11-02T04:00:00.000Z'),
        status: 'BOOKED',
      },
    });

    // Doctor 2 attempts to complete Doctor 1's appointment
    const completeRes = await fetch(`${baseUrl}/appointments/${appt.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixtures.doctor2.token}` },
      body: JSON.stringify({ clinicalNotes: 'Hacked notes', prescription: [] }),
    });
    assert.equal(completeRes.status, 403);
  });

  it('prevents privilege escalation: public registration strictly enforces PATIENT role', async () => {
    const docEmail = `attacker.doc.${Date.now()}@test.com`;
    const regDoctor = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Attacker Doctor',
        email: docEmail,
        password: 'Password123!',
        role: 'DOCTOR',
      }),
    });
    assert.equal(regDoctor.status, 201);
    const dataDoc = await regDoctor.json();
    assert.equal(dataDoc.user.role, 'PATIENT');

    const adminEmail = `attacker.admin.${Date.now()}@test.com`;
    const regAdmin = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Attacker Admin',
        email: adminEmail,
        password: 'Password123!',
        role: 'ADMIN',
      }),
    });
    assert.equal(regAdmin.status, 201);
    const dataAdmin = await regAdmin.json();
    assert.equal(dataAdmin.user.role, 'PATIENT');
  });
});
