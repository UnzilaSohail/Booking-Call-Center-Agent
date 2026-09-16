'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Area, CartesianGrid, ComposedChart, Line, RadialBar, RadialBarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Building2, CalendarDays, CalendarRange, CheckCircle2, Minus, PhoneCall,
  TrendingDown, TrendingUp, UserCheck2, XCircle,
} from 'lucide-react';
import RequirePlatformAuth from '../../components/RequirePlatformAuth';
import Avatar from '../../components/Avatar';
import { platformApi } from '../../lib/api';
import { DateTime } from '../../lib/datetime';

const ACCENT = '#2563eb';
const ACCENT_SOFT = '#dbeafe';
const SUCCESS = '#16a34a';
const SUCCESS_SOFT = '#dcfce7';
const WARNING = '#d97706';
const WARNING_SOFT = '#fef3c7';
const DANGER = '#dc2626';
const DANGER_SOFT = '#fee2e2';
const VIOLET = '#7c3aed';
const TEXT_MUTED = '#4d5c66';
const BORDER = '#cfd9dd';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--ink)', color: 'var(--ink-text)', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>
      {label && <div style={{ opacity: 0.7, marginBottom: 2 }}>{label}</div>}
      {payload.map((p, i) => <div key={i}>{p.name}: {p.value}</div>)}
    </div>
  );
}

// Trend direction is inverted for metrics where "up" is bad (cancellations, transfers) —
// isGoodUp lets the caller say which direction should render as success vs danger.
function Trend({ pct, context, isGoodUp = true }) {
  if (pct === null || pct === undefined) return null;
  const flat = pct === 0;
  const good = flat ? null : (isGoodUp ? pct > 0 : pct < 0);
  const Icon = flat ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  const cls = flat ? 'flat' : good ? 'up' : 'down';
  return (
    <div className={`trend ${cls}`}>
      <Icon size={13} />
      {pct > 0 ? '+' : ''}{pct}%
      {context && <span className="trend-context">&nbsp;{context}</span>}
    </div>
  );
}

function StatCard({ icon: Icon, iconColor, iconBg, label, value, pct, context, isGoodUp }) {
  return (
    <div className="stat-card">
      <div className="icon-badge" style={{ background: iconBg }}>
        <Icon size={17} color={iconColor} />
      </div>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      <Trend pct={pct} context={context} isGoodUp={isGoodUp} />
    </div>
  );
}

function ChartCard({ title, subtitle, action, children, empty }) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {empty ? <div className="empty-state" style={{ padding: '28px 20px' }}><p>{empty}</p></div> : children}
    </div>
  );
}

function AgentMetricRow({ icon: Icon, label, value, pct, isGoodUp, last }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <Icon size={14} color="var(--text-faint)" />
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{value}</span>
        <Trend pct={pct} isGoodUp={isGoodUp} />
      </div>
    </div>
  );
}

function statusPill(createdVia) {
  return createdVia === 'call'
    ? <span className="badge info">AI agent</span>
    : <span className="badge neutral">Dashboard</span>;
}

