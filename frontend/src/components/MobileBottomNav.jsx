import { Link, useLocation } from "react-router-dom";

export default function MobileBottomNav() {
  const location = useLocation();
  const isDashboard = location.pathname === "/patient";
  const isBooking = location.pathname === "/patient/book";

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 w-full z-40 bg-surface/95 backdrop-blur-md border-t border-outline-variant/30 flex justify-around items-center h-16 px-2 shadow-[0_-4px_12px_rgba(0,0,0,0.03)]"
      aria-label="Mobile Navigation"
    >
      <Link
        to="/patient"
        className={`flex flex-col items-center justify-center w-full h-full py-1 transition-colors ${
          isDashboard ? "text-primary font-semibold" : "text-on-surface-variant hover:text-primary"
        }`}
      >
        <span
          className="material-symbols-outlined text-[22px]"
          style={isDashboard ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          dashboard
        </span>
        <span className="font-sans text-[11px] mt-0.5">Dashboard</span>
      </Link>

      <a
        href="#appointments"
        className="flex flex-col items-center justify-center w-full h-full py-1 text-on-surface-variant hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-[22px]">event</span>
        <span className="font-sans text-[11px] mt-0.5">Appts</span>
      </a>

      <Link
        to="/patient/book"
        className={`flex flex-col items-center justify-center w-full h-full py-1 transition-colors ${
          isBooking ? "text-primary font-semibold" : "text-on-surface-variant hover:text-primary"
        }`}
      >
        <span
          className="material-symbols-outlined text-[22px]"
          style={isBooking ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          add_circle
        </span>
        <span className="font-sans text-[11px] mt-0.5">Book</span>
      </Link>

      <a
        href="#medications"
        className="flex flex-col items-center justify-center w-full h-full py-1 text-on-surface-variant hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-[22px]">medication</span>
        <span className="font-sans text-[11px] mt-0.5">Meds</span>
      </a>
    </nav>
  );
}
