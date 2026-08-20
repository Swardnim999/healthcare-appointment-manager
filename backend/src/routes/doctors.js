import { Router } from "express";
import prisma from "../utils/db.js";

const router = Router();

// Public: search doctors by specialization
router.get("/", async (req, res) => {
  const { specialization } = req.query;
  const doctors = await prisma.doctorProfile.findMany({
    where: specialization
      ? { specialization: { contains: specialization } }
      : undefined,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json(doctors);
});

// Public: get available slots for a doctor on a given date (YYYY-MM-DD)
router.get("/:doctorId/slots", async (req, res) => {
  const { doctorId } = req.params;
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date query param (YYYY-MM-DD) required" });

  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) return res.status(404).json({ error: "Doctor not found" });

  // Leave check
  const onLeave = await prisma.doctorLeave.findUnique({
    where: { doctorId_date: { doctorId, date } },
  });
  if (onLeave) return res.json({ available: false, reason: "Doctor on leave", slots: [] });

  const workingHours = JSON.parse(doctor.workingHours);
  const dayKey = new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" }).toLowerCase().slice(0, 3);
  const hours = workingHours[dayKey];
  if (!hours) return res.json({ available: true, slots: [] });

  const [startH, startM] = hours[0].split(":").map(Number);
  const [endH, endM] = hours[1].split(":").map(Number);
  const slotMs = doctor.slotDurationMin * 60 * 1000;

  const dayStart = new Date(date + "T00:00:00");
  let cursor = new Date(dayStart);
  cursor.setHours(startH, startM, 0, 0);
  const end = new Date(dayStart);
  end.setHours(endH, endM, 0, 0);

  const allSlots = [];
  while (cursor.getTime() + slotMs <= end.getTime()) {
    allSlots.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + slotMs);
  }

  // Exclude slots that are BOOKED or currently HELD-and-not-expired
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);
  const taken = await prisma.appointment.findMany({
    where: {
      doctorId,
      slotStart: { gte: dayStart, lte: dayEnd },
      OR: [{ status: "BOOKED" }, { status: "HELD", holdExpiresAt: { gt: new Date() } }],
    },
    select: { slotStart: true },
  });
  const takenSet = new Set(taken.map((t) => t.slotStart.toISOString()));

  const freeSlots = allSlots
    .filter((s) => !takenSet.has(s.toISOString()))
    .map((s) => s.toISOString());

  res.json({ available: true, slots: freeSlots, slotDurationMin: doctor.slotDurationMin });
});

export default router;
