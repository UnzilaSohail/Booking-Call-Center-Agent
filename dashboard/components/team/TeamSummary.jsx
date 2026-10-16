'use client';
import { useEffect, useState } from 'react';
import { Send, UserCheck, UserX, Users } from 'lucide-react';
import { api } from '../../lib/api';
import CountUp from '../CountUp';

// Four numbers at the top, like the Overview: who customers can book, who can log in, who still has to accept.
export default function TeamSummary() {
  const [staff, setStaff] = useState(null);
  const [members, setMembers] = useState(null);
  useEffect(() => {
    api.listStaff().then(setStaff).catch(() => setStaff([]));
    api.listTeamMembers().then(setMembers).catch(() => setMembers([]));
  }, []);
  const cards = [
    [Users, 'var(--accent-soft)', 'var(--accent)', 'People customers can book', staff?.length],
    [UserCheck, 'var(--success-soft)', 'var(--success)', 'People who can log in', members?.filter((m) => m.status === 'active').length],
    [Send, 'var(--warning-soft)', 'var(--warning)', 'Invitations waiting', members?.filter((m) => m.status === 'invited').length],
    [UserX, 'var(--danger-soft)', 'var(--danger)', 'Logins switched off', members?.filter((m) => m.status === 'suspended').length],
  ];
  return (
    <div className="stat-cards">
      {cards.map(([Icon, bg, fg, label, value]) => (
        <div key={label} className="stat-card">
          <div className="icon-badge" style={{ background: bg }}><Icon size={17} color={fg} /></div>
          <div className="value"><CountUp value={value ?? '—'} /></div>
          <div className="label">{label}</div>
        </div>
      ))}
    </div>
  );
}
