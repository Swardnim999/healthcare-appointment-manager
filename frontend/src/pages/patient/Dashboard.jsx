import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";

export default function PatientDashboard() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/appointments/patient/mine")
      .then(setAppointments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function cancel(id) {
    if (!confirm("Cancel this appointment?")) return;
    await api(`/appointments/${id}/cancel`, { method: "POST" });
    setAppointments((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-brand-700">My Appointments</h1>
        <Link to="/patient/book" className="bg-brand-600 hover:bg-brand-700 text-white rounded px-4 py-2 text-sm font-medium">
          + Book Appointment
        </Link>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600">{error}</p>}

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
                <button onClick={() => cancel(a.id)} className="text-red-600 text-sm hover:underline">
                  Cancel
                </button>
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
    </div>
  );
}
