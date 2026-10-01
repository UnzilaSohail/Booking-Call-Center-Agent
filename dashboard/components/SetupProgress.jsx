'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import Tour from './Tour';

// "Finish setting up" card for the Overview page (Jira 26a): how many of the setup-guide steps are
// done, what comes next, and a way to replay the tour. Disappears once the business has gone live.
const SEEN_KEY = 'dashboard_tour_seen';
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: it just shows again */ } };

export default function SetupProgress() {
  const [status, setStatus] = useState(null);
  const [tour, setTour] = useState(false);

  useEffect(() => {
    api.getOnboardingStatus().then((s) => {
      setStatus(s);
      if (!s.steps.find((x) => x.key === 'go_live')?.done && !seen()) setTour(true); // first visit (26b)
    }).catch(() => {});
  }, []);

  if (!status || status.steps.find((x) => x.key === 'go_live')?.done) return null;
  const done = status.steps.filter((s) => s.done).length;
  const next = status.steps.find((s) => !s.done);

  return (
    <>
      <div className="card setup-card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Finish setting up</h2>
          <button type="button" className="ghost" onClick={() => setTour(true)}>Take the tour</button>
        </div>
        <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
          <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={status.steps.length} aria-valuenow={done} aria-label="Setup progress">
            <div className="progress-fill" style={{ width: `${(done / status.steps.length) * 100}%` }} />
          </div>
          <strong style={{ whiteSpace: 'nowrap' }}>{done} of {status.steps.length} done</strong>
        </div>
        {next && <p className="muted" style={{ margin: 0 }}>Next: <strong>{next.label}</strong>. <Link href="/onboarding">Open the setup guide</Link></p>}
      </div>
      {tour && <Tour onClose={() => { markSeen(); setTour(false); }} />}
    </>
  );
}
