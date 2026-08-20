import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, saveSession } from "../api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api("/auth/login", { method: "POST", body: { email, password } });
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
      <h1 className="text-2xl font-bold mb-1 text-brand-700">Sign in</h1>
      <p className="text-sm text-slate-500 mb-6">Clinic Appointment Manager</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          disabled={loading}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded py-2 font-medium"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p className="text-sm text-slate-500 mt-4">
        No account? <Link className="text-brand-600" to="/register">Register</Link>
      </p>
      <div className="text-xs text-slate-400 mt-6 border-t pt-4">
        Demo accounts (after seeding): <br />
        admin@clinic.test / Admin@123 <br />
        dr.rao@clinic.test / Doctor@123 <br />
        patient@clinic.test / Patient@123
      </div>
    </div>
  );
}
