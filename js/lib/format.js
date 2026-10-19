// Formatting helpers for dates, names and avatars (Turkish locale).

const LOCALE = 'tr-TR';

/** Parse "YYYY-MM-DDTHH:mm" as local wall-clock time. */
export function parseLocalDateTime(value) {
  const [datePart, timePart = '00:00'] = String(value).split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

/** "Cumartesi, 10 Mayıs" */
export function formatDay(value) {
  return parseLocalDateTime(value).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "20:30" */
export function formatTime(value) {
  return parseLocalDateTime(value).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** "Cumartesi, 10 Mayıs · 20:30", or "Cumartesi, 10 Mayıs · Tüm gün". */
export function formatWhen(event) {
  return `${formatDay(event.startsAt)} · ${event.allDay ? 'Tüm gün' : formatTime(event.startsAt)}`;
}

/** Short calendar chip parts: { month: "MAY", day: "10" } */
export function dateChip(value) {
  const date = parseLocalDateTime(value);
  return {
    month: date.toLocaleDateString(LOCALE, { month: 'short' }).toLocaleUpperCase(LOCALE).replace('.', ''),
    day: String(date.getDate()),
  };
}

/**
 * Friendly countdown: "Bugün", "Yarın", "3 gün kaldı", "Bitti".
 * An all-day plan is "Bugün" for the whole day.
 */
export function countdown(value, now = new Date(), { allDay = false } = {}) {
  const start = parseLocalDateTime(value);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((startDay - today) / 86400000);

  if (days < 0 || (days === 0 && !allDay && start < now - 6 * 3600000)) return { label: 'Bitti', past: true };
  if (days === 0) return { label: start <= now && !allDay ? 'Şu an' : 'Bugün', past: false };
  if (days === 1) return { label: 'Yarın', past: false };
  return { label: `${days} gün kaldı`, past: false };
}

export function isPast(value, now = new Date(), options = {}) {
  return countdown(value, now, options).past;
}

/** "2 dk önce", "3 sa önce", "dün", or a date. */
export function timeAgo(isoString, now = new Date()) {
  const seconds = Math.max(0, Math.round((now - new Date(isoString)) / 1000));
  if (seconds < 60) return 'az önce';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk önce`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa önce`;
  if (seconds < 172800) return 'dün';
  return new Date(isoString).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

export function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return letters.toLocaleUpperCase(LOCALE);
}

/** Stable avatar hue for a name, so the same person keeps the same color. */
export function avatarHue(name) {
  let hash = 0;
  for (const char of String(name).toLocaleLowerCase(LOCALE)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}
