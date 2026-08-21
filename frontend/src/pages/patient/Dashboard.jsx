import { useEffect, useState } from "react";
import { api, getUser } from "../../api";
import Header from "../../components/Header.jsx";
import MobileBottomNav from "../../components/MobileBottomNav.jsx";
import UpcomingAppointmentCard from "../../components/UpcomingAppointmentCard.jsx";
import AiPreVisitSummaryCard from "../../components/AiPreVisitSummaryCard.jsx";
import RecentAppointmentsList from "../../components/RecentAppointmentsList.jsx";
import QuickActionsCard from "../../components/QuickActionsCard.jsx";
import MedicationsCard from "../../components/MedicationsCard.jsx";
import RescheduleModal from "../../components/RescheduleModal.jsx";
import CancelAppointmentModal from "../../components/CancelAppointmentModal.jsx";

export default function PatientDashboard() {
  const user = getUser();
  const patientName = user?.name ? user.name.split(" ")[0] : "there";

  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [calendarConnected, setCalendarConnected] = useState(false);

  // Reschedule modal state
  const [reschedulingAppt, setReschedulingAppt] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleSuccess, setRescheduleSuccess] = useState("");

  // Cancel modal state
  const [cancellingAppt, setCancellingAppt] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  function loadAppointments() {
    setLoading(true);
    setError("");
    api("/appointments/patient/mine")
      .then((data) => {
        setAppointments(Array.isArray(data) ? data : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function checkCalendarStatus() {
    api("/calendar/status")
      .then((data) => setCalendarConnected(Boolean(data.connected)))
      .catch(() => setCalendarConnected(false));
  }

  useEffect(() => {
    loadAppointments();
    checkCalendarStatus();
  }, []);

  async function connectCalendar() {
    try {
      const data = await api("/calendar/oauth/url");
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err.message || "Failed to initiate Google Calendar connection");
    }
  }

  function startCancel(appt) {
    setCancellingAppt(appt);
    setCancelError("");
  }

  async function confirmCancel() {
    if (!cancellingAppt) return;
    setCancelling(true);
    setCancelError("");
    try {
      await api(`/appointments/${cancellingAppt.id}/cancel`, { method: "POST" });
      setAppointments((prev) => prev.filter((a) => a.id !== cancellingAppt.id));
      setCancellingAppt(null);
    } catch (err) {
      setCancelError(err.message || "Failed to cancel appointment");
    } finally {
      setCancelling(false);
    }
  }

  function startReschedule(appt) {
    setReschedulingAppt(appt);
    setRescheduleError("");
    setRescheduleSuccess("");
    setSelectedSlot("");
    const defaultDate = appt.slotStart.slice(0, 10);
    setRescheduleDate(defaultDate);
    fetchSlotsForDate(appt.doctorId, defaultDate);
  }

  async function fetchSlotsForDate(doctorId, date) {
    if (!date || !doctorId) return;
    setLoadingSlots(true);
    setRescheduleError("");
    setSelectedSlot("");
    try {
      const data = await api(`/doctors/${doctorId}/slots?date=${date}`);
      if (!data.available) {
        setAvailableSlots([]);
        setRescheduleError(data.reason || "Doctor unavailable on this date");
      } else {
        setAvailableSlots(data.slots || []);
      }
    } catch (err) {
      setAvailableSlots([]);
      setRescheduleError(err.message);
    } finally {
      setLoadingSlots(false);
    }
  }

  async function confirmReschedule() {
    if (!selectedSlot) {
      setRescheduleError("Please select a new time slot");
      return;
    }
    setRescheduling(true);
    setRescheduleError("");
    try {
      await api(`/appointments/${reschedulingAppt.id}/reschedule`, {
        method: "POST",
        body: { newSlotStart: selectedSlot },
      });
      setRescheduleSuccess("Appointment rescheduled successfully!");
      setTimeout(() => {
        setReschedulingAppt(null);
        loadAppointments();
      }, 1000);
    } catch (err) {
      setRescheduleError(err.message);
    } finally {
      setRescheduling(false);
    }
  }

  // Segment appointments into upcoming and past/recent
  const bookedAppointments = appointments.filter((a) => a.status === "BOOKED");
  // Upcoming is the next booked appointment
  const upcomingAppointment = bookedAppointments.length > 0 ? bookedAppointments[0] : null;

  // Recent appointments are completed appointments and any other past visits
  const recentAppointments = appointments
    .filter((a) => a.id !== upcomingAppointment?.id)
    .sort((a, b) => new Date(b.slotStart).getTime() - new Date(a.slotStart).getTime());

  return (
    <div className="min-h-screen bg-background text-on-surface antialiased flex flex-col font-sans">
      {/* Vitalis Patient Navigation Header */}
      <Header
        user={user}
        calendarConnected={calendarConnected}
        onConnectCalendar={connectCalendar}
        activeTab="dashboard"
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-10 pt-6 sm:pt-8 pb-24 md:pb-12">
        {/* Welcome / Hero Banner */}
        <header className="mb-8">
          <h1 className="font-manrope font-bold text-2xl sm:text-3xl lg:text-4xl text-on-surface tracking-tight">
            Welcome back, {patientName}.
          </h1>
          <p className="font-sans text-sm sm:text-base text-on-surface-variant mt-1.5">
            Here is your health overview for today.
          </p>
        </header>

        {/* Global Error Banner if any */}
        {error && (
          <div className="mb-6 p-4 bg-error-container text-error rounded-2xl border border-error/30 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]">error</span>
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError("")}
              className="text-xs uppercase font-bold tracking-wider hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Two-Column Responsive Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Left Column (Main Clinical Data & History: 8 columns) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            {/* Upcoming Appointment Card */}
            <UpcomingAppointmentCard
              appointment={upcomingAppointment}
              onReschedule={startReschedule}
              onCancel={startCancel}
              loading={loading}
            />

            {/* AI Pre-Visit Summary Card */}
            <AiPreVisitSummaryCard
              appointment={upcomingAppointment}
              loading={loading}
            />

            {/* Recent Appointments History */}
            <RecentAppointmentsList
              appointments={recentAppointments}
              loading={loading}
            />
          </div>

          {/* Right Column (Quick Actions & Medications: 4 columns) */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            {/* Quick Actions Card */}
            <QuickActionsCard />

            {/* Medications Card */}
            <MedicationsCard
              appointments={appointments}
              loading={loading}
            />
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />

      {/* Reschedule Modal */}
      {reschedulingAppt && (
        <RescheduleModal
          appointment={reschedulingAppt}
          rescheduleDate={rescheduleDate}
          onDateChange={(newDate) => {
            setRescheduleDate(newDate);
            fetchSlotsForDate(reschedulingAppt.doctorId, newDate);
          }}
          availableSlots={availableSlots}
          selectedSlot={selectedSlot}
          onSelectSlot={setSelectedSlot}
          loadingSlots={loadingSlots}
          rescheduleError={rescheduleError}
          rescheduleSuccess={rescheduleSuccess}
          rescheduling={rescheduling}
          onConfirm={confirmReschedule}
          onClose={() => setReschedulingAppt(null)}
        />
      )}

      {/* Cancel Appointment Modal */}
      {cancellingAppt && (
        <CancelAppointmentModal
          appointment={cancellingAppt}
          cancelling={cancelling}
          cancelError={cancelError}
          onConfirmCancel={confirmCancel}
          onClose={() => !cancelling && setCancellingAppt(null)}
        />
      )}
    </div>
  );
}
