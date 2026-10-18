// Input validation for the API. Each function returns clean values or throws
// an HttpError with a user-facing (Turkish) message.

import { THEMES, RSVP_STATUSES, LIMITS, DATETIME_PATTERN } from '../../js/shared/rules.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Trim a string field and enforce length limits. */
function text(value, { field, max, required = false }) {
  const clean = typeof value === 'string' ? value.trim().replace(/\s+\n/g, '\n') : '';
  if (required && !clean) throw new HttpError(400, `${field} boş olamaz.`);
  if (clean.length > max) throw new HttpError(400, `${field} en fazla ${max} karakter olabilir.`);
  return clean;
}

/** Single-line text: collapses newlines and repeated spaces. */
function line(value, options) {
  return text(typeof value === 'string' ? value.replace(/\s+/g, ' ') : value, options);
}

function startsAt(value) {
  if (typeof value !== 'string' || !DATETIME_PATTERN.test(value)) {
    throw new HttpError(400, 'Geçerli bir tarih ve saat seçin.');
  }
  const date = new Date(`${value}:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 16) !== value) {
    throw new HttpError(400, 'Geçerli bir tarih ve saat seçin.');
  }
  return value;
}

export function validateEventInput(body) {
  const theme = THEMES.some((item) => item.id === body?.theme) ? body.theme : THEMES[0].id;
  return {
    title: line(body?.title, { field: 'Başlık', max: LIMITS.title, required: true }),
    startsAt: startsAt(body?.startsAt),
    location: line(body?.location, { field: 'Yer', max: LIMITS.location }),
    description: text(body?.description, { field: 'Açıklama', max: LIMITS.description }),
    hostName: line(body?.hostName, { field: 'Adın', max: LIMITS.name, required: true }),
    theme,
  };
}

export function validateRsvpInput(body) {
  if (!RSVP_STATUSES.includes(body?.status)) throw new HttpError(400, 'Bir cevap seçin.');
  return {
    name: line(body?.name, { field: 'Adın', max: LIMITS.name, required: true }),
    status: body.status,
    note: line(body?.note, { field: 'Not', max: LIMITS.note }),
  };
}

export function validateCommentInput(body) {
  return {
    name: line(body?.name, { field: 'Adın', max: LIMITS.name, required: true }),
    text: text(body?.text, { field: 'Mesaj', max: LIMITS.comment, required: true }),
  };
}
