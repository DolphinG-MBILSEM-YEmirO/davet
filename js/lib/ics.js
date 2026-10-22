// Build an .ics calendar file for an invite so guests can add it to their phone.

import { parseLocalDateTime } from './format.js';

const DEFAULT_DURATION_HOURS = 2;

const pad = (number) => String(number).padStart(2, '0');

const icsDate = (date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;

/** Floating local time (no timezone), which calendars show as wall-clock time. */
function icsDateTime(date) {
  return `${icsDate(date)}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Start and end lines: whole days for an all-day plan, otherwise times. */
function icsTimes(event) {
  const start = parseLocalDateTime(event.startsAt);
  if (event.allDay) {
    const nextDay = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return [`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(nextDay)}`];
  }
  const minutes = event.durationMinutes || DEFAULT_DURATION_HOURS * 60;
  return [`DTSTART:${icsDateTime(start)}`, `DTEND:${icsDateTime(new Date(start.getTime() + minutes * 60000))}`];
}

export function buildEventIcs(event, url) {
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
    ...icsTimes(event),
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
