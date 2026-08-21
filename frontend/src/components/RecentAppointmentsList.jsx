import { useState } from "react";
import { formatDoctorName } from "../utils/formatters";

export default function RecentAppointmentsList({ appointments = [], loading }) {
  const [expandedId, setExpandedId] = useState(null);

  if (loading) {
    return (
      <section id="appointments" className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 animate-pulse">
        <div className="h-6 w-48 bg-surface-container-low rounded mb-6"></div>
        <div className="space-y-3">
          <div className="h-16 bg-surface-container-low rounded-xl"></div>
          <div className="h-16 bg-surface-container-low rounded-xl"></div>
        </div>
      </section>
    );
  }

  return (
    <section id="appointments" className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 transition-all hover:border-outline-variant/60">
      <div className="flex justify-between items-center mb-5">
        <h3 className="font-manrope font-bold text-lg text-on-surface">Recent Appointments</h3>
        <span className="font-sans text-xs text-on-surface-variant font-medium">
          {appointments.length} {appointments.length === 1 ? "record" : "records"}
        </span>
      </div>

      {appointments.length === 0 ? (
        <div className="text-center py-8 bg-surface-container-low/50 rounded-xl border border-outline-variant/30">
          <div className="w-10 h-10 rounded-full bg-surface-container text-on-surface-variant flex items-center justify-center mx-auto mb-2">
            <span className="material-symbols-outlined text-[20px]">history</span>
          </div>
          <p className="font-sans text-sm text-on-surface-variant font-medium">No past appointments</p>
          <p className="font-sans text-xs text-on-surface-variant/80 mt-0.5">
            Your completed consultations and visit summaries will be listed here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-outline-variant/20">
          {appointments.map((a) => {
            const startDate = new Date(a.slotStart);
            const formattedDate = startDate.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const doctorName = formatDoctorName(a.doctor?.user?.name);
            const specialization = a.doctor?.specialization || "Clinical Consultation";
            const isExpanded = expandedId === a.id;

            return (
              <div key={a.id} className="py-3.5 first:pt-0 last:pb-0 group">
                <div
                  onClick={() => setExpandedId(isExpanded ? null : a.id)}
                  className="flex items-center justify-between p-2 rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setExpandedId(isExpanded ? null : a.id);
                    }
                  }}
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center text-primary border border-outline-variant/30 flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                      <span className="material-symbols-outlined text-[20px]">stethoscope</span>
                    </div>
                    <div>
                      <p className="font-manrope font-semibold text-sm text-on-surface">{specialization}</p>
                      <p className="font-sans text-xs text-on-surface-variant">
                        {doctorName} • {formattedDate}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className="hidden sm:inline-block bg-emerald-50 text-emerald-700 border border-emerald-200/80 font-sans text-[11px] font-medium px-2.5 py-0.5 rounded-full">
                      {a.status === "COMPLETED" ? "Completed" : a.status}
                    </span>
                    <span
                      className={`material-symbols-outlined text-outline-variant group-hover:text-primary transition-transform duration-200 ${
                        isExpanded ? "rotate-90 text-primary" : ""
                      }`}
                    >
                      chevron_right
                    </span>
                  </div>
                </div>

                {/* Expanded Visit Summary / Notes */}
                {isExpanded && (
                  <div className="mt-2 ml-4 sm:ml-14 p-4 bg-surface-container-low/80 rounded-xl border border-outline-variant/30 text-xs sm:text-sm space-y-2 animate-in fade-in duration-150">
                    <p className="font-manrope font-semibold text-xs text-on-surface uppercase tracking-wider">
                      Visit Summary
                    </p>
                    {a.postVisitSummary?.summary ? (
                      <p className="text-on-surface-variant leading-relaxed">{a.postVisitSummary.summary}</p>
                    ) : (
                      <p className="text-on-surface-variant italic">No post-visit notes recorded.</p>
                    )}

                    {a.postVisitSummary?.medicationSchedule && a.postVisitSummary.medicationSchedule.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/20">
                        <p className="font-semibold text-xs text-on-surface mb-1">Prescribed Medications:</p>
                        <ul className="list-disc list-inside space-y-0.5 text-on-surface-variant text-xs">
                          {a.postVisitSummary.medicationSchedule.map((m, idx) => (
                            <li key={idx}>
                              <strong>{m.drug}</strong>: {m.instructions}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
