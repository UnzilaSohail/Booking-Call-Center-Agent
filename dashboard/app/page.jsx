'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, Box, CalendarDays, CalendarRange, Crown, DollarSign, Minus, TrendingDown, TrendingUp, Users,
} from 'lucide-react';
import RequireAuth from '../components/RequireAuth';
import Avatar from '../components/Avatar';
import BookingModal from '../components/BookingModal';
import { api } from '../lib/api';
import { DateTime } from '../lib/datetime';

const ACCENT = '#2563eb';
const ACCENT_SOFT = '#dbeafe';
const SUCCESS = '#16a34a';
const SUCCESS_SOFT = '#dcfce7';
const WARNING = '#d97706';
const WARNING_SOFT = '#fef3c7';
const DANGER = '#dc2626';
const DANGER_SOFT = '#fee2e2';
const INFO = '#0891b2';
const INFO_SOFT = '#cffafe';
const VIOLET = '#7c3aed';
const VIOLET_SOFT = '#ede9fe';
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

function Trend({ pct, context, isGoodUp = true, suffix = '%' }) {
  if (pct === null || pct === undefined) return null;
  const flat = pct === 0;
  const good = flat ? null : (isGoodUp ? pct > 0 : pct < 0);
  const Icon = flat ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  const cls = flat ? 'flat' : good ? 'up' : 'down';
  return (
    <div className={`trend ${cls}`}>
      <Icon size={13} />
      {pct > 0 ? '+' : ''}{pct}{suffix}
      {context && <span className="trend-context">&nbsp;{context}</span>}
    </div>
  );
}

