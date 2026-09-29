'use client';
import { useEffect, useState } from 'react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import { DateTime } from '../../lib/datetime';

const PLAN_ORDER = ['starter', 'growth', 'scale'];

function money(n) {
  return `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function UsageBar({ used, included }) {
  const pct = included > 0 ? Math.min(100, (used / included) * 100) : 0;
  const over = used > included;
  return (
    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: over ? 'var(--danger)' : undefined }} />
      </div>
      <span className="faint" style={{ fontSize: 11.5, flexShrink: 0, whiteSpace: 'nowrap' }}>{used} / {included}</span>
    </div>
  );
}

function InvoiceStatusBadge({ status }) {
  const cls = status === 'paid' ? 'success' : status === 'failed' ? 'danger' : 'neutral';
  return <span className={`badge ${cls}`}>{status}</span>;
}

function PlanAndUsageCard({ plan, usage, onChanged }) {
  const toast = useToast();
  const [switching, setSwitching] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  async function switchPlan(planId) {
    setSwitching(planId);
    try {
      await api.updateBillingPlan(planId);
      toast.success(`Switched to ${planId}`);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSwitching(null);
    }
  }

  async function toggleCancel() {
    setCancelling(true);
    try {
      if (plan.cancelAt) {
        await api.reactivateBillingPlan();
        toast.success('Cancellation undone');
      } else {
        await api.cancelBillingPlan();
        toast.success('Cancellation scheduled');
      }
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCancelling(false);
    }
  }

  const isTrial = plan.plan === 'trial';

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>{plan.planDetails.name} plan</h2>
          {isTrial && plan.trialEndsAt && (
            <p className="muted" style={{ marginTop: -6 }}>Trial ends {DateTime.formatDate(plan.trialEndsAt)}</p>
          )}
          {plan.cancelAt && (
            <p className="error-text" style={{ marginTop: 2 }}>Cancels at period end — access continues until {DateTime.formatDate(plan.cancelAt)}</p>
          )}
          {plan.billingStatus === 'past_due' && <span className="badge danger" style={{ marginTop: 6 }}>Payment past due</span>}
        </div>
        {!isTrial && (
          <button className={plan.cancelAt ? 'primary' : 'ghost'} onClick={toggleCancel} disabled={cancelling}>
            {cancelling ? '...' : plan.cancelAt ? 'Undo cancellation' : 'Cancel plan'}
          </button>
        )}
      </div>

      <div className="stack" style={{ gap: 12, marginTop: 14 }}>
        <div>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span>Voice minutes this period</span>
            <span className="muted">{usage ? money(usage.estimate.voiceOverageAmount) + ' overage' : ''}</span>
          </div>
          {usage && <UsageBar used={usage.voiceMinutesUsed} included={usage.voiceMinutesIncluded} />}
        </div>
        <div>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span>SMS this period</span>
            <span className="muted">{usage ? money(usage.estimate.smsOverageAmount) + ' overage' : ''}</span>
          </div>
          {usage && <UsageBar used={usage.smsUsed} included={usage.smsIncluded} />}
        </div>
      </div>

      {usage && (
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600 }}>Estimated this period</span>
          <span style={{ fontWeight: 600, fontFamily: 'var(--font-serif)', fontSize: 18 }}>{money(usage.estimate.total)}</span>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {isTrial ? 'Choose a plan' : 'Change plan'}
        </label>
        <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          {PLAN_ORDER.map((id) => {
            const details = plan.allPlans[id];
            const current = plan.plan === id;
            return (
              <div key={id} className="card" style={{ flex: '1 1 160px', padding: 14, border: current ? '2px solid var(--ink)' : undefined }}>
                <div style={{ fontWeight: 600 }}>{details.name}</div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, margin: '4px 0' }}>{money(details.monthlyPrice)}<span className="muted" style={{ fontSize: 12 }}>/mo</span></div>
                <div className="muted" style={{ fontSize: 11.5 }}>{details.includedVoiceMinutes} min · {details.includedSms} SMS included</div>
                <button
                  className={current ? 'ghost' : 'primary'} style={{ width: '100%', marginTop: 10 }}
                  disabled={current || switching === id}
                  onClick={() => switchPlan(id)}
                >
                  {current ? 'Current plan' : switching === id ? '...' : 'Switch'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PaymentMethodCard({ plan, onChanged }) {
  const toast = useToast();
  const [stripeReady, setStripeReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  useEffect(() => {
    if (!publishableKey || plan.paymentMethod) return;
    if (window.Stripe) { setStripeReady(true); return; }
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => setStripeReady(true);
    document.head.appendChild(script);
  }, [publishableKey, plan.paymentMethod]);

  useEffect(() => {
    if (!stripeReady || plan.paymentMethod) return;
    const stripe = window.Stripe(publishableKey);
    const elements = stripe.elements();
    const card = elements.create('card');
    card.mount('#billing-card-element');

    const form = document.getElementById('billing-card-form');
    const handler = async (e) => {
      e.preventDefault();
      setSaving(true);
      setError(null);
      try {
        const { clientSecret } = await api.createSetupIntent();
        const { setupIntent, error: stripeError } = await stripe.confirmCardSetup(clientSecret, { payment_method: { card } });
        if (stripeError) throw new Error(stripeError.message);
        await api.savePaymentMethod(setupIntent.payment_method);
        toast.success('Payment method saved');
        onChanged();
      } catch (err) {
        setError(err.message);
      } finally {
        setSaving(false);
      }
    };
    form?.addEventListener('submit', handler);
    return () => { form?.removeEventListener('submit', handler); card.unmount(); };
  }, [stripeReady, plan.paymentMethod, publishableKey, onChanged, toast]);

  return (
    <div className="card">
      <h2>Payment method</h2>
      {plan.paymentMethod ? (
        <p style={{ marginTop: 8 }}>
          <span className="badge neutral" style={{ textTransform: 'capitalize' }}>{plan.paymentMethod.brand}</span> ending in {plan.paymentMethod.last4}
        </p>
      ) : !publishableKey ? (
        <p className="muted" style={{ marginTop: 8 }}>Stripe is not configured — no card can be collected yet. Usage tracking and invoicing still work; charging is skipped until a Stripe key is set.</p>
      ) : (
        <form id="billing-card-form" className="stack" style={{ marginTop: 8 }}>
          <div id="billing-card-element" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="primary" disabled={!stripeReady || saving}>{saving ? 'Saving...' : 'Save card'}</button>
        </form>
      )}
    </div>
  );
}

function InvoicesCard({ invoices, onChanged }) {
  const toast = useToast();
  const [retrying, setRetrying] = useState(null);

  async function retry(id) {
    setRetrying(id);
    try {
      const res = await api.retryInvoice(id);
      toast[res.status === 'paid' ? 'success' : 'error'](res.status === 'paid' ? 'Payment succeeded' : 'Payment still failing');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="card">
      <h2>Invoices</h2>
      {invoices.length === 0 && <p className="muted">No invoices yet — the first one is generated when your current billing period closes.</p>}
      {invoices.length > 0 && (
        <table>
          <thead><tr><th>Period</th><th>Plan</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{DateTime.formatDate(inv.period_start)} – {DateTime.formatDate(inv.period_end)}</td>
                <td style={{ textTransform: 'capitalize' }}>{inv.plan}</td>
                <td>{money(inv.total_amount)}</td>
                <td><InvoiceStatusBadge status={inv.status} /></td>
                <td>
                  {inv.status === 'failed' && (
                    <button className="ghost" onClick={() => retry(inv.id)} disabled={retrying === inv.id}>{retrying === inv.id ? '...' : 'Retry'}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BillingInner() {
  const [plan, setPlan] = useState(null);
  const [usage, setUsage] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState(null);

  function load() {
    api.getBillingPlan().then(setPlan).catch((e) => setError(e.message));
    api.getBillingUsage().then(setUsage).catch(() => {});
    api.listInvoices().then(setInvoices).catch(() => {});
  }
  useEffect(load, []);

  return (
    <div className="stack">
      <div>
        <h1>Billing</h1>
        <p className="muted" style={{ marginTop: 4 }}>Your plan, usage this period, payment method, and invoice history.</p>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!plan && !error && <p className="muted">Loading...</p>}
      {plan && (
        <>
          <PlanAndUsageCard plan={plan} usage={usage} onChanged={load} />
          <PaymentMethodCard plan={plan} onChanged={load} />
          <InvoicesCard invoices={invoices} onChanged={load} />
        </>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <RequireAuth area="billing">
      <BillingInner />
    </RequireAuth>
  );
}
