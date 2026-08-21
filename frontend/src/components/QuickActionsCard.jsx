import { Link } from "react-router-dom";

export default function QuickActionsCard() {
  function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <section className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 transition-all hover:border-outline-variant/60">
      <h3 className="font-manrope font-bold text-lg text-on-surface mb-4">Quick Actions</h3>
      <div className="flex flex-col gap-3">
        {/* Book New Appointment */}
        <Link
          to="/patient/book"
          className="w-full h-12 bg-primary text-white font-sans text-sm font-medium rounded-xl hover:bg-primary-hover transition-all flex items-center justify-center gap-2.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 active:scale-[0.99]"
        >
          <span className="material-symbols-outlined text-[20px]">add_circle</span>
          <span>Book New Appointment</span>
        </Link>

        {/* My Appointments */}
        <button
          type="button"
          onClick={() => scrollToSection("appointments")}
          className="w-full h-12 bg-surface-container-low hover:bg-surface-container text-on-surface font-sans text-sm font-medium rounded-xl border border-outline-variant/30 transition-all flex items-center justify-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 active:scale-[0.99]"
        >
          <span className="material-symbols-outlined text-[20px] text-secondary">calendar_today</span>
          <span>My Appointments</span>
        </button>

        {/* Medications */}
        <button
          type="button"
          onClick={() => scrollToSection("medications")}
          className="w-full h-12 bg-surface-container-low hover:bg-surface-container text-on-surface font-sans text-sm font-medium rounded-xl border border-outline-variant/30 transition-all flex items-center justify-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 active:scale-[0.99]"
        >
          <span className="material-symbols-outlined text-[20px] text-primary">medication</span>
          <span>Medications</span>
        </button>
      </div>
    </section>
  );
}
