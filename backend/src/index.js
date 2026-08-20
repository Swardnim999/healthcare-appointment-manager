import "dotenv/config";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import doctorRoutes from "./routes/doctors.js";
import appointmentRoutes from "./routes/appointments.js";
import adminRoutes from "./routes/admin.js";
import calendarRoutes from "./routes/calendar.js";
import { startBackgroundJobs } from "./jobs/reminders.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/calendar", calendarRoutes);

// Central error handler as a last resort — keeps the API from crashing on
// unexpected errors (e.g. a malformed request body).
app.use((err, req, res, next) => {
  console.error("[unhandled]", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  startBackgroundJobs();
});
