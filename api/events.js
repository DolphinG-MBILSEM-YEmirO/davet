// Events API. vercel.json rewrites pretty URLs onto this one function:
//
//   POST   /api/events                          create an event
//   GET    /api/events/:id                      event + RSVPs + comments
//   PATCH  /api/events/:id                      edit (host only)
//   DELETE /api/events/:id                      delete (host only)
//   POST   /api/events/:id/rsvp                 add or change an RSVP
//   POST   /api/events/:id/comments             post on the wall
//   DELETE /api/events/:id/comments/:commentId  remove a post (host or author)
//
// There are no accounts. Creating an event returns a secret host token, and
// each RSVP/comment returns its own secret token; only their SHA-256 hashes
// are stored. The browser keeps the tokens in localStorage.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from './_lib/store.js';
import { HttpError, validateEventInput, validateRsvpInput, validateCommentInput } from './_lib/validate.js';
import { LIMITS } from '../js/shared/rules.js';

const DAY_SECONDS = 24 * 60 * 60;
// Events stay readable for 60 days after they happen, then expire.
const KEEP_AFTER_EVENT_SECONDS = 60 * DAY_SECONDS;
const MIN_TTL_SECONDS = 7 * DAY_SECONDS;
// Turkey has used UTC+3 all year since 2016.
const TURKEY_OFFSET = '+03:00';

const WRITE_LIMIT_PER_MINUTE = 30;
const CREATE_LIMIT_PER_HOUR = 20;

const ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

const newId = (bytes) => randomBytes(bytes).toString('base64url');
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

function tokenMatches(token, expectedHash) {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function ttlFor(event) {
  const startsAtMs = Date.parse(`${event.startsAt}:00${TURKEY_OFFSET}`);
  const secondsLeft = Math.round((startsAtMs - Date.now()) / 1000) + KEEP_AFTER_EVENT_SECONDS;
  return Math.max(secondsLeft, MIN_TTL_SECONDS);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded || '').split(',')[0].trim() || 'local';
}

async function enforceRateLimit(store, req, scope, limit, windowSeconds) {
  const count = await store.hit(`${scope}:${clientIp(req)}`, windowSeconds);
  if (count > limit) throw new HttpError(429, 'Çok fazla istek gönderildi. Biraz sonra tekrar deneyin.');
}

async function readBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload === undefined ? '' : JSON.stringify(payload));
}

/** Public shape of an event: never includes token hashes. */
function publicEvent(event) {
  const { hostTokenHash, ...rest } = event;
  return rest;
}

const publicEntry = ({ tokenHash, ...rest }) => rest;

async function loadEvent(store, id) {
  if (!ID_PATTERN.test(id || '')) throw new HttpError(404, 'Davet bulunamadı.');
  const event = await store.getEvent(id);
  if (!event) throw new HttpError(404, 'Davet bulunamadı ya da süresi doldu.');
  return event;
}

function requireHost(req, event) {
  if (!tokenMatches(req.headers['x-host-token'], event.hostTokenHash)) {
    throw new HttpError(403, 'Bu işlemi yalnızca daveti oluşturan kişi yapabilir.');
  }
}

async function createEvent(store, req) {
  await enforceRateLimit(store, req, 'create', CREATE_LIMIT_PER_HOUR, 60 * 60);
  const input = validateEventInput(await readBody(req));
  const hostToken = newId(24);
  const now = new Date().toISOString();
  const event = { id: newId(7), ...input, hostTokenHash: hashToken(hostToken), createdAt: now, updatedAt: now };
  await store.putEvent(event, ttlFor(event));
  return { status: 201, payload: { id: event.id, hostToken } };
}

async function getEvent(store, req, id) {
  const event = await loadEvent(store, id);
  const [rsvps, comments] = await Promise.all([store.getRsvps(id), store.getComments(id)]);
  rsvps.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    status: 200,
    payload: {
      event: publicEvent(event),
      rsvps: rsvps.map(publicEntry),
      comments: comments.map(publicEntry),
      isHost: tokenMatches(req.headers['x-host-token'], event.hostTokenHash),
    },
  };
}

async function updateEvent(store, req, id) {
  const event = await loadEvent(store, id);
  requireHost(req, event);
  const input = validateEventInput(await readBody(req));
  const updated = { ...event, ...input, updatedAt: new Date().toISOString() };
  await store.putEvent(updated, ttlFor(updated));
  return { status: 200, payload: { event: publicEvent(updated) } };
}

