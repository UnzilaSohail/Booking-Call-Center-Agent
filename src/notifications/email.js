import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';

const sendgridKey = process.env.SENDGRID_API_KEY;
const sendgridFrom = process.env.SENDGRID_FROM_EMAIL;
let sendgridConfigured = false;

function ensureSendgrid() {
  if (sendgridConfigured) return true;
  if (!sendgridKey || !sendgridFrom) return false;
  sgMail.setApiKey(sendgridKey);
  sendgridConfigured = true;
  return true;
}

// Gmail SMTP via an App Password — self-service in ~2 minutes (Google Account > Security
// > 2-Step Verification > App Passwords), no account signup or sender-verification wait
// like SendGrid needs. Good enough for this system's volume (team invites, verification
// codes, booking confirmations); switch to SendGrid if Gmail's sending limits are ever hit.
const gmailUser = process.env.GMAIL_USER;
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
let gmailTransport = null;

function ensureGmail() {
  if (gmailTransport) return true;
  if (!gmailUser || !gmailAppPassword) return false;
  gmailTransport = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailAppPassword } });
  return true;
}

// Read at call time so tests can toggle it.
export const emailConfigured = () => Boolean((process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL));

// Returns {sent, reason} instead of throwing/swallowing silently (Jira 29b) — callers
// that need the caller (e.g. team invites, KG "Aiza's invite never arrived") to know
// whether the email actually went out, not just whether the request completed.
// Gmail is tried first when configured, falling back to SendGrid.
//
// replyTo (optional): a business's own contact email, so a customer who replies to a
// booking confirmation reaches that business, not the platform's own sending account.
// The actual SMTP "From" stays the platform's authenticated address either way — you
// cannot send AS an arbitrary unauthenticated address (that's email spoofing, and every
// provider blocks it); Reply-To is the real, correct way to put a tenant's own address in
// the loop without that account being the one actually authenticated to send.
export async function sendEmail(to, subject, text, replyTo) {
  if (!to) return { sent: false, reason: 'no recipient address' };

  if (ensureGmail()) {
    try {
      await gmailTransport.sendMail({ from: gmailUser, to, subject, text, ...(replyTo ? { replyTo } : {}) });
      return { sent: true, reason: null };
    } catch (err) {
      console.error('Gmail SMTP send failed:', err.message);
      return { sent: false, reason: err.message };
    }
  }

  if (ensureSendgrid()) {
    try {
      await sgMail.send({ to, from: sendgridFrom, subject, text, ...(replyTo ? { replyTo } : {}) });
      return { sent: true, reason: null };
    } catch (err) {
      console.error('SendGrid send failed:', err.message);
      return { sent: false, reason: err.message };
    }
  }

  console.warn('Email not sent (no provider configured):', to, subject);
  return { sent: false, reason: 'no email provider configured — set GMAIL_USER/GMAIL_APP_PASSWORD or SENDGRID_API_KEY/SENDGRID_FROM_EMAIL' };
}
