// A minimal Nostr relay pool (NIP-01): publish events and run one-off queries
// against several public relays at once. Data is spread over several relays
// so the site keeps working when one of them is down.

// Free public relays that accept application data (kind 30078).
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'];

const CONNECT_TIMEOUT_MS = 4000;
const PUBLISH_TIMEOUT_MS = 6000;
const QUERY_TIMEOUT_MS = 4500;

/** Relays can be overridden with ?relays=wss://a,wss://b (used for local testing). */
export function configuredRelays() {
  try {
    const fromQuery = new URLSearchParams(globalThis.location?.search || '').get('relays');
    if (fromQuery) return fromQuery.split(',').map((url) => url.trim()).filter(Boolean);
  } catch {
    // No location (e.g. tests): fall through.
  }
  return DEFAULT_RELAYS;
}

class RelayConnection {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.ready = null;
    this.listeners = new Set();
  }

  /** Resolves with true when connected, false when the relay can't be reached. */
  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve) => {
      let socket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        socket.close();
        resolve(false);
      }, CONNECT_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(true);
      });
      socket.addEventListener('message', (message) => {
        let data;
        try {
          data = JSON.parse(message.data);
        } catch {
          return;
        }
        if (Array.isArray(data)) this.listeners.forEach((listener) => listener(data));
      });
      const reset = () => {
        clearTimeout(timer);
        resolve(false);
        // Reconnect on the next request.
        if (this.socket === socket) this.ready = null;
      };
      socket.addEventListener('close', reset);
      socket.addEventListener('error', reset);
      this.socket = socket;
    });
    return this.ready;
  }

  send(message) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  listen(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class RelayPool {
  constructor(urls) {
    this.connections = urls.map((url) => new RelayConnection(url));
  }

  async connected() {
    const results = await Promise.all(this.connections.map((connection) => connection.connect()));
    return this.connections.filter((_, index) => results[index]);
  }

  /** Send a signed event to every relay; resolves with how many accepted it. */
  async publish(event) {
    const relays = await this.connected();
    const results = await Promise.all(
      relays.map(
        (relay) =>
          new Promise((resolve) => {
            const stop = relay.listen(([type, id, accepted]) => {
              if (type === 'OK' && id === event.id) done(accepted === true);
            });
            const timer = setTimeout(() => done(false), PUBLISH_TIMEOUT_MS);
            function done(accepted) {
              clearTimeout(timer);
              stop();
              resolve(accepted);
            }
            relay.send(['EVENT', event]);
          }),
      ),
    );
    return { reached: relays.length, accepted: results.filter(Boolean).length };
  }

  /** Collect matching events from every relay until each says it's done (EOSE). */
  async query(filter) {
    const relays = await this.connected();
    const events = new Map();
    await Promise.all(
      relays.map(
        (relay) =>
          new Promise((resolve) => {
            const subscriptionId = Math.random().toString(36).slice(2, 12);
            const stop = relay.listen(([type, id, payload]) => {
              if (id !== subscriptionId) return;
              if (type === 'EVENT' && payload?.id) events.set(payload.id, payload);
              if (type === 'EOSE' || type === 'CLOSED') done();
            });
            const timer = setTimeout(done, QUERY_TIMEOUT_MS);
            function done() {
              clearTimeout(timer);
              stop();
              relay.send(['CLOSE', subscriptionId]);
              resolve();
            }
            relay.send(['REQ', subscriptionId, filter]);
          }),
      ),
    );
    return { reached: relays.length, events: [...events.values()] };
  }
}
