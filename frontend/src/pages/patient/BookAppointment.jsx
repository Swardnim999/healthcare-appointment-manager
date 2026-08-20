import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";

const STEPS = { SEARCH: 0, SLOTS: 1, SYMPTOMS: 2, DONE: 3 };

export default function BookAppointment() {
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
  const navigate = useNavigate();

  async function searchDoctors(e) {
    e?.preventDefault();
    const data = await api(`/doctors${specialization ? `?specialization=${encodeURIComponent(specialization)}` : ""}`);
    setDoctors(data);
  }

  useEffect(() => { searchDoctors(); }, []);

  async function loadSlots(doctor) {
    setSelectedDoctor(doctor);
    setError("");
    const data = await api(`/doctors/${doctor.id}/slots?date=${date}`);
    setSlots(data.slots || []);
    setStep(STEPS.SLOTS);
  }

  async function reloadSlotsForDate(newDate) {
    setDate(newDate);
    if (selectedDoctor) {
      const data = await api(`/doctors/${selectedDoctor.id}/slots?date=${newDate}`);
      setSlots(data.slots || []);
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
      // e.g. 409 — someone else grabbed this slot first (concurrency-safe rejection)
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
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-brand-700 mb-6">Book an Appointment</h1>

      {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded mb-4">{error}</div>}

      {step === STEPS.SEARCH && (
        <div className="bg-white rounded-xl shadow p-6">
          <form onSubmit={searchDoctors} className="flex gap-2 mb-4">
            <input
              className="flex-1 border rounded px-3 py-2"
              placeholder="Search by specialization (e.g. Cardiology)"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
            />
            <button className="bg-brand-600 text-white rounded px-4">Search</button>
          </form>
          <div className="space-y-3">
            {doctors.map((d) => (
              <div key={d.id} className="border rounded-lg p-4 flex justify-between items-center">
                <div>
                  <p className="font-semibold">Dr. {d.user.name}</p>
                  <p className="text-sm text-slate-500">{d.specialization}</p>
                </div>
                <button onClick={() => loadSlots(d)} className="text-brand-600 text-sm font-medium hover:underline">
                  View slots →
                </button>
              </div>
            ))}
            {doctors.length === 0 && <p className="text-slate-500 text-sm">No doctors found.</p>}
          </div>
        </div>
      )}

      {step === STEPS.SLOTS && (
        <div className="bg-white rounded-xl shadow p-6">
          <p className="font-semibold mb-2">Dr. {selectedDoctor.user.name} — {selectedDoctor.specialization}</p>
          <input
            type="date"
            value={date}
            onChange={(e) => reloadSlotsForDate(e.target.value)}
            className="border rounded px-3 py-2 mb-4"
          />
          <div className="grid grid-cols-3 gap-2">
            {slots.map((s) => (
              <button
                key={s}
                disabled={loading}
                onClick={() => holdSlot(s)}
                className="border rounded py-2 text-sm hover:bg-brand-50 hover:border-brand-500"
              >
                {new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
            {slots.length === 0 && <p className="text-slate-500 text-sm col-span-3">No open slots on this date.</p>}
          </div>
          <button onClick={() => setStep(STEPS.SEARCH)} className="text-sm text-slate-500 mt-4">← Back</button>
        </div>
      )}

      {step === STEPS.SYMPTOMS && (
        <div className="bg-white rounded-xl shadow p-6">
          <p className="text-sm text-amber-600 mb-3">
            Your slot is held for a few minutes — please complete this form to confirm.
          </p>
          <form onSubmit={confirmBooking} className="space-y-4">
            <textarea
              className="w-full border rounded px-3 py-2 h-32"
              placeholder="Describe your symptoms in detail..."
              value={symptomText}
              onChange={(e) => setSymptomText(e.target.value)}
              required
            />
            <button disabled={loading} className="bg-brand-600 text-white rounded px-4 py-2 font-medium">
              {loading ? "Confirming..." : "Confirm Appointment"}
            </button>
          </form>
        </div>
      )}

      {step === STEPS.DONE && (
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-bold text-green-700 mb-2">✅ Appointment Confirmed</h2>
          <p className="text-sm text-slate-500 mb-4">
            A confirmation email and calendar invite have been sent to you and the doctor.
          </p>
          {preVisitSummary && (
            <div className="bg-slate-50 rounded p-4 text-sm">
              <p><strong>AI Urgency Assessment:</strong> {preVisitSummary.urgency}</p>
              <p className="mt-1"><strong>Chief Complaint:</strong> {preVisitSummary.chiefComplaint}</p>
              {preVisitSummary._aiFailed && (
                <p className="text-amber-600 mt-2">Note: AI summary generation is temporarily unavailable — a basic fallback summary was used instead.</p>
              )}
            </div>
          )}
          <button onClick={() => navigate("/patient")} className="mt-4 bg-brand-600 text-white rounded px-4 py-2">
            Go to My Appointments
          </button>
        </div>
      )}
    </div>
  );
}
