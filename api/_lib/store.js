// Storage for events, RSVPs and comments.
//
// Production uses Upstash Redis over its REST API (no npm dependency). The
// Vercel "Upstash for Redis" integration sets KV_REST_API_URL/TOKEN; the
// UPSTASH_* names are accepted too. Without them, an in-memory store is used,
// which is only meant for local development and tests.
//
// Key layout per event:
//   event:<id>     JSON string with the event
//   rsvps:<id>     hash  guestId   -> JSON RSVP
//   comments:<id>  hash  commentId -> JSON comment

const eventKey = (id) => `event:${id}`;
const rsvpKey = (id) => `rsvps:${id}`;
const commentKey = (id) => `comments:${id}`;

function createRedisStore(url, token) {
  async function pipeline(commands) {
    const response = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`Redis request failed with ${response.status}`);
    const results = await response.json();
    for (const item of results) {
      if (item.error) throw new Error(`Redis error: ${item.error}`);
    }
    return results.map((item) => item.result);
  }

  const parseHash = (flat) => {
    const values = [];
    for (let i = 1; i < (flat?.length ?? 0); i += 2) values.push(JSON.parse(flat[i]));
    return values;
  };

  return {
    async getEvent(id) {
      const [raw] = await pipeline([['GET', eventKey(id)]]);
      return raw ? JSON.parse(raw) : null;
    },
    async putEvent(event, ttlSeconds) {
      await pipeline([
        ['SET', eventKey(event.id), JSON.stringify(event), 'EX', ttlSeconds],
        // Child hashes may not exist yet; EXPIRE on a missing key is a no-op.
        ['EXPIRE', rsvpKey(event.id), ttlSeconds],
        ['EXPIRE', commentKey(event.id), ttlSeconds],
      ]);
    },
    async deleteEvent(id) {
      await pipeline([['DEL', eventKey(id), rsvpKey(id), commentKey(id)]]);
    },
    async getRsvps(id) {
      const [flat] = await pipeline([['HGETALL', rsvpKey(id)]]);
      return parseHash(flat);
    },
    async putRsvp(id, rsvp, ttlSeconds) {
      await pipeline([
        ['HSET', rsvpKey(id), rsvp.id, JSON.stringify(rsvp)],
        ['EXPIRE', rsvpKey(id), ttlSeconds],
      ]);
    },
    async countRsvps(id) {
      const [count] = await pipeline([['HLEN', rsvpKey(id)]]);
      return count;
    },
    async getComments(id) {
      const [flat] = await pipeline([['HGETALL', commentKey(id)]]);
      return parseHash(flat);
    },
    async putComment(id, comment, ttlSeconds) {
      await pipeline([
        ['HSET', commentKey(id), comment.id, JSON.stringify(comment)],
        ['EXPIRE', commentKey(id), ttlSeconds],
      ]);
    },
    async deleteComment(id, commentId) {
      await pipeline([['HDEL', commentKey(id), commentId]]);
    },
    async countComments(id) {
      const [count] = await pipeline([['HLEN', commentKey(id)]]);
      return count;
    },
    /** Increment a counter that resets after `windowSeconds`; returns the new count. */
    async hit(key, windowSeconds) {
      // SET ... NX starts the window only once; INCR then counts within it.
      const [, count] = await pipeline([
        ['SET', `rate:${key}`, 0, 'EX', windowSeconds, 'NX'],
        ['INCR', `rate:${key}`],
      ]);
      return count;
    },
  };
}

function createMemoryStore() {
  const events = new Map();
  const rsvps = new Map();
  const comments = new Map();
  const counters = new Map();
  const hashFor = (map, id) => {
    if (!map.has(id)) map.set(id, new Map());
    return map.get(id);
  };
  // Values are cloned so callers can't mutate stored data by accident,
  // matching the Redis store where every read returns fresh objects.
  const clone = (value) => (value === null || value === undefined ? null : structuredClone(value));

  return {
    async getEvent(id) {
      return clone(events.get(id));
    },
    async putEvent(event) {
      events.set(event.id, clone(event));
    },
    async deleteEvent(id) {
      events.delete(id);
      rsvps.delete(id);
      comments.delete(id);
    },
    async getRsvps(id) {
      return [...hashFor(rsvps, id).values()].map(clone);
    },
    async putRsvp(id, rsvp) {
      hashFor(rsvps, id).set(rsvp.id, clone(rsvp));
    },
    async countRsvps(id) {
      return hashFor(rsvps, id).size;
    },
    async getComments(id) {
      return [...hashFor(comments, id).values()].map(clone);
    },
    async putComment(id, comment) {
      hashFor(comments, id).set(comment.id, clone(comment));
    },
    async deleteComment(id, commentId) {
      hashFor(comments, id).delete(commentId);
    },
    async countComments(id) {
      return hashFor(comments, id).size;
    },
    async hit(key, windowSeconds) {
      const now = Date.now();
      const entry = counters.get(key);
      if (!entry || entry.resetAt <= now) {
        counters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
  };
}

let store = null;

/** Returns the configured store, or null when production storage is missing. */
export function getStore() {
  if (store) return store;

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    store = createRedisStore(url.replace(/\/$/, ''), token);
  } else if (process.env.VERCEL) {
    // Deployed without a database: refuse rather than silently lose data.
    return null;
  } else {
    store = createMemoryStore();
  }
  return store;
}
