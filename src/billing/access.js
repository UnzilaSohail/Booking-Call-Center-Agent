// Who may use the metered services (voice, SMS, phone numbers) right now. Without this a free signup could run calls
// and texts forever: trial_ends_at and the plan's included minutes were only ever printed on invoices.
import { getPlan } from './plans.js';
import { computeUsage } from '../services/billingService.js';

// A trial that has run out and has no card behind it.
export function trialExpired(business, now = new Date()) {
  return business.plan === 'trial' && !!business.trial_ends_at && new Date(business.trial_ends_at) < now && !business.stripe_payment_method_id;
}

// Why this business may not take a call or send a text right now, or null. Voice only counts minutes for trials:
// paid plans are allowed past their included minutes (they are billed overage instead).
export async function serviceBlockedReason(business) {
  if (trialExpired(business)) return 'trial_expired';
  if (business.plan === 'trial' && business.current_period_start && business.current_period_end) {
    const { voiceMinutes } = await computeUsage(business.id ?? business._id, new Date(business.current_period_start), new Date(business.current_period_end));
    if (voiceMinutes >= getPlan('trial').includedVoiceMinutes) return 'trial_minutes_used';
  }
  return null;
}
