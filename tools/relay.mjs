// A tiny in-memory Nostr relay (NIP-01 subset) for local development and
// tests: EVENT, REQ (kinds, authors, ids, #<letter> tags, limit), CLOSE,
// replaceable events (kinds 30000-39999) and NIP-40 expiration.
//
//   node tools/relay.mjs [port]      -> ws://localhost:7777

import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';

export function startRelay(port = 7777) {
  const events = new Map();
  const subscriptions = new Map(); // socket -> Map(subId -> filter)

  const isExpired = (event) => {
    const expiration = Number(event.tags.find((tag) => tag[0] === 'expiration')?.[1]);
    return expiration && expiration < Date.now() / 1000;
  };
  const dTag = (event) => event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';

  function matches(event, filter) {
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    if (filter.ids && !filter.ids.includes(event.id)) return false;
    for (const [key, values] of Object.entries(filter)) {
      if (!key.startsWith('#')) continue;
      const name = key.slice(1);
      if (!event.tags.some((tag) => tag[0] === name && values.includes(tag[1]))) return false;
    }
    return true;
  }

  function store(event) {
    if (event.kind >= 30000 && event.kind < 40000) {
      for (const [id, existing] of events) {
        if (existing.kind === event.kind && existing.pubkey === event.pubkey && dTag(existing) === dTag(event)) {
          if (existing.created_at >= event.created_at) return false;
          events.delete(id);
        }
      }
    }
    events.set(event.id, event);
    return true;
  }

  const server = new WebSocketServer({ port });
  server.on('connection', (socket) => {
    subscriptions.set(socket, new Map());
    const send = (message) => socket.send(JSON.stringify(message));

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return send(['NOTICE', 'invalid json']);
      }
      const [type, ...rest] = message;

      if (type === 'EVENT') {
        const event = rest[0];
        if (!verifyEvent(event)) return send(['OK', event?.id, false, 'invalid: bad signature']);
        if (isExpired(event)) return send(['OK', event.id, false, 'invalid: expired']);
        const stored = store(event);
        send(['OK', event.id, true, stored ? '' : 'duplicate: have newer']);
        if (!stored) return;
        for (const [client, subs] of subscriptions) {
          for (const [subId, filter] of subs) {
            if (matches(event, filter)) client.send(JSON.stringify(['EVENT', subId, event]));
          }
        }
      } else if (type === 'REQ') {
        const [subId, filter] = rest;
        subscriptions.get(socket).set(subId, filter);
        const found = [...events.values()]
          .filter((event) => !isExpired(event) && matches(event, filter))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, filter.limit ?? 500);
        found.forEach((event) => send(['EVENT', subId, event]));
        send(['EOSE', subId]);
      } else if (type === 'CLOSE') {
        subscriptions.get(socket).delete(rest[0]);
      }
    });
    socket.on('close', () => subscriptions.delete(socket));
  });

  function close() {
    // server.close() waits for open sockets, so end them first.
    server.clients.forEach((client) => client.terminate());
    return new Promise((resolve) => server.close(resolve));
  }

  return { port, close };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = startRelay(Number(process.argv[2]) || 7777);
  console.log(`Relay running at ws://localhost:${port}`);
}
