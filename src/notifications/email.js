import sgMail from '@sendgrid/mail';

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL;
let configured = false;

function ensureConfigured() {
  if (configured) return true;
  if (!apiKey || !fromEmail) return false;
  sgMail.setApiKey(apiKey);
  configured = true;
  return true;
}

// Returns {sent, reason} instead of throwing/swallowing silently (Jira 29b) — callers
// that need the caller (e.g. team invites, KG "Aiza's invite never arrived") to know
// whether the email actually went out, not just whether the request completed.
export async function sendEmail(to, subject, text) {
  if (!to) return { sent: false, reason: 'no recipient address' };
  if (!ensureConfigured()) {
    console.warn('Email not sent (SendGrid not configured):', to, subject);
    return { sent: false, reason: 'SendGrid not configured' };
  }
  try {
    await sgMail.send({ to, from: fromEmail, subject, text });
    return { sent: true, reason: null };
  } catch (err) {
    console.error('SendGrid send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}
