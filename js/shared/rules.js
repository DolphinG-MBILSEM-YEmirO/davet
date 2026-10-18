// Rules shared by the browser and the API, so both validate the same way.

/** Cover themes an invite can use. `colors` feed the cover gradient. */
export const THEMES = [
  { id: 'party', label: 'Parti', emoji: '🎉', colors: ['#ff5f6d', '#ffc371'] },
  { id: 'coffee', label: 'Kahve', emoji: '☕', colors: ['#8e6e53', '#e3b98a'] },
  { id: 'movie', label: 'Film', emoji: '🎬', colors: ['#3a1c71', '#d76d77'] },
  { id: 'sport', label: 'Spor', emoji: '⚽', colors: ['#11998e', '#38ef7d'] },
  { id: 'study', label: 'Ders', emoji: '📚', colors: ['#4568dc', '#b06ab3'] },
  { id: 'outdoor', label: 'Doğa', emoji: '🏕️', colors: ['#2c7744', '#a8e063'] },
  { id: 'music', label: 'Konser', emoji: '🎸', colors: ['#f12711', '#f5af19'] },
  { id: 'food', label: 'Yemek', emoji: '🍕', colors: ['#ee0979', '#ff6a00'] },
];

export const DEFAULT_THEME = THEMES[0].id;

export const RSVP_STATUSES = ['going', 'maybe', 'declined'];

export const LIMITS = {
  title: 80,
  location: 120,
  description: 1000,
  name: 40,
  note: 140,
  comment: 500,
  rsvpsPerEvent: 300,
  commentsPerEvent: 500,
  // "Ortak saat" polls: the host offers this many time options.
  timeOptionsMin: 2,
  timeOptionsMax: 6,
};

/** Local wall-clock time "YYYY-MM-DDTHH:mm", as produced by <input type="datetime-local">. */
export const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function findTheme(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}
