// Numbers the AI is allowed to dial (transfer, departments, onboarding test call): well-formed E.164 in a country we
// actually serve. Anything else is how toll fraud starts: a stored premium-rate number the AI will happily ring.
// Override the list with ALLOWED_DIAL_PREFIXES (comma separated, with the +).
import { normalizePhone } from './services/customerService.js';

const prefixes = () => (process.env.ALLOWED_DIAL_PREFIXES || '+1,+44,+61,+92').split(',').map((p) => p.trim()).filter(Boolean);

// The normalised number, or null when it is not a number we will dial.
export function dialablePhone(raw) {
  const phone = normalizePhone(String(raw ?? ''));
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return prefixes().some((p) => phone.startsWith(p)) ? phone : null;
}