function OverviewInner() {
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    platformApi.getAnalytics().then(setAnalytics).catch((e) => setError(e.message));
  }, []);

  const dailyData = (analytics?.dailyActivity ?? []).map((d) => ({
    ...d, label: new Date(d.date).toLocaleDateString([], { month: 'short', day: 'numeric' }),
  }));
  const hasActivity = dailyData.some((d) => d.confirmed > 0 || d.cancelled > 0);

  const topCompanies = analytics?.topCompanies ?? [];
  const maxCompanyCount = Math.max(1, ...topCompanies.map((c) => c.count));

  const conversionRate = analytics?.calls?.conversionRate;
  const gaugeData = [{ value: conversionRate ?? 0, fill: ACCENT }];

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Overview</h1>
          <p className="muted" style={{ marginTop: 4 }}>Monitor bookings and agent performance across every company.</p>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <span className="badge neutral" style={{ padding: '6px 12px' }}>
            <CalendarRange size={13} style={{ marginRight: 2 }} />
            Last 30 days
          </span>
          <Link href="/platform/companies" className="primary" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--ink)',
            color: 'var(--ink-text)', border: '1px solid var(--ink)', borderRadius: 5,
            padding: '7px 13px', fontWeight: 550, fontSize: 13,
          }}>
            + Register company
          </Link>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="stat-cards">
        <StatCard
          icon={CalendarDays} iconColor={ACCENT} iconBg={ACCENT_SOFT}
          label="Total bookings" value={analytics?.bookings.total.current ?? '—'}
          pct={analytics?.bookings.total.trendPct} context="vs previous 30 days"
        />
        <StatCard
          icon={CheckCircle2} iconColor={SUCCESS} iconBg={SUCCESS_SOFT}
          label="Confirmed" value={analytics?.bookings.confirmed.current ?? '—'}
          pct={analytics?.bookings.confirmed.trendPct} context="vs previous 30 days"
        />
        <StatCard
          icon={XCircle} iconColor={DANGER} iconBg={DANGER_SOFT}
          label="Cancelled" value={analytics?.bookings.cancelled.current ?? '—'}
          pct={analytics?.bookings.cancelled.trendPct} context="vs previous 30 days" isGoodUp={false}
        />
        <StatCard
          icon={Building2} iconColor={VIOLET} iconBg="var(--violet-soft)"
          label="Active companies" value={analytics?.activeCompanies ?? '—'}
          pct={analytics?.companiesTrendPct} context="new signups"
        />
      </div>

      <div className="row" style={{ gap: 18, alignItems: 'stretch' }}>
        <div style={{ flex: 2, minWidth: 320 }}>
          <ChartCard
            title="Booking activity"
            subtitle="Confirmed vs. cancelled bookings, last 30 days"
            empty={!analytics ? 'Loading...' : (!hasActivity ? 'No booking activity in this window yet.' : null)}
          >
            <div className="row" style={{ gap: 16, marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ACCENT, marginRight: 5 }} />Confirmed</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: DANGER, marginRight: 5 }} />Cancelled</span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={dailyData} margin={{ left: -20, right: 8 }}>
                <defs>
                  <linearGradient id="confirmedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={BORDER} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT_MUTED }} axisLine={{ stroke: BORDER }} tickLine={false} interval={4} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: TEXT_MUTED }} axisLine={false} tickLine={false} width={30} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="confirmed" name="Confirmed" stroke={ACCENT} strokeWidth={2} fill="url(#confirmedFill)" />
                <Line type="monotone" dataKey="cancelled" name="Cancelled" stroke={DANGER} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div style={{ flex: 1, minWidth: 260 }}>
          <ChartCard title="AI agent performance" subtitle="Voice agent, last 30 days" empty={!analytics ? 'Loading...' : null}>
            <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', height: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius="72%" outerRadius="100%" data={gaugeData} startAngle={90} endAngle={-270} barSize={12}>
                  <RadialBar dataKey="value" cornerRadius={99} background={{ fill: 'var(--surface-alt)' }} maxBarSize={12} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600 }}>{conversionRate ?? '—'}{conversionRate !== null && conversionRate !== undefined ? '%' : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Booking rate</div>
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              <AgentMetricRow icon={PhoneCall} label="Calls handled" value={analytics?.calls.handled.current ?? '—'} pct={analytics?.calls.handled.trendPct} />
              <AgentMetricRow icon={UserCheck2} label="Bookings made" value={analytics?.calls.booked.current ?? '—'} pct={analytics?.calls.booked.trendPct} />
              <AgentMetricRow icon={PhoneCall} label="Transferred to human" value={analytics?.calls.transferred.current ?? '—'} pct={analytics?.calls.transferred.trendPct} isGoodUp={false} last />
            </div>
          </ChartCard>
        </div>
      </div>

      <div className="row" style={{ gap: 18, alignItems: 'stretch' }}>
        <div style={{ flex: 2, minWidth: 320 }}>
          <ChartCard
            title="Upcoming bookings"
            action={<Link href="/platform/bookings" style={{ fontSize: 12.5 }}>View all</Link>}
            empty={analytics && analytics.upcomingBookings.length === 0 ? 'Nothing on the calendar yet, anywhere.' : null}
          >
            {analytics && analytics.upcomingBookings.length > 0 && (
              <table>
                <thead><tr><th>Customer</th><th>Company</th><th>Service</th><th>Date &amp; time</th><th>Booked via</th></tr></thead>
                <tbody>
                  {analytics.upcomingBookings.map((b) => (
                    <tr key={b._id}>
                      <td>
                        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                          <Avatar name={b.customerName} />
                          <div>
                            <div style={{ fontWeight: 550 }}>{b.customerName}</div>
                            {b.customerEmail && <div className="faint" style={{ fontSize: 11.5 }}>{b.customerEmail}</div>}
                          </div>
                        </div>
                      </td>
                      <td>{b.companyName}</td>
                      <td>{b.serviceName ?? '—'}{b.durationMinutes ? <span className="faint"> · {b.durationMinutes}m</span> : ''}</td>
                      <td>{DateTime.formatDateTime(b.startTime)}</td>
                      <td>{statusPill(b.createdVia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ChartCard>
        </div>

        <div style={{ flex: 1, minWidth: 260 }}>
          <ChartCard
            title="Top companies"
            subtitle="By bookings placed, last 30 days"
            action={<Link href="/platform/companies" style={{ fontSize: 12.5 }}>View all</Link>}
            empty={analytics && topCompanies.length === 0 ? 'No booking activity yet.' : null}
          >
            {topCompanies.length > 0 && (
              <div className="stack" style={{ gap: 14 }}>
                {topCompanies.map((c, i) => (
                  <div key={c.id} className="row" style={{ alignItems: 'center', gap: 10 }}>
                    <span className="faint" style={{ fontSize: 12, width: 14 }}>{i + 1}</span>
                    <Avatar name={c.name} size={26} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div className="row" style={{ alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${(c.count / maxCompanyCount) * 100}%` }} />
                        </div>
                        <span className="faint" style={{ fontSize: 11.5, flexShrink: 0 }}>{c.count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

export default function PlatformOverviewPage() {
  return (
    <RequirePlatformAuth>
      <OverviewInner />
    </RequirePlatformAuth>
  );
}
