// Small WebCrypto helpers: random ids, encoding, and the per-invite keys.
//
// An invite link carries a random secret in its #fragment, which browsers
// never send to any server. From it we derive:
//   - topic: a public tag that lets relays find the invite's events, but
//     reveals nothing about it;
//   - an AES-GCM key that encrypts everything we publish, so relays only
//     ever store ciphertext.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  return Uint8Array.from(hex.match(/../g) || [], (pair) => parseInt(pair, 16));
}

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Derive the public topic and the encryption key from an invite secret. */
export async function inviteKeys(secretBytes) {
  const topic = toHex(await hmac(secretBytes, 'davet/topic'));
  const aesKey = await crypto.subtle.importKey(
    'raw',
    await hmac(secretBytes, 'davet/encryption'),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  return { topic, aesKey };
}

/**
 * A signing key for this browser and this invite, derived from a random seed
 * kept in localStorage. Using a different key per invite means relays can't
 * link the same person across invites.
 */
export async function derivePersonalKey(seedBytes, topic) {
  return hmac(seedBytes, `davet/person/${topic}`);
}

export async function encryptJson(aesKey, value) {
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoder.encode(JSON.stringify(value)));
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipher), iv.length);
  return toBase64Url(combined);
}

/** Returns null for anything that doesn't decrypt (wrong key or tampered data). */
export async function decryptJson(aesKey, payload) {
  try {
    const bytes = fromBase64Url(payload);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, aesKey, bytes.slice(12));
    return JSON.parse(decoder.decode(plain));
  } catch {
    return null;
  }
}
