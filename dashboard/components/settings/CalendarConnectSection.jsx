'use client';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import LoadError from '../LoadError';

export default function CalendarConnectSection() {
  const { data: status, error: loadError, reload } = useApi(() => api.calendarStatus());
  const [error, setError] = useState(null);

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
      <LoadError error={loadError} onRetry={reload} />
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
