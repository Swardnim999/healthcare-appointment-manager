import 'dotenv/config';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import prisma from '../src/utils/db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production';

export async function startTestServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}/api`;
      resolve({
        server,
        baseUrl,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

export function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET);
}

export async function getTestFixtures() {
  const admin = await prisma.user.upsert({
    where: { email: 'admin@clinic.test' },
    update: { role: 'ADMIN' },
    create: { name: 'Clinic Admin', email: 'admin@clinic.test', passwordHash: 'dummy', role: 'ADMIN' },
  });

  const doctorUser = await prisma.user.upsert({
    where: { email: 'dr.rao@clinic.test' },
    update: { role: 'DOCTOR' },
    create: { name: 'Dr. Anjali Rao', email: 'dr.rao@clinic.test', passwordHash: 'dummy', role: 'DOCTOR' },
  });

  const doctor = await prisma.doctorProfile.upsert({
    where: { userId: doctorUser.id },
    update: {},
    create: {
      userId: doctorUser.id,
      specialization: 'General Medicine',
      slotDurationMin: 30,
      workingHours: JSON.stringify({
        mon: ['09:00', '13:00'],
        tue: ['09:00', '13:00'],
        wed: ['09:00', '13:00'],
        thu: ['09:00', '13:00'],
        fri: ['09:00', '13:00'],
      }),
    },
    include: { user: true },
  });

  const doctorUser2 = await prisma.user.upsert({
    where: { email: 'dr.second@clinic.test' },
    update: { role: 'DOCTOR' },
    create: { name: 'Dr. Second Doctor', email: 'dr.second@clinic.test', passwordHash: 'dummy', role: 'DOCTOR' },
  });

  const doctor2 = await prisma.doctorProfile.upsert({
    where: { userId: doctorUser2.id },
    update: {},
    create: {
      userId: doctorUser2.id,
      specialization: 'Cardiology',
      slotDurationMin: 30,
      workingHours: JSON.stringify({
        mon: ['10:00', '14:00'],
        tue: ['10:00', '14:00'],
      }),
    },
    include: { user: true },
  });

  const patient1 = await prisma.user.upsert({
    where: { email: 'patient@clinic.test' },
    update: { role: 'PATIENT' },
    create: { name: 'Test Patient One', email: 'patient@clinic.test', passwordHash: 'dummy', role: 'PATIENT' },
  });

  const patient2 = await prisma.user.upsert({
    where: { email: 'patient2@clinic.test' },
    update: { role: 'PATIENT' },
    create: { name: 'Test Patient Two', email: 'patient2@clinic.test', passwordHash: 'dummy', role: 'PATIENT' },
  });

  return {
    admin: { ...admin, token: createToken({ id: admin.id, role: admin.role, email: admin.email, name: admin.name }) },
    doctor: { ...doctor, token: createToken({ id: doctor.user.id, role: 'DOCTOR', email: doctor.user.email, name: doctor.user.name }) },
    doctor2: { ...doctor2, token: createToken({ id: doctor2.user.id, role: 'DOCTOR', email: doctor2.user.email, name: doctor2.user.name }) },
    patient1: { ...patient1, token: createToken({ id: patient1.id, role: 'PATIENT', email: patient1.email, name: patient1.name }) },
    patient2: { ...patient2, token: createToken({ id: patient2.id, role: 'PATIENT', email: patient2.email, name: patient2.name }) },
  };
}

export async function resetDatabase() {
  await prisma.emailLog.deleteMany({});
  await prisma.medicationReminder.deleteMany({});
  await prisma.oAuthState.deleteMany({});
  await prisma.googleToken.deleteMany({});
  await prisma.doctorLeave.deleteMany({});
  await prisma.appointment.deleteMany({});
}
