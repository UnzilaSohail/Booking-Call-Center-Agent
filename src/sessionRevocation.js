// A 12-hour login token used to stay valid after a password change or reset. Admins now carry a
// tokens_valid_after timestamp; any token minted before it is refused.
// iat is whole seconds, so the comparison is in seconds too: the fresh token handed back to the person who just
// changed their password (same second) stays valid.
export const tokenRevoked = (payload, validAfter) => !!validAfter && payload.iat < Math.floor(new Date(validAfter).getTime() / 1000);
