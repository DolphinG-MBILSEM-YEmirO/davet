// Build an .ics calendar file for an invite so guests can add it to their phone.

import { parseLocalDateTime } from './format.js';

const DEFAULT_DURATION_HOURS = 2;

const pad = (number) => String(number).padStart(2, '0');

/** Floating local time (no timezone), which calendars show as wall-clock time. */
function icsDateTime(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buildEventIcs(event, url) {
  const start = parseLocalDateTime(event.startsAt);
  const end = new Date(start.getTime() + DEFAULT_DURATION_HOURS * 3600000);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const description = [event.description, url].filter(Boolean).join('\n\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Davet//TR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@davet`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsDateTime(start)}`,
    `DTEND:${icsDateTime(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    event.location ? `LOCATION:${escapeText(event.location)}` : null,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}
