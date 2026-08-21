import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";

export default function PatientDashboard() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [calendarConnected, setCalendarConnected] = useState(false);

  // Reschedule modal state
  const [reschedulingAppt, setReschedulingAppt] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleSuccess, setRescheduleSuccess] = useState("");

  function loadAppointments() {
    setLoading(true);
    api("/appointments/patient/mine")
      .then(setAppointments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function checkCalendarStatus() {
    api("/calendar/status")
      .then((data) => setCalendarConnected(data.connected))
      .catch(() => setCalendarConnected(false));
  }

  useEffect(() => {
    loadAppointments();
    checkCalendarStatus();
  }, []);

  async function connectCalendar() {
    try {
      const data = await api("/calendar/oauth/url");
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err.message || "Failed to initiate Google Calendar connection");
    }
  }

  async function cancel(id) {
    if (!confirm("Cancel this appointment?")) return;
    try {
      await api(`/appointments/${id}/cancel`, { method: "POST" });
      setAppointments((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  function startReschedule(appt) {
    setReschedulingAppt(appt);
    setRescheduleError("");
    setRescheduleSuccess("");
    setSelectedSlot("");
    const defaultDate = appt.slotStart.slice(0, 10);
    setRescheduleDate(defaultDate);
    fetchSlotsForDate(appt.doctorId, defaultDate);
  }

  async function fetchSlotsForDate(doctorId, date) {
    if (!date || !doctorId) return;
    setLoadingSlots(true);
    setRescheduleError("");
    setSelectedSlot("");
    try {
      const data = await api(`/doctors/${doctorId}/slots?date=${date}`);
      if (!data.available) {
        setAvailableSlots([]);
        setRescheduleError(data.reason || "Doctor unavailable on this date");
      } else {
        setAvailableSlots(data.slots || []);
      }
    } catch (err) {
      setAvailableSlots([]);
      setRescheduleError(err.message);
    } finally {
      setLoadingSlots(false);
    }
  }

  async function confirmReschedule() {
    if (!selectedSlot) {
      setRescheduleError("Please select a new time slot");
      return;
    }
    setRescheduling(true);
    setRescheduleError("");
    try {
      await api(`/appointments/${reschedulingAppt.id}/reschedule`, {
        method: "POST",
        body: { newSlotStart: selectedSlot },
      });
      setRescheduleSuccess("Appointment rescheduled successfully!");
      setTimeout(() => {
        setReschedulingAppt(null);
        loadAppointments();
      }, 1000);
    } catch (err) {
      setRescheduleError(err.message);
    } finally {
      setRescheduling(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-700">My Appointments</h1>
          <div className="mt-1">
            {calendarConnected ? (
              <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">
                ✓ Google Calendar Connected
              </span>
            ) : (
              <button
                onClick={connectCalendar}
                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-medium border border-slate-300 transition"
              >
                📅 Connect Google Calendar
              </button>
            )}
          </div>
        </div>
        <Link to="/patient/book" className="bg-brand-600 hover:bg-brand-700 text-white rounded px-4 py-2 text-sm font-medium">
          + Book Appointment
        </Link>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600 mb-4">{error}</p>}

      <div className="space-y-4">
        {appointments.length === 0 && !loading && (
          <p className="text-slate-500">No appointments yet. Book one to get started.</p>
        )}
        {appointments.map((a) => (
          <div key={a.id} className="bg-white rounded-xl shadow p-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">Dr. {a.doctor.user.name}</p>
                <p className="text-sm text-slate-500">{new Date(a.slotStart).toLocaleString()}</p>
                <span className={`inline-block mt-2 text-xs px-2 py-1 rounded font-medium ${
                  a.status === "COMPLETED" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                }`}>
                  {a.status}
                </span>
              </div>
              {a.status === "BOOKED" && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => startReschedule(a)}
                    className="text-brand-600 text-sm font-medium hover:underline"
                  >
                    Reschedule
                  </button>
                  <button onClick={() => cancel(a.id)} className="text-red-600 text-sm hover:underline">
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {a.postVisitSummary && (
              <div className="mt-4 bg-slate-50 rounded p-3 text-sm">
                <p className="font-medium mb-1">Visit Summary</p>
                <p className="text-slate-700">{a.postVisitSummary.summary}</p>
                {a.postVisitSummary.medicationSchedule?.length > 0 && (
                  <ul className="mt-2 list-disc list-inside text-slate-600">
                    {a.postVisitSummary.medicationSchedule.map((m, i) => (
                      <li key={i}>{m.drug} — {m.instructions}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Reschedule Modal */}
      {reschedulingAppt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-slate-800">
              Reschedule Appointment with Dr. {reschedulingAppt.doctor.user.name}
            </h2>
            <p className="text-xs text-slate-500">
              Current Time: {new Date(reschedulingAppt.slotStart).toLocaleString()}
            </p>

            {rescheduleError && (
              <div className="p-3 bg-red-50 text-red-700 rounded text-sm">
                {rescheduleError}
              </div>
            )}

            {rescheduleSuccess && (
              <div className="p-3 bg-green-50 text-green-700 rounded text-sm font-medium">
                {rescheduleSuccess}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                Select New Date
              </label>
              <input
                type="date"
                className="w-full border rounded px-3 py-2 text-sm"
                value={rescheduleDate}
                onChange={(e) => {
                  setRescheduleDate(e.target.value);
                  fetchSlotsForDate(reschedulingAppt.doctorId, e.target.value);
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                Select Available Slot
              </label>
              {loadingSlots && <p className="text-xs text-slate-400">Loading available slots...</p>}
              {!loadingSlots && availableSlots.length === 0 && !rescheduleError && (
                <p className="text-xs text-slate-400">No open slots on this date. Please pick another date.</p>
              )}
              <div className="grid grid-cols-3 gap-2 max-h-44 overflow-y-auto pt-1">
                {availableSlots.map((slot) => {
                  const slotDate = new Date(slot);
                  const isSelected = selectedSlot === slot;
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`px-2 py-1.5 rounded text-xs font-medium border transition ${
                        isSelected
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {slotDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={rescheduling}
                onClick={() => setReschedulingAppt(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rescheduling || !selectedSlot}
                onClick={confirmReschedule}
                className="px-4 py-2 text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium rounded shadow"
              >
                {rescheduling ? "Rescheduling..." : "Confirm Reschedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
