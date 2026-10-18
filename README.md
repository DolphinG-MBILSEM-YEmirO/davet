# Davet (by CepDost)

Create an invite, share the link in your group chat, see who's coming.
Part of the [CepDost](https://cepdost.vercel.app) family and uses its coral/cream palette.
No accounts and no app install. Guests answer with one tap and can post on
the invite's wall.

## Features

- Create an invite with a title, time, place, details and a cover theme, with a live preview.
- Clean share links (`/e/<id>`): WhatsApp share, copy link, native share sheet and an `.ics` "add to calendar" file.
- "Ortak saat" polls: if the time isn't fixed, the host offers 2–6 options, guests tick the ones that suit them, the best option is highlighted and the host locks it in. Everyone who voted for it becomes "going".
- One-tap RSVP (Geliyorum / Belki / Gelemem) with an optional note. Guests can change their answer later.
- A guest list grouped by answer, and a wall for messages. Authors and the host can delete posts.
- The host can edit or delete the invite.
- "Davetlerim" on the home page lists invites this browser hosts or answered.
- The invite page refreshes in the background, so new answers appear on their own.
- Light and dark themes, mobile-first, keyboard and screen-reader friendly.

## How it works

There are no user accounts. Creating an invite returns a secret host token,
and each RSVP or wall post returns its own token. The browser keeps these in
localStorage, and the server stores only their SHA-256 hashes. Anyone with
the link can view an invite. Data expires 60 days after the event.

## Structure

```
index.html              App shell
css/styles.css          All styles (design tokens at the top)
js/main.js              History-API router
js/shared/rules.js      Themes and limits, shared by browser and API
js/lib/                 DOM helpers, API client, local storage, formatting, .ics
js/views/               Pages: home, editor (create/edit), event, not-found
js/views/components/    Cover, avatar, toast
api/events.js           Serverless API (one Vercel function)
api/_lib/store.js       Picks the store: Postgres, Upstash Redis or in-memory (dev)
api/_lib/postgres-store.js  Postgres/Supabase store; creates its davet_* tables itself
api/_lib/validate.js    Input validation
vercel.json             Rewrites for pretty URLs and the API
dev-server.mjs          Local server (static files + API, in-memory data)
tests/                  API tests (node:test)
```

The only npm dependency is `pg` (used only with Postgres). There is no build step.

## Run locally

```
npm run dev    # http://localhost:3000, data is kept in memory
npm test       # API tests
```

## Deploy (Vercel)

1. Import the GitHub repository in Vercel. Use framework preset "Other" with no build command.
2. Connect a database under **Storage**. Pick one:
   - **Supabase** (recommended, the same platform CepDost uses). The integration sets `POSTGRES_URL`.
     On the first request the app creates the `davet_events`, `davet_rsvps`, `davet_comments` and
     `davet_rate_limits` tables. Row level security is on and there are no policies, so Supabase's public API
     can't read them, and other tables in the project are not touched.
     To use an existing Supabase project (e.g. CepDost's), set `POSTGRES_URL` to its pooled
     connection string (Project Settings → Database → Connection string → Transaction pooler).
   - **Upstash for Redis**, which sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Redeploy. Without a database the API answers 503 instead of losing data.

## Limits

- 300 RSVPs and 500 wall posts per invite.
- 30 writes per minute per IP, and 20 new invites per hour per IP.