async function deleteEvent(store, req, id) {
  const event = await loadEvent(store, id);
  requireHost(req, event);
  await store.deleteEvent(id);
  return { status: 204 };
}

async function saveRsvp(store, req, id) {
  const event = await loadEvent(store, id);
  const body = await readBody(req);
  const input = validateRsvpInput(body);
  const now = new Date().toISOString();

  // Changing an existing RSVP requires the secret returned when it was made.
  if (body.guestId) {
    const existing = (await store.getRsvps(id)).find((rsvp) => rsvp.id === body.guestId);
    if (existing && tokenMatches(body.guestToken, existing.tokenHash)) {
      const updated = { ...existing, ...input, updatedAt: now };
      await store.putRsvp(id, updated, ttlFor(event));
      return { status: 200, payload: { rsvp: publicEntry(updated) } };
    }
  }

  if ((await store.countRsvps(id)) >= LIMITS.rsvpsPerEvent) {
    throw new HttpError(409, 'Bu davet dolu, yeni cevap eklenemiyor.');
  }
  const guestToken = newId(24);
  const rsvp = { id: newId(6), ...input, tokenHash: hashToken(guestToken), createdAt: now, updatedAt: now };
  await store.putRsvp(id, rsvp, ttlFor(event));
  return { status: 201, payload: { rsvp: publicEntry(rsvp), guestToken } };
}

async function addComment(store, req, id) {
  const event = await loadEvent(store, id);
  const input = validateCommentInput(await readBody(req));
  if ((await store.countComments(id)) >= LIMITS.commentsPerEvent) {
    throw new HttpError(409, 'Bu davetin duvarı doldu.');
  }
  const commentToken = newId(24);
  const comment = { id: newId(6), ...input, tokenHash: hashToken(commentToken), createdAt: new Date().toISOString() };
  await store.putComment(id, comment, ttlFor(event));
  return { status: 201, payload: { comment: publicEntry(comment), commentToken } };
}

async function removeComment(store, req, id, commentId) {
  const event = await loadEvent(store, id);
  const comment = (await store.getComments(id)).find((item) => item.id === commentId);
  if (!comment) throw new HttpError(404, 'Mesaj bulunamadı.');
  const isHost = tokenMatches(req.headers['x-host-token'], event.hostTokenHash);
  const isAuthor = tokenMatches(req.headers['x-comment-token'], comment.tokenHash);
  if (!isHost && !isAuthor) throw new HttpError(403, 'Bu mesajı silemezsin.');
  await store.deleteComment(id, commentId);
  return { status: 204 };
}

/**
 * Read the route parameters. Vercel may hand the function either the original
 * pretty path or the rewritten query string, so both are understood.
 */
function routeParams(req) {
  const url = new URL(req.url, 'http://localhost');
  const [, id, action, commentId] = url.pathname.replace(/\/+$/, '').split('/').slice(2);
  const query = req.query || Object.fromEntries(url.searchParams);
  return {
    id: id || query.id || null,
    action: action || query.action || null,
    commentId: commentId || query.commentId || null,
  };
}

function route(req) {
  const { id, action, commentId } = routeParams(req);
  const method = req.method;

  if (!id && !action && method === 'POST') return (store) => createEvent(store, req);
  if (id && !action) {
    if (method === 'GET') return (store) => getEvent(store, req, id);
    if (method === 'PATCH') return (store) => updateEvent(store, req, id);
    if (method === 'DELETE') return (store) => deleteEvent(store, req, id);
  }
  if (id && action === 'rsvp' && method === 'POST') return (store) => saveRsvp(store, req, id);
  if (id && action === 'comments' && !commentId && method === 'POST') return (store) => addComment(store, req, id);
  if (id && action === 'comments' && commentId && method === 'DELETE') {
    return (store) => removeComment(store, req, id, commentId);
  }
  return null;
}

export default async function handler(req, res) {
  const run = route(req);
  if (!run) return send(res, 404, { error: 'Bulunamadı.' });

  const store = getStore();
  if (!store) return send(res, 503, { error: 'Veritabanı bağlı değil.' });

  try {
    if (req.method !== 'GET') await enforceRateLimit(store, req, 'write', WRITE_LIMIT_PER_MINUTE, 60);
    const { status, payload } = await run(store);
    return send(res, status, payload);
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, { error: error.message });
    if (error instanceof SyntaxError) return send(res, 400, { error: 'İstek okunamadı.' });
    console.error(error);
    return send(res, 500, { error: 'Bir şeyler ters gitti. Tekrar deneyin.' });
  }
}
