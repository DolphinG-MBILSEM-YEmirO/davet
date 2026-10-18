// What this browser remembers: the visitor's name, the keys that prove who
// they are, and a list of invites they host or answered ("Davetlerim").
// Clearing site data loses these, and with them the right to edit.

import { loadJSON, saveJSON } from './storage.js';
import { randomBytes, toBase64Url } from './crypto.js';

const MAX_SAVED_INVITES = 50;

function update(key, defaultValue, change) {
  const value = loadJSON(key, defaultValue);
  const next = change(value);
  saveJSON(key, next);
  return next;
}

export const local = {
  name: () => loadJSON('name', ''),
  setName: (name) => saveJSON('name', name),

  /** Random seed for this browser's per-invite signing keys (see crypto.js). */
  seed() {
    let seed = loadJSON('seed', null);
    if (!seed) {
      seed = toBase64Url(randomBytes(32));
      saveJSON('seed', seed);
    }
    return seed;
  },

  /** The host's secret signing key (hex) for an invite they created. */
  hostToken: (eventId) => loadJSON('hostTokens', {})[eventId] || null,
  setHostToken: (eventId, token) => update('hostTokens', {}, (all) => ({ ...all, [eventId]: token })),

  /** Invites shown on the home page, newest activity first. */
  invites: () => loadJSON('invites', []),

  rememberInvite(event, role) {
    update('invites', [], (all) => {
      const previous = all.find((item) => item.id === event.id);
      const entry = {
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        theme: event.theme,
        pollOpen: Boolean(event.pollOpen),
        // Hosting outranks being a guest, even if the host also RSVPs.
        role: previous?.role === 'host' ? 'host' : role,
      };
      return [entry, ...all.filter((item) => item.id !== event.id)].slice(0, MAX_SAVED_INVITES);
    });
  },

  forgetInvite: (eventId) => update('invites', [], (all) => all.filter((item) => item.id !== eventId)),
};