function StatCard({ icon: Icon, iconColor, iconBg, label, value, pct, context }) {
  return (
    <div className="stat-card">
      <div className="icon-badge" style={{ background: iconBg }}>
        <Icon size={17} color={iconColor} />
      </div>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      <Trend pct={pct} context={context} />
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

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function HomeInner() {
  const [me, setMe] = useState(null);
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [openExceptions, setOpenExceptions] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [services, setServices] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api.getStats().then(setStats).catch((e) => setError(e.message));
    api.getAnalytics().then(setAnalytics).catch(() => {});
    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 86400000);
    api.listBookings(now.toISOString(), weekOut.toISOString())
      .then((rows) => setUpcoming(rows.filter((b) => b.status === 'confirmed').slice(0, 6)))
      .catch(() => {});
  }

  useEffect(() => {
    api.getMe().then((m) => {
      setMe(m);
      if (m.areas?.includes('exceptions')) api.listExceptions('open').then((rows) => setOpenExceptions(rows.length)).catch(() => {});
    }).catch(() => {});
    api.listServices().then(setServices).catch(() => {});
    api.listStaff().then(setStaffList).catch(() => {});
    load();
  }, []);

  const staffNameById = Object.fromEntries(staffList.map((s) => [s.id, s.name]));
  const firstName = (me?.name || me?.email || '').split(/\s|@/)[0];

  const dailyData = (analytics?.daily ?? []).map((d) => ({ ...d, label: new Date(d.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) }));
  const hasActivity = dailyData.some((d) => d.confirmed > 0 || d.cancelled > 0);
  const callData = analytics ? [
    { name: 'Booked', value: analytics.calls.booked, color: ACCENT },
    { name: 'Transferred', value: analytics.calls.transferred, color: INFO },
    { name: 'Missed', value: analytics.calls.noBooking, color: BORDER },
  ].filter((d) => d.value > 0) : [];

  const topServices = analytics?.topServices ?? [];
  const maxServiceCount = Math.max(1, ...topServices.map((s) => s.count));
  const topStaff = (analytics?.byStaff ?? []).slice(0, 3);
  const maxStaffCount = Math.max(1, ...topStaff.map((s) => s.count));

  function onSaved() {
    setModal(null);
    load();
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="muted" style={{ marginTop: 4 }}>Here&apos;s what&apos;s happening with your bookings.</p>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <span className="badge neutral" style={{ padding: '6px 12px' }}>
            <CalendarRange size={13} style={{ marginRight: 2 }} />
            Last 30 days
          </span>
          <button
            className="primary"
            onClick={() => setModal({ mode: 'create', initialDate: new Date() })}
            disabled={services.length === 0}
          >
            + New booking
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="stat-cards">
        <StatCard
          icon={CalendarDays} iconColor={ACCENT} iconBg={ACCENT_SOFT}
          label="Today's bookings" value={stats?.todayCount ?? '—'}
          pct={stats?.todayTrendPct} context="vs yesterday"
        />
        <StatCard
          icon={TrendingUp} iconColor={INFO} iconBg={INFO_SOFT}
          label="This week" value={stats?.weekCount ?? '—'}
          pct={stats?.weekTrendPct} context="vs last week"
        />
        <StatCard
          icon={DollarSign} iconColor={SUCCESS} iconBg={SUCCESS_SOFT}
          label="Monthly revenue" value={analytics ? `$${analytics.revenueThisMonth.toLocaleString()}` : '—'}
          pct={analytics?.revenueTrendPct} context="vs last month"
        />
        <StatCard
          icon={Box} iconColor={VIOLET} iconBg={VIOLET_SOFT}
          label="Active services" value={stats?.serviceCount ?? '—'}
        />
        <StatCard
          icon={Users} iconColor={WARNING} iconBg={WARNING_SOFT}
          label="Team members" value={stats?.staffCount ?? '—'}
        />
        {openExceptions !== null && (
          <Link href="/exceptions" style={{ textDecoration: 'none', color: 'inherit' }}>
            <StatCard
              icon={AlertTriangle} iconColor={DANGER} iconBg={DANGER_SOFT}
              label="Needs attention" value={openExceptions}
            />
          </Link>
        )}
      </div>

      <div className="row" style={{ gap: 18, alignItems: 'stretch' }}>
        <div style={{ flex: 2, minWidth: 320 }}>
          <ChartCard
            title="Bookings overview"
            subtitle="Bookings and cancellations over the last 14 days"
            empty={!analytics ? 'Loading...' : (!hasActivity ? 'No booking activity in this window yet.' : null)}
          >
            <div className="row" style={{ gap: 16, marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ACCENT, marginRight: 5 }} />Bookings</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: DANGER, marginRight: 5 }} />Cancellations</span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={dailyData} margin={{ left: -20, right: 8 }}>
                <defs>
                  <linearGradient id="bookingsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={BORDER} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT_MUTED }} axisLine={{ stroke: BORDER }} tickLine={false} interval={1} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: TEXT_MUTED }} axisLine={false} tickLine={false} width={30} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="confirmed" name="Bookings" stroke={ACCENT} strokeWidth={2} fill="url(#bookingsFill)" />
                <Line type="monotone" dataKey="cancelled" name="Cancellations" stroke={DANGER} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div style={{ flex: 1, minWidth: 260 }}>
          <ChartCard
            title="Call conversion"
            action={<Trend pct={analytics?.calls.conversionTrendPts} context="vs previous period" suffix="%" />}
            empty={analytics && analytics.calls.total === 0 ? 'No calls logged yet.' : null}
          >
            {analytics && analytics.calls.total > 0 && (
              <div className="row" style={{ alignItems: 'center', gap: 18 }}>
                <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={callData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={62} paddingAngle={2} startAngle={90} endAngle={-270}>
                        {callData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600 }}>{analytics.calls.conversionRate}%</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>Booked from<br />a call</div>
                  </div>
                </div>
                <div className="stack" style={{ gap: 9, flex: 1 }}>
                  {callData.map((d, i) => (
                    <div key={i} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="row" style={{ gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: d.color, display: 'inline-block' }} />
                        {d.name}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartCard>
        </div>
      </div>

      <div className="row" style={{ gap: 18, alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <ChartCard title="Top services" action={<Link href="/services" style={{ fontSize: 12.5 }}>View all</Link>} empty={topServices.length === 0 ? 'No bookings this month yet.' : null}>
            <div className="stack" style={{ gap: 14 }}>
              {topServices.slice(0, 3).map((s) => (
                <div key={s.name}>
                  <div style={{ fontSize: 13, fontWeight: 550, marginBottom: 2 }}>{s.name}</div>
                  <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${(s.count / maxServiceCount) * 100}%` }} />
                    </div>
                    <span className="faint" style={{ fontSize: 11.5, flexShrink: 0 }}>{s.count} bookings</span>
                  </div>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <ChartCard title="Team performance" action={<Link href="/team" style={{ fontSize: 12.5 }}>View all</Link>} empty={topStaff.length === 0 ? 'No staff bookings this month yet.' : null}>
            <div className="stack" style={{ gap: 14 }}>
              {topStaff.map((s, i) => (
                <div key={s.name} className="row" style={{ alignItems: 'center', gap: 10 }}>
                  <Avatar name={s.name} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 550 }}>{s.name}</div>
                    <div className="row" style={{ alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${(s.count / maxStaffCount) * 100}%` }} />
                      </div>
                      <span className="faint" style={{ fontSize: 11.5, flexShrink: 0 }}>{s.count}</span>
                    </div>
                  </div>
                  {i === 0
                    ? <Crown size={15} color={WARNING} />
                    : <span className="faint" style={{ fontSize: 11.5 }}>#{i + 1}</span>}
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        <div style={{ flex: '1 1 100%', minWidth: 320 }}>
          <ChartCard title="Upcoming bookings" action={<Link href="/bookings" style={{ fontSize: 12.5 }}>View all</Link>} empty={upcoming.length === 0 ? 'Nothing booked in the next week yet.' : null}>
            {upcoming.length > 0 && (
              <table>
                <thead><tr><th>Customer</th><th>Service</th><th>Date &amp; time</th><th>Staff</th><th>Status</th></tr></thead>
                <tbody>
                  {upcoming.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                          <Avatar name={b.customer_name} />
                          {b.customer_name}
                        </div>
                      </td>
                      <td>{b.service_name ?? '—'}</td>
                      <td>{DateTime.formatDateTime(b.start_time)}</td>
                      <td>{staffNameById[b.staff_id] ?? '—'}</td>
                      <td><span className="badge success">Confirmed</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ChartCard>
        </div>
      </div>

      {modal && (
        <BookingModal
          mode={modal.mode}
          initialDate={modal.initialDate}
          services={services}
          staffList={staffList}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <RequireAuth>
      <HomeInner />
    </RequireAuth>
  );
}
