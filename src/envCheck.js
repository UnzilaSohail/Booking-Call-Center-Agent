// Settings the live server cannot work properly without. Only JWT_SECRET is a hard stop (src/auth.js); a
// missing one of these is reported loudly at boot instead of crashing, because a restart loop would take the
// dashboard down together with the calls.
const PRODUCTION_SETTINGS = [
  'MONGODB_URI', 'ENCRYPTION_KEY', 'GEMINI_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'PUBLIC_HTTPS_URL', 'PUBLIC_WSS_URL', 'PUBLIC_DASHBOARD_URL', 'STRIPE_WEBHOOK_SECRET',
];

export function missingProductionSettings(env = process.env) {
  return env.NODE_ENV === 'production' ? PRODUCTION_SETTINGS.filter((name) => !env[name]) : [];
}

export function reportMissingSettings(env = process.env) {
  const missing = missingProductionSettings(env);
  if (missing.length) console.error(`CONFIG: production is missing ${missing.join(', ')}. Features that need them will fail.`);
  return missing;
}
