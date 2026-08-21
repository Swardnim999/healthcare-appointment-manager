import { useEffect, useState } from "react";
import { api } from "../../api";

export default function DoctorDashboard() {
  const [appointments, setAppointments] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [notes, setNotes] = useState("");
  const [prescription, setPrescription] = useState([{ drug: "", dose: "", frequency: "once daily", days: 3 }]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);

  function load() {
    api("/appointments/doctor/mine").then(setAppointments).catch((e) => setError(e.message));
    api("/calendar/status").then((data) => setCalendarConnected(data.connected)).catch(() => setCalendarConnected(false));
  }
  useEffect(load, []);

  async function connectCalendar() {
    try {
      const data = await api("/calendar/oauth/url");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err.message || "Failed to initiate Google Calendar connection");
    }
  }

  function updateMed(i, field, value) {
    const next = [...prescription];
    next[i][field] = value;
    setPrescription(next);
  }
  function addMed() {
    setPrescription([...prescription, { drug: "", dose: "", frequency: "once daily", days: 3 }]);
  }

  async function submitVisit(id) {
    setSubmitting(true);
    setError("");
    try {
      await api(`/appointments/${id}/complete`, {
        method: "POST",
        body: { clinicalNotes: notes, prescription },
      });
      setActiveId(null);
      setNotes("");
      setPrescription([{ drug: "", dose: "", frequency: "once daily", days: 3 }]);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const urgencyColor = { HIGH: "bg-red-100 text-red-700", MEDIUM: "bg-amber-100 text-amber-700", LOW: "bg-green-100 text-green-700" };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-brand-700">Doctor Dashboard</h1>
        {calendarConnected ? (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded font-medium">
            ✓ Google Calendar Connected
          </span>
        ) : (
          <button
            onClick={connectCalendar}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded font-medium border border-slate-300 transition"
          >
            📅 Connect Google Calendar
          </button>
        )}
      </div>
      {error && <p className="text-red-600 mb-4">{error}</p>}

      <div className="space-y-4">
        {appointments.map((a) => (
          <div key={a.id} className="bg-white rounded-xl shadow p-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">{a.patient.name}</p>
                <p className="text-sm text-slate-500">{new Date(a.slotStart).toLocaleString()}</p>
              </div>
              {a.urgency && (
                <span className={`text-xs px-2 py-1 rounded font-medium ${urgencyColor[a.urgency] || ""}`}>
                  {a.urgency} urgency
                </span>
              )}
            </div>

            {a.preVisitSummary && (
              <div className="mt-3 bg-slate-50 rounded p-3 text-sm">
                <p><strong>Chief complaint:</strong> {a.preVisitSummary.chiefComplaint}</p>
                {a.preVisitSummary.suggestedQuestions?.length > 0 && (
                  <div className="mt-1">
                    <strong>Suggested questions:</strong>
                    <ul className="list-disc list-inside text-slate-600">
                      {a.preVisitSummary.suggestedQuestions.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {a.status === "BOOKED" && activeId !== a.id && (
              <button onClick={() => setActiveId(a.id)} className="mt-3 text-brand-600 text-sm font-medium hover:underline">
                + Add post-visit notes
              </button>
            )}
            {a.status === "COMPLETED" && (
              <span className="inline-block mt-3 text-xs px-2 py-1 rounded bg-green-100 text-green-700 font-medium">COMPLETED</span>
            )}

            {activeId === a.id && (
              <div className="mt-4 border-t pt-4 space-y-3">
                <textarea
                  className="w-full border rounded px-3 py-2 h-24 text-sm"
                  placeholder="Clinical notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                {prescription.map((p, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2">
                    <input className="border rounded px-2 py-1 text-sm" placeholder="Drug" value={p.drug} onChange={(e) => updateMed(i, "drug", e.target.value)} />
                    <input className="border rounded px-2 py-1 text-sm" placeholder="Dose" value={p.dose} onChange={(e) => updateMed(i, "dose", e.target.value)} />
                    <select className="border rounded px-2 py-1 text-sm" value={p.frequency} onChange={(e) => updateMed(i, "frequency", e.target.value)}>
                      <option>once daily</option>
                      <option>twice daily</option>
                      <option>three times daily</option>
                      <option>every 8 hours</option>
                    </select>
                    <input type="number" className="border rounded px-2 py-1 text-sm" placeholder="Days" value={p.days} onChange={(e) => updateMed(i, "days", e.target.value)} />
                  </div>
                ))}
                <button onClick={addMed} className="text-xs text-brand-600">+ Add medication</button>
                <div className="flex gap-2">
                  <button disabled={submitting} onClick={() => submitVisit(a.id)} className="bg-brand-600 text-white rounded px-4 py-2 text-sm font-medium">
                    {submitting ? "Submitting..." : "Complete Visit"}
                  </button>
                  <button onClick={() => setActiveId(null)} className="text-sm text-slate-500">Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {appointments.length === 0 && <p className="text-slate-500">No appointments yet.</p>}
      </div>
    </div>
  );
}
