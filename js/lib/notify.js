// Tells the host of a plan shared from Sharloop that someone answered, as a
// notification on their phone. Davet only does this for invites that carry
// the host's Sharloop friend code (see validateSharloopFields).
//
// The whole path runs in the guest's browser; Sharloop's server only
// forwards ciphertext (see api/bildir.ts and shared/bildirim.ts in Sharloop):
//   1. find the host's devices: Sharloop copies each account's push
//      addresses into its directory entry, a record anyone who knows the
//      friend code can find and read;
//   2. sign a small payload with this guest's key for the invite. The
//      host's phone shows its text because it names the invite's secret,
//      which only people with the link know; anything else gets a fixed
//      sentence there;
//   3. encrypt it for each device (RFC 8291) and hand it to Sharloop's
//      /api/bildir, which adds its VAPID signature and forwards it.
// A notification that doesn't go out never fails the answer itself.

import { fromBase64Url, toBase64Url, toHex } from './crypto.js';
import { SHARLOOP_URL } from '../shared/rules.js';

const KIND = 30078;
const NOTIFICATION_KIND = 27235;
const MAX_DEVICES = 10;
const TITLE_MAX = 80;
const BODY_MAX = 180;
const RECORD_SIZE = 4096;

// How the host's notification puts an answer, as Sharloop does: "Zeynep geliyor".
const STATUS_TEXT = { going: 'geliyor', maybe: 'belki gelir', declined: 'gelemiyor' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/* ---------- 1. The host's devices ---------- */

/**
 * Sharloop's directory channel for a friend code (src/sosyal/nostr/kanal.ts):
 * the relay tag, the AES key and the record's d tag all come from the code.
 */
async function directoryRecord(code) {
  const secret = await sha256(`cepdost/dizin/kod/${code}`);
  const [topic, aes, dKey] = await Promise.all([
    hmac(secret, 'cepdost/konu'),
    hmac(secret, 'cepdost/sifre'),
    hmac(secret, 'cepdost/d'),
  ]);
  return {
    topic: toHex(topic),
    dTag: toHex(await hmac(dKey, 'bildirim')).slice(0, 40),
    aesKey: await crypto.subtle.importKey('raw', aes, { name: 'AES-GCM' }, false, ['decrypt']),
  };
}

async function decryptRecord(aesKey, payload) {
  try {
    const bytes = fromBase64Url(payload);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, aesKey, bytes.slice(12));
    return JSON.parse(decoder.decode(plain));
  } catch {
    return null;
  }
}

/** Devices that take plan-answer notifications, as Sharloop's bildirimAdresleriAl reads them. */
export function cleanAddresses(record) {
  const list = record && typeof record === 'object' && Array.isArray(record.adresler) ? record.adresler : [];
  return list
    .filter(
      (address) =>
        address &&
        address.tur === 'webpush' &&
        typeof address.endpoint === 'string' &&
        address.endpoint.startsWith('https://') &&
        /^[A-Za-z0-9_-]{87}$/.test(address.p256dh) &&
        /^[A-Za-z0-9_-]{22}$/.test(address.auth) &&
        Array.isArray(address.turler) &&
        address.turler.includes('link'),
    )
    .slice(0, MAX_DEVICES)
    .map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth }));
}

async function hostDevices({ nostr, pool, hostPubkey, code }) {
  const record = await directoryRecord(code);
  const { events } = await pool.query({ kinds: [KIND], authors: [hostPubkey], '#d': [record.dTag], '#i': [record.topic] });
  const newest = events
    .filter((event) => event.pubkey === hostPubkey && nostr.verifyEvent(event))
    .sort((a, b) => b.created_at - a.created_at)[0];
  if (!newest) return [];
  const envelope = await decryptRecord(record.aesKey, newest.content);
  // Records are { t: type, k: key, v: value }; the key must be the one the d tag stands for.
  if (!envelope || envelope.k !== 'bildirim') return [];
  return cleanAddresses(envelope.v);
}

/* ---------- 2. The payload ---------- */

function shorten(text, max) {
  const single = String(text).replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

/** The signed notification Sharloop's service worker reads (shared/bildirim.ts there). */
export function signedPayload(nostr, secretKey, { secret, title, name, status }) {
  const content = {
    tur: 'link',
    baslik: shorten(`${name} ${STATUS_TEXT[status]}`, TITLE_MAX),
    govde: shorten(title, BODY_MAX),
    git: `davet:${secret}`,
    etiket: `davet:${secret}`,
  };
  const event = nostr.finalizeEvent(
    { kind: NOTIFICATION_KIND, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(content) },
    secretKey,
  );
  return encoder.encode(JSON.stringify(event));
}

/* ---------- 3. Encryption (RFC 8291, aes128gcm) ---------- */

async function hkdf(salt, input, info, length) {
  const key = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Encrypts `plain` for one push subscription; returns the request body, base64url. */
export async function encryptForDevice(plain, { p256dh, auth }) {
  const receiverKey = fromBase64Url(p256dh);
  const authSecret = fromBase64Url(auth);
  const receiver = await crypto.subtle.importKey('raw', receiverKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiver }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(encoder.encode('WebPush: info\0'), receiverKey, localPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (and only) record.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plain, Uint8Array.of(2))));

  // Header: salt (16) | record size (4, big-endian) | key id length (1) | key id.
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = localPublic.length;
  return toBase64Url(concat(header, localPublic, cipher));
}

/* ---------- Putting it together ---------- */

let send = (deliveries) =>
  fetch(`${SHARLOOP_URL}/api/bildir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gonderimler: deliveries }),
  });

/** Tests catch deliveries here instead of posting them. */
export function setSender(sender) {
  send = sender;
}

/**
 * Notifies the host about an answer. `invite` comes from api.js (nostr, the
 * guest's personal key, the host's key); `event` is the cleaned invite.
 * Resolves to the number of devices reached; never throws.
 */
export async function notifyHost({ invite, pool, secret, event, rsvp }) {
  try {
    const code = event.sharloop?.kod;
    if (!code || !STATUS_TEXT[rsvp.status]) return 0;
    const devices = await hostDevices({ nostr: invite.nostr, pool, hostPubkey: invite.hostPubkey, code });
    if (devices.length === 0) return 0;
    const plain = signedPayload(invite.nostr, invite.personalKey, { secret, title: event.title, name: rsvp.name, status: rsvp.status });
    const deliveries = await Promise.all(
      devices.map(async (device) => ({ endpoint: device.endpoint, govde: await encryptForDevice(plain, device) })),
    );
    await send(deliveries);
    return deliveries.length;
  } catch (error) {
    console.warn('Bildirim gönderilemedi', error);
    return 0;
  }
}
