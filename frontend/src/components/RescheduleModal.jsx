import { useEffect } from "react";
import { formatDoctorName } from "../utils/formatters";

export default function RescheduleModal({
  appointment,
  rescheduleDate,
  onDateChange,
  availableSlots = [],
  selectedSlot,
  onSelectSlot,
  loadingSlots,
  rescheduleError,
  rescheduleSuccess,
  rescheduling,
  onConfirm,
  onClose,
}) {
  if (!appointment) return null;

  const doctorName = formatDoctorName(appointment.doctor?.user?.name);
  const currentFormattedTime = new Date(appointment.slotStart).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Handle Escape key to close modal
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && !rescheduling) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [rescheduling, onClose]);

  return (
    <div
      className="fixed inset-0 bg-on-surface/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !rescheduling) {
          onClose();
        }
      }}
    >
      <div className="bg-surface rounded-2xl max-w-md w-full p-6 sm:p-7 shadow-modal border border-outline-variant/40 space-y-5">
        {/* Modal Header */}
        <div className="flex justify-between items-start">
          <div>
            <h2 id="reschedule-modal-title" className="font-manrope font-bold text-lg text-on-surface">
              Reschedule Appointment
            </h2>
            <p className="font-sans text-xs sm:text-sm text-on-surface-variant mt-0.5">
              With {doctorName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container-low transition-colors"
            aria-label="Close modal"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Current Time Badge */}
        <div className="bg-surface-container-low p-3 rounded-xl border border-outline-variant/30 text-xs text-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary text-[16px]">schedule</span>
          <span>
            Current: <strong>{currentFormattedTime}</strong>
          </span>
        </div>

        {/* Feedback Banners */}
        {rescheduleError && (
          <div className="p-3 bg-error-container/70 text-error rounded-xl text-xs sm:text-sm border border-error/30 flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] flex-shrink-0">error</span>
            <span>{rescheduleError}</span>
          </div>
        )}

        {rescheduleSuccess && (
          <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs sm:text-sm border border-emerald-200 flex items-start gap-2 font-medium">
            <span className="material-symbols-outlined text-[18px] text-emerald-600 flex-shrink-0">check_circle</span>
            <span>{rescheduleSuccess}</span>
          </div>
        )}

        {/* Date Selector */}
        <div>
          <label className="block font-manrope font-semibold text-xs text-on-surface uppercase tracking-wider mb-1.5">
            Select New Date
          </label>
          <input
            type="date"
            className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
            value={rescheduleDate}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </div>

        {/* Available Slots */}
        <div>
          <label className="block font-manrope font-semibold text-xs text-on-surface uppercase tracking-wider mb-1.5">
            Select Available Slot
          </label>

          {loadingSlots && (
            <div className="py-6 text-center text-xs text-on-surface-variant flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[18px] animate-spin text-primary">progress_activity</span>
              <span>Loading open schedule slots...</span>
            </div>
          )}

          {!loadingSlots && availableSlots.length === 0 && !rescheduleError && (
            <div className="py-4 px-3 bg-surface-container-low rounded-xl text-center text-xs text-on-surface-variant">
              No open slots available on this date. Please pick another date.
            </div>
          )}

          {!loadingSlots && availableSlots.length > 0 && (
            <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
              {availableSlots.map((slot) => {
                const slotDate = new Date(slot);
                const isSelected = selectedSlot === slot;
                const formattedTime = slotDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => onSelectSlot(slot)}
                    className={`px-2.5 py-2 rounded-xl text-xs font-semibold border transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                      isSelected
                        ? "bg-primary text-white border-primary shadow-sm"
                        : "bg-surface-container-low hover:bg-surface-container text-on-surface border-outline-variant/30 hover:border-primary/40"
                    }`}
                  >
                    {formattedTime}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex justify-end items-center gap-3 pt-3 border-t border-outline-variant/20">
          <button
            type="button"
            disabled={rescheduling}
            onClick={onClose}
            className="px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-low rounded-xl transition-colors font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={rescheduling || !selectedSlot}
            onClick={onConfirm}
            className="px-5 py-2.5 text-sm bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium rounded-xl shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 active:scale-[0.99] inline-flex items-center gap-2"
          >
            {rescheduling && (
              <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
            )}
            <span>{rescheduling ? "Rescheduling..." : "Confirm Reschedule"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
