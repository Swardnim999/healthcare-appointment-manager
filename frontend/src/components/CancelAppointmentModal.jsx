import { useEffect } from "react";
import { formatDoctorName } from "../utils/formatters";

export default function CancelAppointmentModal({
  appointment,
  cancelling,
  cancelError,
  onConfirmCancel,
  onClose,
}) {
  if (!appointment) return null;

  const doctorName = formatDoctorName(appointment.doctor?.user?.name);
  const specialization = appointment.doctor?.specialization || "Clinical Consultation";
  const startDate = new Date(appointment.slotStart);
  const formattedDateTime = startDate.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Handle Escape key to close modal
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && !cancelling) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelling, onClose]);

  return (
    <div
      className="fixed inset-0 bg-on-surface/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !cancelling) {
          onClose();
        }
      }}
    >
      <div className="bg-surface rounded-2xl max-w-md w-full p-6 sm:p-7 shadow-modal border border-outline-variant/40 space-y-5">
        {/* Modal Header */}
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-error-container/50 text-error flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-[22px]">event_busy</span>
            </div>
            <div>
              <h2 id="cancel-modal-title" className="font-manrope font-bold text-lg text-on-surface">
                Cancel appointment?
              </h2>
              <p className="font-sans text-xs text-on-surface-variant mt-0.5">
                Please confirm if you wish to release this visit.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={cancelling}
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container-low transition-colors disabled:opacity-50"
            aria-label="Close modal"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Appointment Details Box */}
        <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/30 space-y-1.5">
          <p className="font-manrope font-bold text-sm text-on-surface">{doctorName}</p>
          <p className="font-sans text-xs text-on-surface-variant">{specialization}</p>
          <div className="flex items-center gap-1.5 text-xs text-secondary font-medium pt-1">
            <span className="material-symbols-outlined text-[16px]">schedule</span>
            <span>{formattedDateTime}</span>
          </div>
        </div>

        {/* Warning text */}
        <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200/80 text-amber-900 text-xs sm:text-sm flex items-start gap-2.5">
          <span className="material-symbols-outlined text-[18px] text-amber-700 flex-shrink-0 mt-0.5">warning</span>
          <p className="leading-relaxed">
            This appointment will be cancelled and the reserved slot will become available again.
          </p>
        </div>

        {/* Inline Error Message on failure */}
        {cancelError && (
          <div className="p-3 bg-error-container/70 text-error rounded-xl text-xs sm:text-sm border border-error/30 flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] flex-shrink-0">error</span>
            <span>{cancelError}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col-reverse sm:flex-row justify-end items-center gap-3 pt-2 border-t border-outline-variant/20">
          <button
            type="button"
            disabled={cancelling}
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-low rounded-xl transition-colors font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          >
            Keep Appointment
          </button>
          <button
            type="button"
            disabled={cancelling}
            onClick={onConfirmCancel}
            className="w-full sm:w-auto px-5 py-2.5 text-sm bg-error hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-xl shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-error/40 active:scale-[0.99] inline-flex items-center justify-center gap-2"
          >
            {cancelling && (
              <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
            )}
            <span>{cancelling ? "Cancelling..." : "Cancel Appointment"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
