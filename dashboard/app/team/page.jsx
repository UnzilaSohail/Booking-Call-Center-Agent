'use client';
import RequireAuth from '../../components/RequireAuth';
import StaffSection from '../../components/team/StaffSection';
import TeamMembersSection from '../../components/team/TeamMembersSection';
import TeamSummary from '../../components/team/TeamSummary';

function TeamInner() {
  return (
    <div className="stack">
      <div>
        <h1>Team</h1>
        <p className="muted" style={{ marginTop: 4 }}>The people customers can book with, and the people who can log in to this dashboard.</p>
      </div>
      <TeamSummary />
      <StaffSection />
      <TeamMembersSection />
    </div>
  );
}

export default function TeamPage() {
  return (
    <RequireAuth area="team">
      <TeamInner />
    </RequireAuth>
  );
}
