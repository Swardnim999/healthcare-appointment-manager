export default function AiPreVisitSummaryCard({ appointment, loading }) {
  if (loading) {
    return (
      <section className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 animate-pulse">
        <div className="flex justify-between items-center mb-4">
          <div className="h-5 w-40 bg-surface-container-low rounded"></div>
          <div className="h-5 w-24 bg-surface-container-low rounded-full"></div>
        </div>
        <div className="h-24 bg-surface-container-low rounded-xl"></div>
      </section>
    );
  }

  // Parse backend preVisitSummary
  let aiData = null;
  if (appointment?.preVisitSummary) {
    if (typeof appointment.preVisitSummary === "string") {
      try {
        aiData = JSON.parse(appointment.preVisitSummary);
      } catch {
        aiData = null;
      }
    } else if (typeof appointment.preVisitSummary === "object") {
      aiData = appointment.preVisitSummary;
    }
  }

  const urgency = (aiData?.urgency || appointment?.urgency || "MEDIUM").toUpperCase();
  const chiefComplaint = aiData?.chiefComplaint || appointment?.symptomText || "";
  const suggestedQuestions = Array.isArray(aiData?.suggestedQuestions) ? aiData.suggestedQuestions : [];
  const isFallback = Boolean(aiData?._aiFailed);

  // Urgency styling tokens
  const urgencyConfig = {
    LOW: {
      label: "Low Urgency",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    MEDIUM: {
      label: "Normal Urgency",
      badgeClass: "bg-secondary/10 text-secondary border-secondary/20",
    },
    HIGH: {
      label: "High Urgency",
      badgeClass: "bg-error-container/60 text-error border-error/30 font-bold",
    },
  };

  const currentUrgency = urgencyConfig[urgency] || urgencyConfig.MEDIUM;

  return (
    <section className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 relative overflow-hidden transition-all hover:border-outline-variant/60">
      {/* Decorative soft glow */}
      <div className="absolute top-0 right-0 w-60 h-60 bg-secondary-fixed/15 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

      <div className="relative z-10">
        {/* Header with Title and Badges */}
        <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-secondary/10 text-secondary flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">smart_toy</span>
            </div>
            <h3 className="font-manrope font-bold text-base sm:text-lg text-on-surface">AI Pre-Visit Summary</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-secondary/10 text-secondary font-sans font-semibold text-[11px] px-2.5 py-0.5 rounded-md border border-secondary/25">
              AI-Assisted
            </span>
            {appointment && (
              <span className={`font-sans text-[11px] px-2.5 py-0.5 rounded-md border font-medium ${currentUrgency.badgeClass}`}>
                {currentUrgency.label}
              </span>
            )}
          </div>
        </div>

        {/* Content Box */}
        {appointment && (chiefComplaint || suggestedQuestions.length > 0) ? (
          <div className="space-y-4">
            <div className="bg-background rounded-xl p-4 border border-outline-variant/30 text-on-surface-variant font-sans text-sm leading-relaxed">
              <p className="text-on-surface font-medium mb-1">Chief Complaint & Reported Symptoms:</p>
              <p className="italic text-on-surface-variant">"{chiefComplaint}"</p>
              {isFallback && (
                <p className="text-xs text-amber-700 mt-2 bg-amber-50 p-2 rounded border border-amber-200">
                  Note: AI summarizer was temporarily unreachable during intake; standard intake information is displayed.
                </p>
              )}
            </div>

            {/* Suggested Questions for Doctor */}
            {suggestedQuestions.length > 0 && (
              <div className="bg-surface-container-low/60 rounded-xl p-4 border border-outline-variant/30">
                <p className="font-manrope font-semibold text-xs text-on-surface uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-secondary text-[16px]">help_outline</span>
                  Suggested Discussion Questions for Your Visit
                </p>
                <ul className="space-y-1.5 text-xs sm:text-sm text-on-surface-variant">
                  {suggestedQuestions.map((q, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-secondary font-bold">•</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-background rounded-xl p-4 border border-outline-variant/30 text-on-surface-variant font-sans text-xs sm:text-sm leading-relaxed">
            <p className="text-on-surface font-medium mb-1">No symptom summary on file</p>
            <p className="text-on-surface-variant">
              When booking an appointment, you can enter your symptoms to automatically generate a pre-visit clinical summary for your doctor.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
