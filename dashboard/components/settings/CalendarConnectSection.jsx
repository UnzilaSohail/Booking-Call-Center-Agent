'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function CalendarConnectSection() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.calendarStatus().then(setStatus).catch((e) => setError(e.message)); }, []);

  async function connect() {
    try {
      const { url } = await api.calendarConnectUrl();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Google Calendar</h2>
      {status?.connected ? (
        <p>Connected — bookings mirror to <code>{status.google_calendar_id}</code>.</p>
      ) : (
        <p className="muted">Not connected. Bookings still work (the database is the source of truth); connect to also see them on your Google Calendar and to catch conflicts with manually-added personal events.</p>
      )}
      <button className="primary" onClick={connect}>{status?.connected ? 'Reconnect' : 'Connect Google Calendar'}</button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
