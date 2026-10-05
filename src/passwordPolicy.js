// Password rules for every place a password is chosen (Jira 36l): at least 10 characters, and nothing that is on
// every attacker's first-guess list. Checked on the server; the dashboard only checks the length for quick feedback.
// Existing passwords are not touched: the rule applies the next time someone sets one.
export const MIN_PASSWORD_LENGTH = 10;

// Exact matches (after lower-casing and removing spaces) and pieces that make any password weak.
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty', 'qwertyuiop', 'qwerty123', 'qwertyuiop123', 'letmein', 'letmein123',
  'welcome', 'welcome1', 'welcome123', 'admin', 'admin123', 'administrator', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'abc123', 'abcdefghij', 'changeme',
  'changeme123', 'secret', 'secret123', 'login', 'master', 'sunshine', 'princess', 'trustno1', 'starwars', 'whatever', '1q2w3e4r5t', 'zaq12wsx', 'bookingagent',
  'booking123', 'business', 'business123', 'company123', 'testtest', 'test1234', 'test12345', 'asdfghjkl', 'asdfghjkl1', 'iloveyou1', 'internet', 'computer',
]);
const WEAK_PIECES = ['password', 'qwerty', '123456', 'abcdef', 'letmein', 'asdfgh'];

// Returns a plain-language reason the password is not acceptable, or null when it is fine.
export function checkPassword(password, email = '') {
  const pw = String(password ?? '');
  const lower = pw.toLowerCase().replace(/\s+/g, '');
  const tip = 'Use at least 10 characters that are not easy to guess, such as three or four unrelated words.';
  if (pw.length < MIN_PASSWORD_LENGTH) return `That password is too short. ${tip}`;
  if (COMMON.has(lower) || WEAK_PIECES.some((w) => lower.includes(w))) return `That password is too common. ${tip}`;
  if (new Set(lower).size <= 3) return `That password repeats the same few characters. ${tip}`;
  const name = String(email).split('@')[0].toLowerCase();
  if (name.length >= 4 && lower.includes(name)) return `The password should not contain your email name. ${tip}`;
  return null;
}
