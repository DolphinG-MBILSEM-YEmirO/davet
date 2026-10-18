// Thin wrapper around the events API. Attaches the secret tokens this browser
// holds and turns error responses into exceptions with readable messages.

import { local } from './local.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, { body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`/api/events${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.');
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (e.g. a platform error page); fall through to the status check.
  }
  if (!response.ok) {
    throw new ApiError(response.status, data?.error || 'Bir şeyler ters gitti. Tekrar dene.');
  }
  return data;
}

const hostHeaders = (eventId) => {
  const token = local.hostToken(eventId);
  return token ? { 'X-Host-Token': token } : {};
};

export const api = {
  createEvent: (input) => request('POST', '', { body: input }),
  getEvent: (id) => request('GET', `/${encodeURIComponent(id)}`, { headers: hostHeaders(id) }),
  updateEvent: (id, input) => request('PATCH', `/${encodeURIComponent(id)}`, { body: input, headers: hostHeaders(id) }),
  deleteEvent: (id) => request('DELETE', `/${encodeURIComponent(id)}`, { headers: hostHeaders(id) }),

  saveRsvp(id, input) {
    const own = local.rsvp(id);
    return request('POST', `/${encodeURIComponent(id)}/rsvp`, {
      body: { ...input, guestId: own?.guestId, guestToken: own?.guestToken },
    });
  },

  addComment: (id, input) => request('POST', `/${encodeURIComponent(id)}/comments`, { body: input }),

  deleteComment(id, commentId) {
    const token = local.commentToken(commentId);
    return request('DELETE', `/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, {
      headers: { ...hostHeaders(id), ...(token ? { 'X-Comment-Token': token } : {}) },
    });
  },
};
