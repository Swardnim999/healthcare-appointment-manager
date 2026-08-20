import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPass = await bcrypt.hash("Admin@123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@clinic.test" },
    update: {},
    create: { name: "Clinic Admin", email: "admin@clinic.test", passwordHash: adminPass, role: "ADMIN" },
  });

  const docPass = await bcrypt.hash("Doctor@123", 10);
  const docUser = await prisma.user.upsert({
    where: { email: "dr.rao@clinic.test" },
    update: {},
    create: { name: "Dr. Anjali Rao", email: "dr.rao@clinic.test", passwordHash: docPass, role: "DOCTOR" },
  });

  await prisma.doctorProfile.upsert({
    where: { userId: docUser.id },
    update: {},
    create: {
      userId: docUser.id,
      specialization: "General Medicine",
      slotDurationMin: 30,
      workingHours: JSON.stringify({
        mon: ["09:00", "13:00"],
        tue: ["09:00", "13:00"],
        wed: ["09:00", "13:00"],
        thu: ["09:00", "13:00"],
        fri: ["09:00", "13:00"],
      }),
    },
  });

  const patientPass = await bcrypt.hash("Patient@123", 10);
  await prisma.user.upsert({
    where: { email: "patient@clinic.test" },
    update: {},
    create: { name: "Test Patient", email: "patient@clinic.test", passwordHash: patientPass, role: "PATIENT" },
  });

  console.log("Seeded: admin@clinic.test / Admin@123");
  console.log("Seeded: dr.rao@clinic.test / Doctor@123");
  console.log("Seeded: patient@clinic.test / Patient@123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
