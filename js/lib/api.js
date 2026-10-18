// Data layer with no server of our own. Invites, RSVPs and wall posts are
// stored as encrypted, signed Nostr events (kind 30078, "application data")
// on free public relays; see relays.js and crypto.js.
//
// Who may change what is enforced with signatures instead of a server:
//   - the invite is signed by a key created for it; its public half is part
//     of the link, so only events from that key count as the invite;
//   - every guest signs their own RSVP and posts with a per-invite key, and an
//     RSVP or post can only be replaced by a newer event from the same key.
//
// Link format: #/e/<secret>.<host public key>, both base64url.

import { local } from './local.js';
import { loadNostr } from './nostr.js';
import { RelayPool, configuredRelays } from './relays.js';
import {
  decryptJson,
  derivePersonalKey,
  encryptJson,
  fromBase64Url,
  fromHex,
  inviteKeys,
  randomBytes,
  randomId,
  toBase64Url,
  toHex,
} from './crypto.js';
import {
  ValidationError,
  validateCommentInput,
  validateEventInput,
  validateFinalizeInput,
  validateRsvpInput,
} from '../shared/validate.js';
import { DATETIME_PATTERN, LIMITS } from '../shared/rules.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const KIND = 30078;
const DAY_SECONDS = 24 * 60 * 60;
// Relays drop events 60 days after the invite's date (NIP-40 expiration).
const KEEP_AFTER_EVENT_SECONDS = 60 * DAY_SECONDS;
const MIN_KEEP_SECONDS = 7 * DAY_SECONDS;
const TURKEY_OFFSET = '+03:00';

const NO_CONNECTION = 'Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.';

let pool = null;
const relayPool = () => (pool ??= new RelayPool(configuredRelays()));

const nowSeconds = () => Math.floor(Date.now() / 1000);

/* ---------- Links and keys ---------- */

function parseLinkId(linkId) {
  const [secret = '', host = ''] = String(linkId).split('.');
  try {
    const secretBytes = fromBase64Url(secret);
    const hostBytes = fromBase64Url(host);
    if (secretBytes.length === 16 && hostBytes.length === 32) {
      return { secretBytes, hostPubkey: toHex(hostBytes) };
    }
  } catch {
    // Fall through to "not found".
  }
  throw new ApiError(404, 'Davet linki hatalı. Linki tekrar kopyalamayı dene.');
}

/** Everything needed to read and write one invite. */
async function openInvite(linkId) {
  const { secretBytes, hostPubkey } = parseLinkId(linkId);
  const { topic, aesKey } = await inviteKeys(secretBytes);
  const nostr = await loadNostr();
  const personalKey = await derivePersonalKey(fromBase64Url(local.seed()), topic);
  const hostToken = local.hostToken(linkId);
  const hostKey = hostToken ? fromHex(hostToken) : null;
  const isHost = Boolean(hostKey) && nostr.getPublicKey(hostKey) === hostPubkey;
  return {
    nostr,
    topic,
    aesKey,
    hostPubkey,
    hostKey: isHost ? hostKey : null,
    personalKey,
    personalPubkey: nostr.getPublicKey(personalKey),
  };
}

/* ---------- Publishing ---------- */

function expirationFor(details) {
  const latest = [details.startsAt, ...(details.timeOptions || [])].filter(Boolean).sort().pop();
  const startsAt = Math.floor(Date.parse(`${latest}:00${TURKEY_OFFSET}`) / 1000) || nowSeconds();
  return Math.max(startsAt + KEEP_AFTER_EVENT_SECONDS, nowSeconds() + MIN_KEEP_SECONDS);
}

// Replaceable events are ordered by their second-resolution timestamp, so two
// saves of the same thing within one second must still get increasing times.
const lastCreatedAt = new Map();

function createdAtFor(key) {
  const createdAt = Math.max(nowSeconds(), (lastCreatedAt.get(key) || 0) + 1);
  lastCreatedAt.set(key, createdAt);
  return createdAt;
}

