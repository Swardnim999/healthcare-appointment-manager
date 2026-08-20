# Healthcare Appointment & Follow-up Manager

A clinic platform with separate portals for **patients**, **doctors**, and an **admin**. Patients
book appointments and submit symptoms in advance; an LLM generates a pre-visit summary with
urgency for the doctor; after the visit the doctor's notes are turned into a patient-friendly
summary; both sides are kept in sync via email and Google Calendar.

See [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) for the design write-up on double-booking prevention,
leave conflict handling, slot holds, and notification reliability.

---

## 1. Quick Start (local)

### Prerequisites
- Node.js 18+
- npm

### Backend

```bash
cd backend
npm install
cp .env.example .env        # fill in ANTHROPIC_API_KEY at minimum; everything else has safe dev defaults
npx prisma generate
npx prisma migrate dev --name init
npm run seed                # creates demo admin/doctor/patient accounts
npm run dev                 # http://localhost:5000
```

Demo accounts created by `npm run seed`:

| Role    | Email               | Password    |
|---------|---------------------|-------------|
| Admin   | admin@clinic.test   | Admin@123   |
| Doctor  | dr.rao@clinic.test  | Doctor@123  |
| Patient | patient@clinic.test | Patient@123 |

**Note on email:** if `SMTP_HOST` is left blank in `.env`, emails are logged to the backend
console instead of actually sent — this lets you demo the full flow without SMTP credentials. Fill
in `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` (e.g. a Gmail app password, or Mailgun/SendGrid SMTP) to
send real emails.

**Note on Google Calendar:** the app works fully without it connected — calendar sync is additive.
See section 4 below to enable it.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_URL, defaults to http://localhost:5000/api
npm run dev                 # http://localhost:5173
```

Open `http://localhost:5173`, log in with one of the seeded accounts above.

---

## 2. Database Schema

See [`backend/prisma/schema.prisma`](./backend/prisma/schema.prisma) for the full source of truth.
Summary:

- **User** — patient/doctor/admin, role-based
- **DoctorProfile** — specialization, slot duration, working hours (JSON per weekday)
- **DoctorLeave** — dates a doctor is unavailable (unique per doctor+date)
- **Appointment** — the central table. `status` is one of `HELD → BOOKED → COMPLETED`, or
  `CANCELLED` / `CANCELLED_BY_LEAVE`. Unique constraint on `(doctorId, slotStart)` prevents
  double-booking at the DB level. Stores the AI pre-visit summary, urgency, clinical notes,
  prescription, and AI post-visit summary.
- **MedicationReminder** — generated from the prescription's frequency at visit-completion time
- **EmailLog** — every notification attempt, with retry tracking
- **GoogleToken** — OAuth tokens per user, for calendar sync

---

## 3. API Reference

All authenticated routes expect `Authorization: Bearer <token>`.

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/auth/register` | public | Register as a patient |
| POST | `/api/auth/login` | public | Login, returns JWT |
| GET | `/api/doctors?specialization=` | public | Search doctors |
| GET | `/api/doctors/:id/slots?date=YYYY-MM-DD` | public | Available slots for a date |
| POST | `/api/appointments/hold` | patient | Reserve a slot (`{doctorId, slotStart}`) |
| POST | `/api/appointments/:id/confirm` | patient | Submit symptoms, finalize booking |
| GET | `/api/appointments/patient/mine` | patient | My appointments |
| POST | `/api/appointments/:id/cancel` | patient/doctor/admin | Cancel an appointment |
| GET | `/api/appointments/doctor/mine` | doctor | Upcoming appointments + AI pre-visit summary |
| POST | `/api/appointments/:id/complete` | doctor | Submit notes + prescription, generates AI summary |
| POST | `/api/admin/doctors` | admin | Create a doctor account + profile |
| GET | `/api/admin/doctors` | admin | List doctors |
| PATCH | `/api/admin/doctors/:id` | admin | Update doctor profile |
| POST | `/api/admin/doctors/:id/leave` | admin | Mark leave date, auto-cancels + notifies affected patients |
| GET | `/api/admin/analytics` | admin | Basic counts |
| GET | `/api/calendar/oauth/url` | any logged-in user | Get Google consent URL |
| GET | `/api/calendar/oauth/callback` | — | OAuth redirect target |

---

## 4. LLM Prompts

Both prompts are in [`backend/src/services/llm.js`](./backend/src/services/llm.js) and enforce a
strict JSON response shape so the output can be safely stored and rendered.

**Pre-visit summary** (system prompt + user prompt):
```
System: You are a clinical intake assistant. You NEVER diagnose. Respond with ONLY valid JSON...
User: Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint,
      and three suggested questions for the doctor. Symptoms: <symptoms>
```

**Post-visit summary:**
```
System: You are a medical communication assistant that explains clinical notes in plain,
        patient-friendly language. Respond with ONLY valid JSON...
User: Convert these clinical notes into a patient-friendly summary with medication schedule
      and follow-up steps: <notes> / <prescription>
```

If the Claude API call fails for any reason (missing key, network error, malformed response), both
functions return a structured fallback object with `_aiFailed: true` instead of throwing — booking
and visit-completion flows never break because of an LLM outage.

---

## 5. Google Calendar Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. Enable the **Google Calendar API** (APIs & Services → Library).
3. Configure the OAuth consent screen (External, add your test users' emails while in testing mode).
4. Create OAuth 2.0 credentials (APIs & Services → Credentials → Create Credentials → OAuth
   client ID → Web application).
5. Add an authorized redirect URI matching `GOOGLE_REDIRECT_URI` in `.env`, e.g.
   `http://localhost:5000/api/calendar/oauth/callback`.
6. Copy the Client ID and Client Secret into `backend/.env` (`GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`).
7. From the frontend (logged in as any user), call `GET /api/calendar/oauth/url`, open the
   returned URL, grant consent — tokens are stored against that user and calendar events will be
   created automatically on future bookings.

---

## 6. Deployment Notes

- **Backend**: Render/Railway — set the same env vars as `.env.example`. Switch
  `datasource db { provider = "sqlite" }` to `"postgresql"` in `schema.prisma` and set
  `DATABASE_URL` to a managed Postgres instance for production durability (SQLite's file-based
  storage doesn't survive most ephemeral-filesystem hosts).
- **Frontend**: Vercel — set `VITE_API_URL` to the deployed backend URL, build command
  `npm run build`, output directory `dist`.
- Remember to update `FRONTEND_URL` (backend CORS) and `GOOGLE_REDIRECT_URI` /
  authorized redirect URIs once you have production URLs.

---

## 7. Project Structure

```
healthcare-appointment-manager/
├── backend/
│   ├── prisma/schema.prisma       # DB schema
│   ├── prisma/seed.js             # demo data
│   └── src/
│       ├── index.js               # Express app entrypoint
│       ├── middleware/auth.js     # JWT auth + role guard
│       ├── routes/                # auth, doctors, appointments, admin, calendar
│       ├── services/              # llm.js, email.js, calendar.js
│       └── jobs/reminders.js      # cron: medication reminders + email retries
├── frontend/
│   └── src/
│       ├── pages/patient/         # search, book, my appointments
│       ├── pages/doctor/          # appointments + AI summary + post-visit form
│       └── pages/admin/           # doctor management, leave, analytics
├── SYSTEM_DESIGN.md
└── README.md
```
