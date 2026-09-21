'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Plus } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import BookingModal from '../../components/BookingModal';
import { api, ApiError } from '../../lib/api';
import { colorForId } from '../../lib/colors';
import { useToast } from '../../lib/Toast';

const STAFF_FILTER_KEY = 'booking_calendar_staff_filter';

function CalendarInner() {
  const toast = useToast();
  const [services, setServices] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [locations, setLocations] = useState([]);
  const [staffFilter, setStaffFilter] = useState('all'); // 'all' | staffId | 'none' (no staff assigned)
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', booking?, initialDate? }
  const calendarRef = useRef(null);

  useEffect(() => {
    api.listServices().then(setServices).catch(() => {});
    api.listStaff().then(setStaffList).catch(() => {});
    api.listLocations().then(setLocations).catch(() => {});
    try {
      const saved = window.localStorage.getItem(STAFF_FILTER_KEY);
      if (saved) setStaffFilter(saved);
    } catch { /* private browsing / storage blocked — fall back to default */ }
  }, []);

  function changeStaffFilter(value) {
    setStaffFilter(value);
    try { window.localStorage.setItem(STAFF_FILTER_KEY, value); } catch { /* per-viewer convenience only */ }
    calendarRef.current?.getApi().refetchEvents();
  }

  // Color by staff when this business has staff, otherwise by service — either way it's
  // the same color every time the same staff/service appears, no server field needed.
  const colorKeyFor = useCallback((b) => (staffList.length > 0 ? b.staff_id : b.service_id), [staffList.length]);

  const fetchEvents = useCallback((fetchInfo, successCallback, failureCallback) => {
    api.listBookings(fetchInfo.startStr, fetchInfo.endStr)
      .then((bookings) => successCallback(bookings
        .filter((b) => b.status === 'confirmed')
        .filter((b) => {
          if (staffFilter === 'all') return true;
          if (staffFilter === 'none') return !b.staff_id;
          return b.staff_id === staffFilter;
        })
        .map((b) => {
          const color = colorForId(colorKeyFor(b));
          return {
            id: b.id,
            title: `${b.service_name} — ${b.customer_name}`,
            start: b.start_time,
            end: b.end_time,
            backgroundColor: color,
            borderColor: color,
            extendedProps: b,
          };
        })))
      .catch(failureCallback);
  }, [staffFilter, colorKeyFor]);

  function refresh() {
    calendarRef.current?.getApi().refetchEvents();
    setModal(null);
    toast.success(modal?.mode === 'edit' ? 'Booking updated' : 'Booking created');
  }

  async function handleDrop(info) {
    try {
      await api.rescheduleBooking(info.event.id, info.event.start.toISOString());
      toast.success('Booking rescheduled');
    } catch (err) {
      info.revert();
      toast.error(err instanceof ApiError ? err.message : 'Could not reschedule — try again');
    }
  }

  const legend = useMemo(() => {
    if (staffList.length > 0) return staffList.map((s) => ({ id: s.id, label: s.name }));
    return services.map((s) => ({ id: s.id, label: s.name }));
  }, [staffList, services]);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Calendar</h1>
        <div className="row" style={{ alignItems: 'center' }}>
          {staffList.length > 0 && (
            <select value={staffFilter} onChange={(e) => changeStaffFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="all">All staff</option>
              {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="none">Unassigned</option>
            </select>
          )}
          <button className="primary" onClick={() => setModal({ mode: 'create', initialDate: new Date() })} disabled={services.length === 0}>
            <Plus size={15} /> New booking
          </button>
        </div>
      </div>

      <div className="card">
        {services.length === 0 && (
          <p className="muted">Add at least one service under Settings before creating bookings.</p>
        )}

        {legend.length > 0 && (
          <div className="row" style={{ marginBottom: 12, fontSize: 12 }}>
            {legend.map((item) => (
              <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: colorForId(item.id), display: 'inline-block' }} />
                {item.label}
              </span>
            ))}
          </div>
        )}

        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          height="auto"
          nowIndicator
          events={fetchEvents}
          selectable
          select={(info) => setModal({ mode: 'create', initialDate: info.start })}
          eventClick={(info) => setModal({ mode: 'edit', booking: info.event.extendedProps })}
          editable
          eventStartEditable
          eventDurationEditable={false}
          snapDuration="00:05:00"
          eventDrop={handleDrop}
        />
      </div>

      {modal && (
        <BookingModal
          mode={modal.mode}
          booking={modal.booking}
          initialDate={modal.initialDate}
          services={services}
          staffList={staffList}
          locations={locations}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <RequireAuth>
      <CalendarInner />
    </RequireAuth>
  );
}
