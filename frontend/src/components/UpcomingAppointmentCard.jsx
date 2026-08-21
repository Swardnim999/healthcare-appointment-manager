import { Link } from "react-router-dom";
import { formatDoctorName, getDoctorInitials } from "../utils/formatters";

export default function UpcomingAppointmentCard({ appointment, onReschedule, onCancel, loading }) {
  if (loading) {
    return (
      <section className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 animate-pulse">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-surface-container-low"></div>
            <div className="space-y-2">
              <div className="h-5 w-44 bg-surface-container-low rounded"></div>
              <div className="h-4 w-28 bg-surface-container-low rounded"></div>
            </div>
          </div>
          <div className="h-6 w-20 bg-surface-container-low rounded-full"></div>
        </div>
        <div className="h-20 bg-surface-container-low rounded-xl mb-6"></div>
        <div className="flex gap-4">
          <div className="h-11 w-36 bg-surface-container-low rounded-lg"></div>
          <div className="h-11 w-28 bg-surface-container-low rounded-lg"></div>
        </div>
      </section>
    );
  }

  if (!appointment) {
    return (
      <section className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 text-center sm:text-left">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-[24px]">calendar_month</span>
            </div>
            <div>
              <h2 className="font-manrope font-semibold text-lg text-on-surface">No Upcoming Appointments</h2>
              <p className="font-sans text-xs sm:text-sm text-on-surface-variant">
                You have no pending visits scheduled at this time.
              </p>
            </div>
          </div>
          <Link
            to="/patient/book"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 h-11 bg-primary text-white font-sans text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            Book Appointment
          </Link>
        </div>
      </section>
    );
  }

  const doctorName = formatDoctorName(appointment.doctor?.user?.name);
  const specialization = appointment.doctor?.specialization || "General Consultation";
  const startDate = new Date(appointment.slotStart);
  const formattedDate = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const formattedTime = startDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const doctorInitials = getDoctorInitials(appointment.doctor?.user?.name);

  return (
    <section className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 transition-all hover:border-outline-variant/60">
      {/* Header with Title and Confirmed Badge */}
      <div className="flex flex-wrap justify-between items-start gap-2 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px]">calendar_month</span>
          </div>
          <div>
            <h2 className="font-manrope font-bold text-lg sm:text-xl text-on-surface">Upcoming Appointment</h2>
            <p className="font-sans text-xs sm:text-sm text-on-surface-variant">{specialization}</p>
          </div>
        </div>
        <span className="bg-primary/10 text-primary font-sans font-semibold text-xs px-3 py-1 rounded-full border border-primary/20 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          Confirmed
        </span>
      </div>

      {/* Doctor & Details Box */}
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center bg-surface-container-low/70 p-4 rounded-xl border border-outline-variant/30 mb-6">
        <div className="w-14 h-14 rounded-full bg-primary/15 text-primary border border-primary/20 flex items-center justify-center font-manrope font-bold text-base flex-shrink-0">
          {doctorInitials}
        </div>
        <div className="flex-1">
          <p className="font-manrope font-bold text-base text-on-surface">{doctorName}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-1.5 text-on-surface-variant text-xs sm:text-sm">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-secondary">schedule</span>
              <span className="font-medium text-on-surface">{formattedDate} at {formattedTime}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-primary">domain</span>
              <span>Clinic Consultation</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={() => onReschedule(appointment)}
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-6 h-11 bg-primary text-white font-sans text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 active:scale-[0.99]"
        >
          <span className="material-symbols-outlined text-[18px]">edit_calendar</span>
          Reschedule
        </button>
        <button
          type="button"
          onClick={() => onCancel(appointment)}
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-6 h-11 border border-outline-variant/60 text-on-surface-variant hover:text-error hover:bg-error-container/20 hover:border-error/40 font-sans text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-error/30 active:scale-[0.99]"
        >
          <span className="material-symbols-outlined text-[18px]">cancel</span>
          Cancel
        </button>
      </div>
    </section>
  );
}
