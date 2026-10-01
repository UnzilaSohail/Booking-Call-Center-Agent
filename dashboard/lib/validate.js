// Small, friendly validators for forms (Jira 24g). Each returns '' when the value is fine, or a
// sentence that says what to fix and gives an example. The server still validates everything;
// these only catch the obvious slips before the customer presses the button.
export const validateName = (v) => (String(v ?? '').trim() ? '' : 'Please enter a name.');

export function validatePhone(v) {
  const digits = String(v ?? '').replace(/\D/g, '');
  if (!digits) return 'Please enter a phone number.';
  if (digits.length < 10) return 'That looks too short. Include the area code, for example (555) 123-4567.';
  if (digits.length > 15) return 'That number is too long.';
  return '';
}

export const validateEmail = (v) => {
  const s = String(v ?? '').trim();
  return !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? '' : "That email address doesn't look right. Example: name@example.com";
};

export const validateRequiredEmail = (v) => (String(v ?? '').trim() ? validateEmail(v) : 'Please enter an email address.');

export const validatePassword = (v) => (String(v ?? '').length >= 8 ? '' : 'Use at least 8 characters.');
