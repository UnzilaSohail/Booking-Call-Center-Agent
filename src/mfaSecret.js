// Authenticator secrets are stored encrypted (AES-256-GCM, src/crypto.js) as 'enc:<ciphertext>'. A secret saved before
// this existed has no prefix and still opens; without ENCRYPTION_KEY new ones stay plain rather than failing a login.
import { encrypt, decrypt } from './crypto.js';

export const sealSecret = (secret) => (process.env.ENCRYPTION_KEY ? `enc:${encrypt(secret)}` : secret);
export const openSecret = (stored) => (typeof stored === 'string' && stored.startsWith('enc:') ? decrypt(stored.slice(4)) : stored);
