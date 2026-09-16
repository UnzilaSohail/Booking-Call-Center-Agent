'use client';
import { useState } from 'react';
import RequirePlatformAuth from '../../../components/RequirePlatformAuth';
import { platformApi } from '../../../lib/api';
import { useToast } from '../../../lib/Toast';

function ChangePasswordCard() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await platformApi.changePassword({ currentPassword, newPassword });
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Change password</h2>
      <form onSubmit={submit} className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Current password</label>
          <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>New password</label>
          <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving...' : 'Change'}</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function PlatformSettingsInner() {
  return (
    <div className="stack">
      <h1>Settings</h1>
      <ChangePasswordCard />
    </div>
  );
}

export default function PlatformSettingsPage() {
  return (
    <RequirePlatformAuth>
      <PlatformSettingsInner />
    </RequirePlatformAuth>
  );
}
