# System Design Write-Up

## 1. Double-Booking Prevention

The core guarantee is a **database-level unique constraint** on `(doctorId, slotStart)` in the
`Appointment` table (`prisma/schema.prisma`). This is what actually prevents double-booking, not
application logic — checking "is this slot free?" and then inserting are two separate operations,
and under concurrency two requests can both pass the check before either inserts (a classic
check-then-act race condition). By instead attempting the `INSERT` directly and letting the
database reject a duplicate with a unique-constraint violation (Postgres/SQLite error `P2002` in
Prisma), correctness is enforced atomically regardless of how many requests arrive at the exact
same millisecond.

The booking flow is two-phase to match the product requirement that patients fill a symptom form
*before* the slot is finalized:

1. **`POST /appointments/hold`** — inserts a row with `status=HELD` and a `holdExpiresAt`
   timestamp (default 5 minutes, configurable via `SLOT_HOLD_TTL_SECONDS`). This is the atomic
   operation that wins or loses the race.
2. **`POST /appointments/:id/confirm`** — the patient submits symptoms within the hold window;
   the row transitions to `BOOKED`. If the hold has expired, the row is deleted and the patient is
   asked to pick a slot again.

Expired holds are treated as free slots by the availability query (`GET
/doctors/:id/slots`, which filters `HELD` rows to only those with `holdExpiresAt > now()`), and
are lazily deleted the next time someone tries to hold that same slot. This avoids needing a
separate sweeper process while still releasing abandoned holds promptly.

## 2. Doctor Leave Conflict Handling

When an admin calls `POST /admin/doctors/:id/leave` with a date, the system:

1. Upserts a `DoctorLeave` record for that doctor/date (also consulted by the slots endpoint so
   no *new* bookings are offered on a leave day).
2. Queries all `BOOKED` appointments for that doctor on that date.
3. For each affected appointment: marks it `CANCELLED_BY_LEAVE` (a distinct status from a
   patient-initiated cancellation, useful for analytics and support), deletes the associated
   Google Calendar events for both patient and doctor, and sends the patient an email explaining
   the doctor is unavailable and inviting them to rebook.

This is done synchronously in the request so the admin gets an immediate count of how many
patients were affected — for a larger clinic this could be moved to a background job, but at the
expected scale (a single admin marking leave a few times a week) synchronous handling keeps the
flow simple and observable.

## 3. Slot Hold Mechanism

Rather than a separate cache layer (e.g. Redis) for holds, the hold is modeled as a first-class
row in the same `Appointment` table with `status=HELD`. This was a deliberate simplicity trade-off:
it means one source of truth for "is this slot available," one unique constraint doing all the
concurrency-safety work, and no risk of the cache and the database disagreeing. The cost is that a
crashed process mid-hold leaves a `HELD` row until its TTL passes and it's overwritten by the next
holder — acceptable for a clinic-scale system, but a high-throughput booking platform (e.g.
airline seats) would likely want a dedicated, faster-expiring cache for holds instead.

## 4. Notification Failure Handling

Every outbound email (`sendEmail` in `services/email.js`) is logged to an `EmailLog` row *before*
the send attempt, with status `RETRYING`, then updated to `SENT` or `FAILED` based on the result.
A cron job (`node-cron`, every 5 minutes, `jobs/reminders.js`) scans for `FAILED` rows with fewer
than 5 attempts and retries them, incrementing the attempt count each time. This means a transient
SMTP outage during, say, a booking confirmation doesn't silently lose the notification — it's
retried automatically over the following minutes, and the `EmailLog` table gives the admin an
audit trail of what was sent, retried, or is still failing.

The same job also sends due `MedicationReminder` rows, computed at prescription time by parsing
the frequency string (e.g. "twice daily" → 2 reminders/day for N days) into individual scheduled
reminder rows.

**LLM failure handling** follows the same philosophy: `services/llm.js` wraps every Claude API
call in a try/catch and returns a structured fallback object (with `_aiFailed: true`) instead of
throwing. Booking and visit-completion flows never fail because the LLM is down — the patient
still gets a (less personalized) summary, and the frontend surfaces a small notice when the
fallback was used.
