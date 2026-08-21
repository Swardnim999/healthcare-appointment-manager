import { formatDoctorName } from "../utils/formatters";

export default function MedicationsCard({ appointments = [], loading }) {
  if (loading) {
    return (
      <section id="medications" className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 animate-pulse">
        <div className="flex justify-between items-center mb-6">
          <div className="h-6 w-32 bg-surface-container-low rounded"></div>
        </div>
        <div className="space-y-4">
          <div className="h-20 bg-surface-container-low rounded-xl"></div>
          <div className="h-20 bg-surface-container-low rounded-xl"></div>
        </div>
      </section>
    );
  }

  // Extract all medication items from completed visits
  const medications = [];
  const seenMeds = new Set();

  appointments.forEach((appt) => {
    // Check postVisitSummary.medicationSchedule
    if (appt.postVisitSummary?.medicationSchedule && Array.isArray(appt.postVisitSummary.medicationSchedule)) {
      appt.postVisitSummary.medicationSchedule.forEach((item) => {
        const key = `${item.drug || ""}-${item.instructions || ""}`;
        if (!seenMeds.has(key) && item.drug) {
          seenMeds.add(key);
          medications.push({
            drug: item.drug,
            instructions: item.instructions || "As directed by physician",
            doctorName: appt.doctor?.user?.name ? formatDoctorName(appt.doctor.user.name) : null,
          });
        }
      });
    }

    // Also check raw prescription JSON if present
    if (appt.prescription) {
      let prescList = [];
      if (typeof appt.prescription === "string") {
        try {
          prescList = JSON.parse(appt.prescription);
        } catch {
          prescList = [];
        }
      } else if (Array.isArray(appt.prescription)) {
        prescList = appt.prescription;
      }

      prescList.forEach((p) => {
        const key = `${p.drug || ""}-${p.dose || ""}-${p.frequency || ""}`;
        if (!seenMeds.has(key) && p.drug) {
          seenMeds.add(key);
          medications.push({
            drug: p.drug,
            dose: p.dose,
            frequency: p.frequency,
            days: p.days,
            instructions: `${p.dose ? `${p.dose} • ` : ""}${p.frequency || "Daily"}${p.days ? ` for ${p.days} days` : ""}`,
            doctorName: appt.doctor?.user?.name ? formatDoctorName(appt.doctor.user.name) : null,
          });
        }
      });
    }
  });

  return (
    <section id="medications" className="bg-surface rounded-2xl border border-outline-variant/40 shadow-card p-6 transition-all hover:border-outline-variant/60">
      <div className="flex justify-between items-center mb-5">
        <h3 className="font-manrope font-bold text-lg text-on-surface">Medications</h3>
        {medications.length > 0 && (
          <span className="font-sans text-xs text-on-surface-variant font-medium">
            {medications.length} {medications.length === 1 ? "active" : "active"}
          </span>
        )}
      </div>

      {medications.length === 0 ? (
        <div className="text-center py-8 bg-surface-container-low/50 rounded-xl border border-outline-variant/30">
          <div className="w-10 h-10 rounded-full bg-surface-container text-on-surface-variant flex items-center justify-center mx-auto mb-2">
            <span className="material-symbols-outlined text-[20px]">pill</span>
          </div>
          <p className="font-sans text-sm text-on-surface-variant font-medium">No Active Medications</p>
          <p className="font-sans text-xs text-on-surface-variant/80 mt-0.5 max-w-xs mx-auto">
            Prescriptions and dosage instructions provided during consultations will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {medications.map((med, index) => (
            <div
              key={index}
              className="bg-surface-container-low/70 p-4 rounded-xl border border-outline-variant/30 flex items-start gap-3.5 transition-all hover:bg-surface-container-low hover:border-outline-variant/50"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[20px]">pill</span>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-manrope font-bold text-sm text-on-surface truncate">{med.drug}</h4>
                <p className="font-sans text-xs text-on-surface-variant mt-0.5 line-clamp-2">
                  {med.instructions}
                </p>
                {med.doctorName && (
                  <p className="font-sans text-[11px] text-on-surface-variant/70 mt-1">
                    Prescribed by {med.doctorName}
                  </p>
                )}
                <div className="mt-2.5 inline-flex items-center gap-1.5 text-secondary font-sans text-xs font-semibold bg-secondary/10 px-2.5 py-1 rounded-md border border-secondary/20">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  <span>Active Regimen</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
