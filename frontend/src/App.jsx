import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { getUser, logout } from "./api";

import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import PatientDashboard from "./pages/patient/Dashboard.jsx";
import BookAppointment from "./pages/patient/BookAppointment.jsx";
import DoctorDashboard from "./pages/doctor/Dashboard.jsx";
import AdminDashboard from "./pages/admin/Dashboard.jsx";

function Protected({ role, children }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

function Nav() {
  const user = getUser();
  const navigate = useNavigate();
  if (!user) return null;
  // Patient routes use the specialized VITALIS Health header
  if (user.role === "PATIENT") return null;
  return (
    <nav className="bg-brand-700 text-white px-6 py-3 flex justify-between items-center">
      <div className="font-semibold">🏥 Clinic Manager</div>
      <div className="flex items-center gap-4 text-sm">
        <span className="opacity-80">{user.name} · {user.role}</span>
        <button
          className="bg-brand-600 hover:bg-brand-500 px-3 py-1 rounded"
          onClick={() => { logout(); navigate("/login"); }}
        >
          Logout
        </button>
      </div>
    </nav>
  );
}

function Home() {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "PATIENT") return <Navigate to="/patient" replace />;
  if (user.role === "DOCTOR") return <Navigate to="/doctor" replace />;
  if (user.role === "ADMIN") return <Navigate to="/admin" replace />;
  return null;
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Nav />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<Home />} />
        <Route
          path="/patient"
          element={<Protected role="PATIENT"><PatientDashboard /></Protected>}
        />
        <Route
          path="/patient/book"
          element={<Protected role="PATIENT"><BookAppointment /></Protected>}
        />
        <Route
          path="/doctor"
          element={<Protected role="DOCTOR"><DoctorDashboard /></Protected>}
        />
        <Route
          path="/admin"
          element={<Protected role="ADMIN"><AdminDashboard /></Protected>}
        />
      </Routes>
    </div>
  );
}
