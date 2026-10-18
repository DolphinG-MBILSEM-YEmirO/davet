// Postgres store (used with Supabase). Same interface as the stores in
// store.js. Tables are created on first use, so connecting a database in
// Vercel is the only setup step.
//
// All tables are prefixed with `davet_` so they can live next to another
// app's tables in a shared Supabase project. Row level security is enabled
// with no policies: Supabase's public API can't read them, only this server
// (which connects as the database owner) can.

const SCHEMA_SQL = `
  create table if not exists davet_events (
    id text primary key,
    data jsonb not null,
    expires_at timestamptz not null
  );
  create table if not exists davet_rsvps (
    event_id text not null references davet_events(id) on delete cascade,
    id text not null,
    data jsonb not null,
    primary key (event_id, id)
  );
  create table if not exists davet_comments (
    event_id text not null references davet_events(id) on delete cascade,
    id text not null,
    data jsonb not null,
    primary key (event_id, id)
  );
  create table if not exists davet_rate_limits (
    key text primary key,
    count integer not null,
    reset_at timestamptz not null
  );
  create index if not exists davet_events_expires_at_idx on davet_events (expires_at);
  alter table davet_events enable row level security;
  alter table davet_rsvps enable row level security;
  alter table davet_comments enable row level security;
  alter table davet_rate_limits enable row level security;
`;

// Expired rows are removed opportunistically when events are written.
const CLEANUP_SQL = `
  delete from davet_events where expires_at < now();
  delete from davet_rate_limits where reset_at < now() - interval '1 hour';
`;

/** Supabase poolers use certificates node can't verify by default; local servers need no TLS. */
function connectionOptions(connectionString) {
  const url = new URL(connectionString);
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
  // `sslmode` in the URL would override the ssl option below, so drop it.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('supa');
  return {
    connectionString: url.toString(),
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    // Let short-lived processes (tests, serverless) exit with idle connections open.
    allowExitOnIdle: true,
  };
}

export function createPostgresStore(connectionString) {
  let poolPromise = null;

  function getPool() {
    poolPromise ??= (async () => {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool(connectionOptions(connectionString));
      await pool.query(SCHEMA_SQL);
      return pool;
    })().catch((error) => {
      poolPromise = null; // Retry on the next request.
      throw error;
    });
    return poolPromise;
  }

  async function query(text, values) {
    const pool = await getPool();
    return pool.query(text, values);
  }

  const rows = (result) => result.rows.map((row) => row.data);

  return {
    async getEvent(id) {
      const result = await query('select data from davet_events where id = $1 and expires_at > now()', [id]);
      return result.rows[0]?.data ?? null;
    },
    async putEvent(event, ttlSeconds) {
      await query(
        `insert into davet_events (id, data, expires_at)
         values ($1, $2, now() + make_interval(secs => $3))
         on conflict (id) do update set data = excluded.data, expires_at = excluded.expires_at`,
        [event.id, event, ttlSeconds],
      );
      // Roughly one write in fifty also clears out expired data.
      if (Math.random() < 0.02) await query(CLEANUP_SQL);
    },
    async deleteEvent(id) {
      await query('delete from davet_events where id = $1', [id]);
    },
    async getRsvps(id) {
      return rows(await query('select data from davet_rsvps where event_id = $1', [id]));
    },
    async putRsvp(id, rsvp) {
      await query(
        `insert into davet_rsvps (event_id, id, data) values ($1, $2, $3)
         on conflict (event_id, id) do update set data = excluded.data`,
        [id, rsvp.id, rsvp],
      );
    },
    async countRsvps(id) {
      const result = await query('select count(*)::int as count from davet_rsvps where event_id = $1', [id]);
      return result.rows[0].count;
    },
    async getComments(id) {
      return rows(await query('select data from davet_comments where event_id = $1', [id]));
    },
    async putComment(id, comment) {
      await query(
        `insert into davet_comments (event_id, id, data) values ($1, $2, $3)
         on conflict (event_id, id) do update set data = excluded.data`,
        [id, comment.id, comment],
      );
    },
    async deleteComment(id, commentId) {
      await query('delete from davet_comments where event_id = $1 and id = $2', [id, commentId]);
    },
    async countComments(id) {
      const result = await query('select count(*)::int as count from davet_comments where event_id = $1', [id]);
      return result.rows[0].count;
    },
    async hit(key, windowSeconds) {
      const result = await query(
        `insert into davet_rate_limits (key, count, reset_at)
         values ($1, 1, now() + make_interval(secs => $2))
         on conflict (key) do update set
           count = case when davet_rate_limits.reset_at <= now() then 1 else davet_rate_limits.count + 1 end,
           reset_at = case when davet_rate_limits.reset_at <= now() then excluded.reset_at else davet_rate_limits.reset_at end
         returning count`,
        [key, windowSeconds],
      );
      return result.rows[0].count;
    },
  };
}
