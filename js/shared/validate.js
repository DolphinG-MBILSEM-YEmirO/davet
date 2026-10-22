// Validation shared by writing (before publishing) and reading (events from
// relays are untrusted). Each function returns clean values or throws
// a ValidationError with a user-facing (Turkish) message.

import { THEMES, RSVP_STATUSES, LIMITS, DATETIME_PATTERN } from './rules.js';

export class ValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Trim a string field and enforce length limits. */
function text(value, { field, max, required = false }) {
  const clean = typeof value === 'string' ? value.trim().replace(/\s+\n/g, '\n') : '';
  if (required && !clean) throw new ValidationError(400, `${field} boş olamaz.`);
  if (clean.length > max) throw new ValidationError(400, `${field} en fazla ${max} karakter olabilir.`);
  return clean;
}

/** Single-line text: collapses newlines and repeated spaces. */
function line(value, options) {
  return text(typeof value === 'string' ? value.replace(/\s+/g, ' ') : value, options);
}

function startsAt(value) {
  if (typeof value !== 'string' || !DATETIME_PATTERN.test(value)) {
    throw new ValidationError(400, 'Geçerli bir tarih ve saat seçin.');
  }
  const date = new Date(`${value}:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 16) !== value) {
    throw new ValidationError(400, 'Geçerli bir tarih ve saat seçin.');
  }
  return value;
}

/**
 * An invite either has a fixed time (`startsAt`) or offers time options that
 * guests vote on (`timeOptions`, an "ortak saat" poll). While the poll is open,
 * `startsAt` holds the earliest option so sorting and expiry still work.
 */
function schedule(body) {
  if (!Array.isArray(body?.timeOptions) || body.timeOptions.length === 0) {
    return { startsAt: startsAt(body?.startsAt), timeOptions: [], pollOpen: false };
  }
  const options = [...new Set(body.timeOptions.map(startsAt))].sort();
  if (options.length < LIMITS.timeOptionsMin || options.length > LIMITS.timeOptionsMax) {
    throw new ValidationError(400, `Oylama için ${LIMITS.timeOptionsMin}-${LIMITS.timeOptionsMax} farklı saat seçeneği ekleyin.`);
  }
  return { startsAt: options[0], timeOptions: options, pollOpen: true };
}

export function validateEventInput(body) {
  const theme = THEMES.some((item) => item.id === body?.theme) ? body.theme : THEMES[0].id;
  return {
    title: line(body?.title, { field: 'Başlık', max: LIMITS.title, required: true }),
    ...schedule(body),
    location: line(body?.location, { field: 'Yer', max: LIMITS.location }),
    description: text(body?.description, { field: 'Açıklama', max: LIMITS.description }),
    hostName: line(body?.hostName, { field: 'Adın', max: LIMITS.name, required: true }),
    theme,
  };
}

/**
 * Extra fields on invites shared from Sharloop. They are never required and
 * anything malformed is simply dropped, so a bad value can't hide the invite:
 *   - allDay: no set time, only the date is shown;
 *   - emoji: shown on the cover instead of the theme's;
 *   - durationMinutes: used for the calendar file;
 *   - sharloop: the host's Sharloop friend code and username.
 */
export function validateSharloopFields(body) {
  const fields = {};
  if (body?.allDay === true) fields.allDay = true;
  if (typeof body?.emoji === 'string' && body.emoji.trim() && body.emoji.length <= 16) fields.emoji = body.emoji.trim();
  const minutes = body?.durationMinutes;
  if (Number.isInteger(minutes) && minutes > 0 && minutes <= 24 * 60 && !fields.allDay) fields.durationMinutes = minutes;
  const sharloop = body?.sharloop;
  if (sharloop && typeof sharloop === 'object' && /^[0-9A-Z]{8}$/.test(sharloop.kod)) {
    const username = typeof sharloop.kullaniciAdi === 'string' && /^[a-z0-9_.]{3,20}$/.test(sharloop.kullaniciAdi);
    fields.sharloop = { kod: sharloop.kod, ...(username ? { kullaniciAdi: sharloop.kullaniciAdi } : {}) };
  }
  return fields;
}

/** The option a host picks to close a poll. */
export function validateFinalizeInput(body, event) {
  if (!event.pollOpen) throw new ValidationError(409, 'Bu davetin saati zaten belli.');
  if (!event.timeOptions.includes(body?.startsAt)) throw new ValidationError(400, 'Seçeneklerden birini seçin.');
  return { startsAt: body.startsAt };
}

/**
 * While a time poll is open, guests send the options that suit them
 * (`available`) and their status defaults to "maybe".
 */
export function validateRsvpInput(body, event) {
  const available = event.pollOpen && Array.isArray(body?.available)
    ? [...new Set(body.available)].filter((option) => event.timeOptions.includes(option)).sort()
    : [];
  const status = event.pollOpen && body?.status === undefined ? 'maybe' : body?.status;
  if (!RSVP_STATUSES.includes(status)) throw new ValidationError(400, 'Bir cevap seçin.');
  return {
    name: line(body?.name, { field: 'Adın', max: LIMITS.name, required: true }),
    status,
    note: line(body?.note, { field: 'Not', max: LIMITS.note }),
    ...(event.pollOpen ? { available } : {}),
  };
}
