import { useEffect, useState } from "react";
import { api } from "../../api";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function AdminDashboard() {
  const [doctors, setDoctors] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", email: "", password: "", specialization: "",
    slotDurationMin: 30,
    activeDays: ["mon", "tue", "wed", "thu", "fri"],
    startTime: "09:00", endTime: "17:00",
  });
  const [leaveForm, setLeaveForm] = useState({ doctorId: "", date: "", reason: "" });
  const [leaveMsg, setLeaveMsg] = useState("");

  function load() {
    api("/admin/doctors").then(setDoctors).catch((e) => setError(e.message));
    api("/admin/analytics").then(setAnalytics).catch(() => {});
  }
  useEffect(load, []);

  function set(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }
  function toggleDay(day) {
    setForm((f) => ({
      ...f,
      activeDays: f.activeDays.includes(day) ? f.activeDays.filter((d) => d !== day) : [...f.activeDays, day],
    }));
  }

  async function createDoctor(e) {
    e.preventDefault();
    setError("");
    const workingHours = {};
    form.activeDays.forEach((d) => { workingHours[d] = [form.startTime, form.endTime]; });
    try {
      await api("/admin/doctors", {
        method: "POST",
        body: {
          name: form.name, email: form.email, password: form.password,
          specialization: form.specialization, slotDurationMin: Number(form.slotDurationMin),
          workingHours,
        },
      });
      setForm({ ...form, name: "", email: "", password: "", specialization: "" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function markLeave(e) {
    e.preventDefault();
    setLeaveMsg("");
    try {
      const data = await api(`/admin/doctors/${leaveForm.doctorId}/leave`, {
        method: "POST",
        body: { date: leaveForm.date, reason: leaveForm.reason },
      });
      setLeaveMsg(`Leave marked. ${data.affectedAppointments} affected patient(s) notified by email.`);
      load();
    } catch (err) {
      setLeaveMsg(err.message);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold text-brand-700">Admin Dashboard</h1>
      {error && <p className="text-red-600">{error}</p>}

      {analytics && (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Patients" value={analytics.totalPatients} />
          <Stat label="Doctors" value={analytics.totalDoctors} />
          <Stat label="Appointments" value={analytics.totalAppointments} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="font-semibold mb-4">Add Doctor</h2>
        <form onSubmit={createDoctor} className="grid grid-cols-2 gap-3">
          <input className="border rounded px-3 py-2" placeholder="Name" value={form.name} onChange={set("name")} required />
          <input className="border rounded px-3 py-2" placeholder="Email" value={form.email} onChange={set("email")} required />
          <input className="border rounded px-3 py-2" placeholder="Password" type="password" value={form.password} onChange={set("password")} required />
          <input className="border rounded px-3 py-2" placeholder="Specialization" value={form.specialization} onChange={set("specialization")} required />
          <input className="border rounded px-3 py-2" placeholder="Slot duration (min)" type="number" value={form.slotDurationMin} onChange={set("slotDurationMin")} />
          <div className="flex gap-2 items-center text-sm">
            <input className="border rounded px-2 py-1 w-24" type="time" value={form.startTime} onChange={set("startTime")} />
            <span>to</span>
            <input className="border rounded px-2 py-1 w-24" type="time" value={form.endTime} onChange={set("endTime")} />
          </div>
          <div className="col-span-2 flex gap-2 flex-wrap">
            {DAYS.map((d) => (
              <label key={d} className="text-xs flex items-center gap-1 border rounded px-2 py-1">
                <input type="checkbox" checked={form.activeDays.includes(d)} onChange={() => toggleDay(d)} />
                {d}
              </label>
            ))}
          </div>
          <button className="col-span-2 bg-brand-600 text-white rounded py-2 font-medium">Create Doctor</button>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="font-semibold mb-4">Mark Doctor on Leave</h2>
        <p className="text-xs text-slate-500 mb-3">
          Existing bookings on that date are auto-cancelled and affected patients are notified by email.
        </p>
        <form onSubmit={markLeave} className="grid grid-cols-3 gap-3">
          <select className="border rounded px-3 py-2" value={leaveForm.doctorId} onChange={(e) => setLeaveForm({ ...leaveForm, doctorId: e.target.value })} required>
            <option value="">Select doctor</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.user.name}</option>)}
          </select>
          <input className="border rounded px-3 py-2" type="date" value={leaveForm.date} onChange={(e) => setLeaveForm({ ...leaveForm, date: e.target.value })} required />
          <input className="border rounded px-3 py-2" placeholder="Reason (optional)" value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} />
          <button className="col-span-3 bg-red-600 hover:bg-red-700 text-white rounded py-2 font-medium">Mark Leave</button>
        </form>
        {leaveMsg && <p className="text-sm text-slate-600 mt-3">{leaveMsg}</p>}
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="font-semibold mb-4">Doctors</h2>
        <div className="space-y-2">
          {doctors.map((d) => (
            <div key={d.id} className="flex justify-between border-b py-2 text-sm">
              <span>Dr. {d.user.name} — {d.specialization}</span>
              <span className="text-slate-500">{d.leaves.length} leave day(s)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-white rounded-xl shadow p-4 text-center">
      <p className="text-2xl font-bold text-brand-700">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
