import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { logout } from "../api";

export default function Header({ user, calendarConnected, onConnectCalendar, activeTab = "dashboard" }) {
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  // Get user initials (e.g., "Alexander Hayes" -> "AH")
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "P";

  return (
    <header className="sticky top-0 z-40 w-full glass-nav border-b border-outline-variant/30">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between">
        {/* Left: Brand & Desktop Nav Links */}
        <div className="flex items-center gap-4 sm:gap-6">
          <Link to="/patient" className="flex items-center gap-2.5 group focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-lg p-1">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white shadow-sm transition-transform group-hover:scale-105">
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                health_and_safety
              </span>
            </div>
            <span className="font-manrope font-bold text-lg sm:text-xl text-primary tracking-tight">
              Vitalis Health
            </span>
          </Link>

          <div className="hidden md:block h-5 w-px bg-outline-variant/40 mx-1"></div>

          <nav className="hidden md:flex items-center gap-6" aria-label="Patient Navigation">
            <Link
              to="/patient"
              className={`font-sans text-sm font-medium transition-colors ${
                activeTab === "dashboard"
                  ? "text-primary font-semibold border-b-2 border-primary pb-0.5"
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              Dashboard
            </Link>
            <a
              href="#appointments"
              className="font-sans text-sm font-medium text-on-surface-variant hover:text-primary transition-colors"
            >
              Appointments
            </a>
            <a
              href="#medications"
              className="font-sans text-sm font-medium text-on-surface-variant hover:text-primary transition-colors"
            >
              Medications
            </a>
            <a
              href="#profile"
              onClick={(e) => {
                e.preventDefault();
                setProfileOpen(!profileOpen);
              }}
              className="font-sans text-sm font-medium text-on-surface-variant hover:text-primary transition-colors"
            >
              Profile
            </a>
          </nav>
        </div>

        {/* Right: Calendar Status, Notifications & Profile Avatar */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Google Calendar Status Pill / Action */}
          {calendarConnected ? (
            <div
              className="hidden lg:flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-full border border-outline-variant/40 text-xs text-on-surface-variant font-medium shadow-sm"
              title="Google Calendar is connected and synchronizing appointment events."
            >
              <span className="material-symbols-outlined text-secondary text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                cloud_sync
              </span>
              <span>Google Calendar Connected</span>
            </div>
          ) : (
            <button
              onClick={onConnectCalendar}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs bg-surface-container-low hover:bg-surface-container hover:border-primary/40 text-primary px-3 py-1.5 rounded-full border border-outline-variant/40 font-medium transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              title="Connect your Google Calendar to sync clinic visits"
            >
              <span className="material-symbols-outlined text-[16px]">calendar_today</span>
              <span>Connect Google Calendar</span>
            </button>
          )}

          {/* Notifications button */}
          <button
            type="button"
            className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container-low rounded-full transition-colors relative focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Notifications"
            onClick={() => alert("You have no unread notifications.")}
          >
            <span className="material-symbols-outlined text-[22px]">notifications</span>
            <span className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full ring-2 ring-white"></span>
          </button>

          {/* User Profile Avatar with Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen(!profileOpen)}
              className="w-9 h-9 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-manrope font-bold text-xs hover:ring-2 hover:ring-primary/30 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label="User Profile Menu"
              aria-expanded={profileOpen}
            >
              {initials}
            </button>

            {/* Profile Dropdown */}
            {profileOpen && (
              <div
                className="absolute right-0 mt-2 w-64 bg-surface rounded-xl shadow-modal border border-outline-variant/40 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                role="menu"
              >
                <div className="px-4 py-2.5 border-b border-outline-variant/20">
                  <p className="font-manrope font-semibold text-sm text-on-surface">{user?.name || "Patient"}</p>
                  <p className="font-sans text-xs text-on-surface-variant truncate">{user?.email || "patient@clinic.test"}</p>
                  <span className="inline-block mt-1.5 text-[11px] font-semibold tracking-wider uppercase px-2 py-0.5 bg-primary/10 text-primary rounded-md">
                    {user?.role || "PATIENT"}
                  </span>
                </div>

                <div className="p-2">
                  {!calendarConnected && (
                    <button
                      onClick={() => {
                        setProfileOpen(false);
                        onConnectCalendar();
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[16px] text-secondary">cloud_sync</span>
                      Connect Google Calendar
                    </button>
                  )}
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3 py-2 text-xs text-error hover:bg-error-container/30 rounded-lg transition-colors flex items-center gap-2 font-medium"
                    role="menuitem"
                  >
                    <span className="material-symbols-outlined text-[16px]">logout</span>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
