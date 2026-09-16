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

export async function sendEmail(to, subject, text) {
  if (!to || !ensureConfigured()) {
    console.warn('Email not sent (SendGrid not configured or no address):', to, subject);
    return;
  }
  await sgMail.send({ to, from: fromEmail, subject, text });
}
