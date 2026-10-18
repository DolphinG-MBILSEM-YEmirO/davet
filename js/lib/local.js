// What this browser remembers: the visitor's name, secret tokens for things
// they created, and a list of invites they host or answered ("Davetlerim").

import { loadJSON, saveJSON } from './storage.js';

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

  hostToken: (eventId) => loadJSON('hostTokens', {})[eventId] || null,
  setHostToken: (eventId, token) => update('hostTokens', {}, (all) => ({ ...all, [eventId]: token })),

  /** The visitor's own RSVP for an event: { guestId, guestToken }. */
  rsvp: (eventId) => loadJSON('rsvps', {})[eventId] || null,
  setRsvp: (eventId, value) => update('rsvps', {}, (all) => ({ ...all, [eventId]: value })),

  commentToken: (commentId) => loadJSON('commentTokens', {})[commentId] || null,
  setCommentToken: (commentId, token) => update('commentTokens', {}, (all) => ({ ...all, [commentId]: token })),

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
