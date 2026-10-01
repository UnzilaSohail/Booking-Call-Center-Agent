'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Ban, CheckCircle2, KeyRound, Trash2 } from 'lucide-react';
import RequirePlatformAuth from '../../../../components/RequirePlatformAuth';
import { platformApi, ApiError } from '../../../../lib/api';
import { useToast } from '../../../../lib/Toast';
import Loading from '../../../../components/Skeleton';

function ResetPasswordRow({ admin }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await platformApi.resetAdminPassword(admin.id, newPassword);
      toast.success(`Password reset for ${admin.email}`);
      setOpen(false);
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>{admin.name || '—'}</td>
      <td>{admin.email}</td>
      <td>{new Date(admin.createdAt).toLocaleDateString()}</td>
      <td>
        {open ? (
          <form onSubmit={submit} className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
            <input type="password" required minLength={8} autoFocus placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ width: 160 }} />
            <button type="submit" className="primary" disabled={saving}>{saving ? '...' : 'Set'}</button>
            <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
          </form>
        ) : (
          <button className="ghost" onClick={() => setOpen(true)}><KeyRound size={14} /> Reset password</button>
        )}
        {error && <p className="error-text" style={{ marginTop: 4 }}>{error}</p>}
      </td>
    </tr>
  );
}

// Read-only view for platform ops (ROADMAP.md §11) — plan changes, payment method and
// cancellation stay company-admin-only actions (dashboard/app/billing/page.jsx).
function BillingSection({ id }) {
  const [billing, setBilling] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    platformApi.getCompanyBilling(id).then(setBilling).catch((e) => setError(e instanceof ApiError ? e.message : 'failed to load'));
  }, [id]);

  if (error) return <div className="card"><h2>Billing</h2><p className="error-text">{error}</p></div>;
  if (!billing) return <div className="card"><h2>Billing</h2><Loading /></div>;

  return (
    <div className="card">
      <h2>Billing</h2>
      <table>
        <tbody>
          <tr><td className="muted" style={{ width: 160 }}>Plan</td><td style={{ textTransform: 'capitalize' }}>{billing.plan}{billing.cancelAt ? ' (cancelling)' : ''}</td></tr>
          <tr><td className="muted">Billing status</td><td><span className={`badge ${billing.billingStatus === 'past_due' ? 'danger' : 'success'}`}>{billing.billingStatus}</span></td></tr>
          <tr><td className="muted">Voice minutes this period</td><td>{billing.voiceMinutesUsed} / {billing.voiceMinutesIncluded}</td></tr>
          <tr><td className="muted">SMS this period</td><td>{billing.smsUsed} / {billing.smsIncluded}</td></tr>
          <tr><td className="muted">Estimated this period</td><td>${billing.estimate.total.toFixed(2)}</td></tr>
        </tbody>
      </table>
      {billing.invoices.length > 0 && (
        <>
          <h2 style={{ marginTop: 18, fontSize: 14 }}>Invoice history</h2>
          <table>
            <thead><tr><th>Period</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {billing.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{new Date(inv.period_start).toLocaleDateString()} – {new Date(inv.period_end).toLocaleDateString()}</td>
                  <td>${inv.total_amount.toFixed(2)}</td>
                  <td><span className={`badge ${inv.status === 'paid' ? 'success' : inv.status === 'failed' ? 'danger' : 'neutral'}`}>{inv.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function DeleteCompanySection({ company, id }) {
  const router = useRouter();
  const toast = useToast();
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setDeleting(true);
    setError(null);
    try {
      await platformApi.deleteCompany(id, confirmName);
      toast.success(`${company.name} deleted`);
      router.push('/platform/companies');
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--danger)' }}>
      <h2>Delete company</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        Permanently removes {company.name} and everything it owns — admins, services, staff,
        bookings, call logs, customers, knowledge base history. This cannot be undone.
      </p>
      <form onSubmit={submit} className="row" style={{ alignItems: 'center' }}>
        <input
          placeholder={`Type "${company.name}" to confirm`}
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          style={{ width: 260 }}
        />
        <button type="submit" className="danger" disabled={deleting || confirmName !== company.name}>
          <Trash2 size={15} /> {deleting ? 'Deleting...' : 'Delete permanently'}
        </button>
      </form>
      {error && <p className="error-text" style={{ marginTop: 4 }}>{error}</p>}
    </div>
  );
}

function CompanyDetailInner() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const [company, setCompany] = useState(null);
  const [error, setError] = useState(null);
  const [togglingStatus, setTogglingStatus] = useState(false);

  const load = () => platformApi.getCompany(id).then(setCompany).catch((e) => setError(e instanceof ApiError ? e.message : 'failed to load'));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleListing() {
    try {
      const hide = !company.listing.hiddenByPlatform;
      await platformApi.setCompanyListingHidden(id, hide);
      toast.success(hide ? `${company.name} hidden from the directory` : `${company.name} is visible in the directory again`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function toggleStatus() {
    setTogglingStatus(true);
    try {
      const next = company.status === 'suspended' ? 'active' : 'suspended';
      await platformApi.setCompanyStatus(id, next);
      toast.success(next === 'suspended' ? `${company.name} suspended` : `${company.name} reactivated`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTogglingStatus(false);
    }
  }

  if (error) return <p className="error-text">{error}</p>;
  if (!company) return <Loading />;

  return (
    <div className="stack">
      <div>
        <button className="ghost" onClick={() => router.push('/platform/companies')} style={{ marginBottom: 10 }}>
          <ArrowLeft size={14} /> All companies
        </button>
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>{company.name}</h1>
          <span className={`badge ${company.status === 'suspended' ? 'danger' : 'success'}`}>{company.status}</span>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat"><div className="value">{company.serviceCount}</div><div className="label">Services</div></div>
        <div className="stat"><div className="value">{company.staffCount}</div><div className="label">Staff</div></div>
        <div className="stat"><div className="value">{company.upcomingBookings}</div><div className="label">Upcoming</div></div>
      </div>

      <div className="card">
        <h2>Profile</h2>
        <table>
          <tbody>
            <tr><td className="muted" style={{ width: 160 }}>Timezone</td><td>{company.timezone}</td></tr>
            <tr><td className="muted">Booking phone number</td><td>{company.phoneNumber ?? 'Not provisioned'}</td></tr>
            <tr><td className="muted">Contact email</td><td>{company.contactEmail ?? '—'}</td></tr>
            <tr><td className="muted">Contact phone</td><td>{company.contactPhone ?? '—'}</td></tr>
            <tr><td className="muted">Address</td><td>{company.address ?? '—'}</td></tr>
            <tr><td className="muted">Google Calendar</td><td>{company.calendarConnected ? 'Connected' : 'Not connected'}</td></tr>
            <tr><td className="muted">Registered</td><td>{new Date(company.createdAt).toLocaleString()}</td></tr>
          </tbody>
        </table>
        <div style={{ marginTop: 16 }}>
          {company.status === 'suspended' ? (
            <button className="primary" onClick={toggleStatus} disabled={togglingStatus}><CheckCircle2 size={15} /> Reactivate company</button>
          ) : (
            <button className="danger" onClick={toggleStatus} disabled={togglingStatus}><Ban size={15} /> Suspend company</button>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Suspending blocks every admin at this company from logging in (existing sessions included) without deleting any data. Use it for billing holds or abuse, not for offboarding.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Public directory</h2>
        <p style={{ marginTop: 0 }}>
          Booking link: <code>/book/{company.slug ?? '—'}</code>{' '}
          {company.listing.hiddenByPlatform
            ? <span className="badge danger">Hidden by the platform</span>
            : <span className={`badge ${company.listing.listed ? 'success' : 'neutral'}`}>{company.listing.listed ? 'Listed by the owner' : 'Not listed'}</span>}
        </p>
        <button className={company.listing.hiddenByPlatform ? 'primary' : 'danger'} onClick={toggleListing}>
          {company.listing.hiddenByPlatform ? 'Show in directory again' : 'Hide from directory'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Hiding removes the company from search on /find only. Its booking link and account keep working. Use it for misleading listings.</p>
      </div>

      <div className="card">
        <h2>Admins</h2>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Added</th><th></th></tr></thead>
          <tbody>
            {company.admins.map((a) => <ResetPasswordRow key={a.id} admin={a} />)}
          </tbody>
        </table>
      </div>

      <BillingSection id={id} />
      <DeleteCompanySection company={company} id={id} />
    </div>
  );
}

export default function CompanyDetailPage() {
  return (
    <RequirePlatformAuth>
      <CompanyDetailInner />
    </RequirePlatformAuth>
  );
}