async function publish(invite, secretKey, dTag, content, expiresAt) {
  const event = invite.nostr.finalizeEvent(
    {
      kind: KIND,
      created_at: createdAtFor(dTag),
      tags: [
        ['d', dTag],
        ['i', invite.topic],
        ['expiration', String(expiresAt)],
        ['alt', 'Davet: şifreli davet verisi'],
      ],
      content: await encryptJson(invite.aesKey, content),
    },
    secretKey,
  );
  const { reached, accepted } = await relayPool().publish(event);
  if (reached === 0) throw new ApiError(0, NO_CONNECTION);
  if (accepted === 0) throw new ApiError(503, 'Kaydedilemedi. Biraz sonra tekrar dene.');
}

/* ---------- Reading ---------- */

/** Keep only the newest event for each (author, d tag), like relays do for replaceable events. */
function newestByAuthorAndTag(events) {
  const newest = new Map();
  for (const event of events) {
    const dTag = event.tags?.find((tag) => tag[0] === 'd')?.[1];
    if (!dTag) continue;
    const key = `${event.pubkey}:${dTag}`;
    const current = newest.get(key);
    if (!current || event.created_at > current.created_at) newest.set(key, { ...event, dTag });
  }
  return [...newest.values()];
}

const isoFromSeconds = (seconds) => new Date(seconds * 1000).toISOString();

/** Validate the stored invite. A closed poll keeps its options so votes still count. */
function cleanInvite(data) {
  const pollOpen = data.pollOpen === true;
  const details = validateEventInput(pollOpen ? data : { ...data, timeOptions: [] });
  const timeOptions = pollOpen
    ? details.timeOptions
    : (Array.isArray(data.timeOptions) ? data.timeOptions : []).filter((option) => DATETIME_PATTERN.test(option));
  return { ...details, timeOptions, pollOpen };
}

