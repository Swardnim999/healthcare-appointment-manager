import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, saveSession } from "../api";

export default function Register() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  function set(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Public self-registration is patient-only; doctors are created by admin.
      const data = await api("/auth/register", {
        method: "POST",
        body: { ...form, role: "PATIENT" },
      });
      saveSession(data.token, data.user);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-24 bg-white p-8 rounded-xl shadow">
      <h1 className="text-2xl font-bold mb-1 text-brand-700">Create patient account</h1>
      <p className="text-sm text-slate-500 mb-6">Doctor & admin accounts are created by the clinic.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input className="w-full border rounded px-3 py-2" placeholder="Full name" value={form.name} onChange={set("name")} required />
        <input className="w-full border rounded px-3 py-2" placeholder="Email" value={form.email} onChange={set("email")} required />
        <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password" value={form.password} onChange={set("password")} required />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded py-2 font-medium">
          {loading ? "Creating..." : "Register"}
        </button>
      </form>
      <p className="text-sm text-slate-500 mt-4">
        Already have an account? <Link className="text-brand-600" to="/login">Sign in</Link>
      </p>
    </div>
  );
}
