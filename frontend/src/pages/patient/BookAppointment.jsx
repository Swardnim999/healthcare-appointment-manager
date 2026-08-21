import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, getUser } from "../../api";
import Header from "../../components/Header.jsx";
import MobileBottomNav from "../../components/MobileBottomNav.jsx";
import { formatDoctorName, getDoctorInitials } from "../../utils/formatters";

const STEPS = { SEARCH: 0, SLOTS: 1, SYMPTOMS: 2, DONE: 3 };

export default function BookAppointment() {
  const user = getUser();
  const [step, setStep] = useState(STEPS.SEARCH);
  const [specialization, setSpecialization] = useState("");
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState([]);
  const [heldAppointment, setHeldAppointment] = useState(null);
  const [symptomText, setSymptomText] = useState("");
  const [preVisitSummary, setPreVisitSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const navigate = useNavigate();

  async function searchDoctors(e) {
    e?.preventDefault();
    try {
      const data = await api(`/doctors${specialization ? `?specialization=${encodeURIComponent(specialization)}` : ""}`);
      setDoctors(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    }
  }

  function checkCalendarStatus() {
    api("/calendar/status")
      .then((data) => setCalendarConnected(Boolean(data.connected)))
      .catch(() => setCalendarConnected(false));
  }

  useEffect(() => {
    searchDoctors();
    checkCalendarStatus();
  }, []);

  async function connectCalendar() {
    try {
      const data = await api("/calendar/oauth/url");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err.message || "Failed to initiate Google Calendar connection");
    }
  }

  async function loadSlots(doctor) {
    setSelectedDoctor(doctor);
    setError("");
    try {
      const data = await api(`/doctors/${doctor.id}/slots?date=${date}`);
      setSlots(data.slots || []);
      setStep(STEPS.SLOTS);
    } catch (err) {
      setError(err.message);
    }
  }

  async function reloadSlotsForDate(newDate) {
    setDate(newDate);
    if (selectedDoctor) {
      try {
        const data = await api(`/doctors/${selectedDoctor.id}/slots?date=${newDate}`);
        setSlots(data.slots || []);
      } catch (err) {
        setError(err.message);
      }
    }
  }

  async function holdSlot(slotIso) {
    setError("");
    setLoading(true);
    try {
      const data = await api("/appointments/hold", {
        method: "POST",
        body: { doctorId: selectedDoctor.id, slotStart: slotIso },
      });
      setHeldAppointment({ id: data.appointmentId, slotStart: slotIso, holdExpiresAt: data.holdExpiresAt });
      setStep(STEPS.SYMPTOMS);
    } catch (err) {
      setError(err.message);
      loadSlots(selectedDoctor);
    } finally {
      setLoading(false);
    }
  }

  async function confirmBooking(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api(`/appointments/${heldAppointment.id}/confirm`, {
        method: "POST",
        body: { symptomText },
      });
      setPreVisitSummary(data.preVisitSummary);
      setStep(STEPS.DONE);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-on-surface antialiased flex flex-col font-sans">
      <Header
        user={user}
        calendarConnected={calendarConnected}
        onConnectCalendar={connectCalendar}
        activeTab="book"
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-12">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-manrope font-bold text-2xl sm:text-3xl text-on-surface">Book an Appointment</h1>
            <p className="font-sans text-xs sm:text-sm text-on-surface-variant mt-1">
              Find a specialist and schedule a convenient time slot.
            </p>
          </div>
          <Link
            to="/patient"
            className="text-xs sm:text-sm text-on-surface-variant hover:text-primary font-medium flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Dashboard
          </Link>
        </div>

        {error && (
          <div className="bg-error-container text-error text-xs sm:text-sm p-4 rounded-2xl border border-error/30 mb-6 flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{error}</span>
          </div>
        )}

        {step === STEPS.SEARCH && (
          <div className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6">
            <form onSubmit={searchDoctors} className="flex gap-2 mb-6">
              <input
                className="flex-1 bg-surface-container-low border border-outline-variant/40 rounded-xl px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                placeholder="Search by specialization (e.g. Cardiology, Neurology)"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
              />
              <button
                type="submit"
                className="bg-primary hover:bg-primary-hover text-white font-sans text-sm font-medium rounded-xl px-5 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                Search
              </button>
            </form>

            <div className="space-y-3">
              {doctors.map((d) => (
                <div
                  key={d.id}
                  className="border border-outline-variant/30 bg-surface-container-low/50 hover:bg-surface-container-low rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-full bg-primary/15 text-primary flex items-center justify-center font-manrope font-bold text-sm">
                      {getDoctorInitials(d.user?.name)}
                    </div>
                    <div>
                      <p className="font-manrope font-bold text-sm text-on-surface">{formatDoctorName(d.user?.name)}</p>
                      <p className="font-sans text-xs text-on-surface-variant">{d.specialization}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => loadSlots(d)}
                    className="inline-flex items-center justify-center gap-1.5 text-primary hover:text-primary-hover font-sans text-xs sm:text-sm font-semibold bg-primary/10 hover:bg-primary/20 px-4 py-2 rounded-lg transition-colors"
                  >
                    <span>View available slots</span>
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </button>
                </div>
              ))}
              {doctors.length === 0 && (
                <div className="text-center py-8 text-on-surface-variant text-sm">
                  No doctors found matching your criteria.
                </div>
              )}
            </div>
          </div>
        )}

        {step === STEPS.SLOTS && (
          <div className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-outline-variant/20">
              <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-manrope font-bold text-sm">
                {getDoctorInitials(selectedDoctor.user?.name)}
              </div>
              <div>
                <p className="font-manrope font-bold text-base text-on-surface">{formatDoctorName(selectedDoctor.user?.name)}</p>
                <p className="font-sans text-xs text-on-surface-variant">{selectedDoctor.specialization}</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="block font-manrope font-semibold text-xs text-on-surface uppercase tracking-wider mb-1.5">
                Select Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => reloadSlotsForDate(e.target.value)}
                className="w-full sm:w-auto bg-surface-container-low border border-outline-variant/40 rounded-xl px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="block font-manrope font-semibold text-xs text-on-surface uppercase tracking-wider mb-2">
                Available Time Slots
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {slots.map((s) => (
                  <button
                    key={s}
                    disabled={loading}
                    onClick={() => holdSlot(s)}
                    className="p-3 bg-surface-container-low hover:bg-primary hover:text-white border border-outline-variant/30 hover:border-primary rounded-xl text-xs font-semibold text-on-surface transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </button>
                ))}
                {slots.length === 0 && (
                  <p className="text-on-surface-variant text-xs sm:text-sm col-span-3 sm:col-span-4 py-4 text-center bg-surface-container-low/50 rounded-xl">
                    No open slots on this date. Please pick another date.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-outline-variant/20 flex justify-between">
              <button
                onClick={() => setStep(STEPS.SEARCH)}
                className="text-xs sm:text-sm text-on-surface-variant hover:text-primary font-medium flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                Change Doctor
              </button>
            </div>
          </div>
        )}

        {step === STEPS.SYMPTOMS && (
          <div className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6">
            <div className="bg-amber-50 text-amber-800 text-xs sm:text-sm p-3.5 rounded-xl border border-amber-200 mb-5 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-amber-600">timer</span>
              <span>Your slot is temporarily held. Please describe your symptoms to confirm.</span>
            </div>

            <form onSubmit={confirmBooking} className="space-y-4">
              <div>
                <label className="block font-manrope font-semibold text-xs text-on-surface uppercase tracking-wider mb-1.5">
                  Reason for Visit / Symptoms Description
                </label>
                <textarea
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl p-3.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 h-32"
                  placeholder="Describe your symptoms in detail (e.g. onset, severity, triggers)..."
                  value={symptomText}
                  onChange={(e) => setSymptomText(e.target.value)}
                  required
                />
              </div>

              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() => setStep(STEPS.SLOTS)}
                  className="text-xs sm:text-sm text-on-surface-variant hover:text-primary font-medium"
                >
                  ← Back to slots
                </button>
                <button
                  disabled={loading}
                  className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-sans text-sm font-medium rounded-xl px-6 py-2.5 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {loading ? "Confirming & Analyzing..." : "Confirm Appointment"}
                </button>
              </div>
            </form>
          </div>
        )}

        {step === STEPS.DONE && (
          <div className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 text-center sm:text-left">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4 sm:mx-0 mx-auto">
              <span className="material-symbols-outlined text-[28px]">check_circle</span>
            </div>
            <h2 className="font-manrope font-bold text-xl sm:text-2xl text-on-surface mb-1">
              Appointment Confirmed!
            </h2>
            <p className="font-sans text-xs sm:text-sm text-on-surface-variant mb-6">
              A confirmation email and calendar event have been generated for you and your doctor.
            </p>

            {preVisitSummary && (
              <div className="bg-surface-container-low rounded-xl p-5 text-left border border-outline-variant/30 text-xs sm:text-sm space-y-2 mb-6">
                <div className="flex items-center gap-2 text-primary font-manrope font-bold text-xs uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[16px]">smart_toy</span>
                  AI Pre-Visit Assessment
                </div>
                <p>
                  <strong>Urgency Assessment:</strong>{" "}
                  <span className="inline-block px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold text-xs">
                    {preVisitSummary.urgency}
                  </span>
                </p>
                <p>
                  <strong>Chief Complaint:</strong> {preVisitSummary.chiefComplaint}
                </p>
                {preVisitSummary._aiFailed && (
                  <p className="text-amber-700 text-xs bg-amber-50 p-2 rounded border border-amber-200">
                    Note: AI analysis is temporarily unavailable — standard intake details recorded.
                  </p>
                )}
              </div>
            )}

            <button
              onClick={() => navigate("/patient")}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary-hover text-white font-sans text-sm font-medium rounded-xl transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span>Return to Dashboard</span>
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
        )}
      </main>

      <MobileBottomNav />
    </div>
  );
}