/** Read and validate every event of an invite. Throws 404 if there is no invite. */
async function readInvite(invite) {
  const { reached, events } = await relayPool().query({ kinds: [KIND], '#i': [invite.topic] });
  if (reached === 0) throw new ApiError(0, NO_CONNECTION);

  // Relays are untrusted: drop anything with a bad signature or that won't decrypt.
  const latest = newestByAuthorAndTag(events.filter((event) => invite.nostr.verifyEvent(event)));
  const decrypted = await Promise.all(
    latest.map(async (raw) => ({ raw, data: await decryptJson(invite.aesKey, raw.content) })),
  );
  const items = decrypted.filter(({ data }) => data && typeof data === 'object');

  const inviteItem = items.find(({ raw }) => raw.pubkey === invite.hostPubkey && raw.dTag === invite.topic);
  if (!inviteItem || inviteItem.data.deleted) throw new ApiError(404, 'Davet bulunamadı ya da silindi.');

  let event;
  try {
    event = cleanInvite(inviteItem.data);
  } catch {
    throw new ApiError(404, 'Davet okunamadı.');
  }
  event.updatedAt = String(inviteItem.raw.created_at);
  const hidden = new Set(Array.isArray(inviteItem.data.hiddenComments) ? inviteItem.data.hiddenComments : []);

  const rsvps = items
    .filter(({ raw }) => raw.dTag === `${invite.topic}:rsvp`)
    .sort((a, b) => a.raw.created_at - b.raw.created_at)
    .flatMap(({ raw, data }) => {
      try {
        const clean = validateRsvpInput(data, { pollOpen: true, timeOptions: event.timeOptions });
        // Once the host picks a time, people who voted for it count as coming.
        const status =
          !event.pollOpen && clean.status === 'maybe' && clean.available.includes(event.startsAt) ? 'going' : clean.status;
        return [
          {
            id: raw.pubkey.slice(0, 16),
            ...clean,
            status,
            createdAt: isoFromSeconds(raw.created_at),
            isMine: raw.pubkey === invite.personalPubkey,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, LIMITS.rsvpsPerEvent);

  const commentPrefix = `${invite.topic}:c:`;
  const comments = items
    .filter(({ raw }) => raw.dTag.startsWith(commentPrefix))
    .flatMap(({ raw, data }) => {
      const id = raw.dTag.slice(commentPrefix.length);
      if (data.deleted || hidden.has(id)) return [];
      try {
        return [
          {
            id,
            ...validateCommentInput(data),
            createdAt: isoFromSeconds(raw.created_at),
            isMine: raw.pubkey === invite.personalPubkey,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, LIMITS.commentsPerEvent);

  return { event, rsvps, comments, inviteData: inviteItem.data };
}

/** Turn validation and unexpected errors into ApiErrors with readable messages. */
async function guard(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ValidationError) throw new ApiError(error.status, error.message);
    throw new ApiError(0, error.message || 'Bir şeyler ters gitti. Tekrar dene.');
  }
}

async function publishInvite(invite, data) {
  if (!invite.hostKey) throw new ApiError(403, 'Bu işlemi yalnızca daveti oluşturan kişi yapabilir.');
  await publish(invite, invite.hostKey, invite.topic, data, expirationFor(data));
  return data;
}

/* ---------- Public API (same shape the views used with the old server) ---------- */

export const api = {
  /** Returns { id, hostToken }: the shareable link id and the host's secret key. */
  createEvent: (input) =>
    guard(async () => {
      const clean = validateEventInput(input);
      const nostr = await loadNostr();
      const hostKey = nostr.generateSecretKey();
      const id = `${toBase64Url(randomBytes(16))}.${toBase64Url(fromHex(nostr.getPublicKey(hostKey)))}`;
      local.setHostToken(id, toHex(hostKey));
      await publishInvite(await openInvite(id), { ...clean, hiddenComments: [] });
      return { id, hostToken: toHex(hostKey) };
    }),

  getEvent: (id) =>
    guard(async () => {
      const invite = await openInvite(id);
      const { event, rsvps, comments } = await readInvite(invite);
      return { event: { id, ...event }, rsvps, comments, isHost: Boolean(invite.hostKey) };
    }),

  updateEvent: (id, input) =>
    guard(async () => {
      const invite = await openInvite(id);
      const { inviteData } = await readInvite(invite);
      const saved = await publishInvite(invite, { ...inviteData, ...validateEventInput(input) });
      return { event: { id, ...saved } };
    }),

  deleteEvent: (id) =>
    guard(async () => {
      const invite = await openInvite(id);
      const { event } = await readInvite(invite);
      // The details are wiped; the date is kept only so relays know when to expire it.
      await publishInvite(invite, { deleted: true, startsAt: event.startsAt });
    }),

  finalizeEvent: (id, startsAt) =>
    guard(async () => {
      const invite = await openInvite(id);
      const { event, inviteData } = await readInvite(invite);
      const choice = validateFinalizeInput({ startsAt }, event);
      const saved = await publishInvite(invite, { ...inviteData, ...choice, pollOpen: false });
      return { event: { id, ...saved } };
    }),

  saveRsvp: (id, input) =>
    guard(async () => {
      const invite = await openInvite(id);
      const { event } = await readInvite(invite);
      const clean = validateRsvpInput(input, event);
      await publish(invite, invite.personalKey, `${invite.topic}:rsvp`, clean, expirationFor(event));
      const rsvp = { id: invite.personalPubkey.slice(0, 16), ...clean, createdAt: new Date().toISOString(), isMine: true };
      return { rsvp };
    }),

  addComment: (id, input) =>
    guard(async () => {
      const invite = await openInvite(id);
      const { event, comments } = await readInvite(invite);
      if (comments.length >= LIMITS.commentsPerEvent) throw new ApiError(409, 'Bu davetin duvarı doldu.');
      const clean = validateCommentInput(input);
      const commentId = randomId();
      await publish(invite, invite.personalKey, `${invite.topic}:c:${commentId}`, clean, expirationFor(event));
      return { comment: { id: commentId, ...clean, createdAt: new Date().toISOString(), isMine: true } };
    }),

  /** Authors delete their own posts; the host can hide anyone's post. */
  deleteComment: (id, commentId) =>
    guard(async () => {
      const invite = await openInvite(id);
      const { event, comments, inviteData } = await readInvite(invite);
      const comment = comments.find((item) => item.id === commentId);
      if (!comment) throw new ApiError(404, 'Mesaj bulunamadı.');
      if (comment.isMine) {
        await publish(invite, invite.personalKey, `${invite.topic}:c:${commentId}`, { deleted: true }, expirationFor(event));
      } else {
        const hiddenComments = [...new Set([...(inviteData.hiddenComments || []), commentId])];
        await publishInvite(invite, { ...inviteData, hiddenComments });
      }
    }),
};
