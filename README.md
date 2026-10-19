# Davet (by Sharloop)

Create an invite, share the link in your group chat, see who's coming.
Part of the [Sharloop](https://sharloop.vercel.app) family (formerly CepDost) and keeps CepDost's coral/cream palette.

There is no server and no database to pay for. The site is static (GitHub Pages),
and invites, answers and wall posts are stored encrypted on free public
[Nostr](https://nostr.com) relays.

## Features

- Create an invite with a title, time, place, details and a cover theme, with a live preview.
- "Ortak saat" polls: if the time isn't fixed, the host offers 2–6 options. Guests tick the ones that suit them and the best option is highlighted. When the host picks one, everyone who voted for it counts as "going".
- Share links: WhatsApp, copy link, native share sheet and an `.ics` "add to calendar" file.
- One-tap RSVP (Geliyorum / Belki / Gelemem) with an optional note, changeable later.
- A guest list and a wall. Authors can delete their own posts and the host can hide any post.
- The host can edit or delete the invite.
- "Davetlerim" on the home page lists invites this browser hosts or answered.
- Light and dark themes, mobile-first, keyboard and screen-reader friendly.

## Plans from Sharloop

When someone shares a plan from Sharloop as a link, Sharloop publishes it as a Davet invite, signed with the
host's Sharloop account, so people without the app open it here and answer as with any invite. Sharloop reads
the same events to show the host who's coming.

Such invites carry a few optional fields (`validateSharloopFields` in `js/shared/validate.js`):

- `allDay`: the plan has no set time, so only the date is shown and the calendar file is a whole-day event;
- `emoji`: shown on the cover instead of the theme's emoji;
- `durationMinutes`: the length of the calendar event;
- `sharloop`: the host's Sharloop friend code and username. The page then shows "Sharloop'ta aç"
  (opens `https://sharloop.vercel.app/#davet=<link id>`, where a "coming" also goes into the calendar) and
  "Sharloop'a katıl" (`?ekle=<code>`, which finds the host to add as a friend). The Sharloop address is fixed
  in `js/shared/rules.js`, never read from an invite.

## How data works

- **Link:** `#/e/<secret>.<host public key>`. Browsers never send the `#` part to any server.
- **Keys from the secret:**
  - a *topic* tag that lets relays find the invite's events without revealing anything;
  - an AES-GCM key that encrypts every event, so relays only store ciphertext.
- **Signing:** every write is a signed Nostr event of kind 30078 (application data, NIP-78).
  - The invite is signed by a key made for it. Its public half is in the link, so only the host can change it.
  - Each guest signs their RSVP and posts with a key derived from a random seed in their browser, one key per invite. Only they can replace them.
- **Untrusted reads:** relays are untrusted, so every event is verified, decrypted and validated with the same rules used when writing (`js/shared/validate.js`).
- **Expiry:** events carry a NIP-40 expiration 60 days after the event date.
- **Redundancy:** data is written to several relays (`js/lib/relays.js`), so one relay going down doesn't lose it.
- **Clearing browser data:** the host loses the right to edit, because the keys live in localStorage.

## Structure

```
index.html              App shell
css/styles.css          All styles (design tokens at the top)
js/main.js              Hash router
js/shared/              Themes, limits and validation
js/lib/api.js           Data layer: invites, RSVPs, wall over Nostr
js/lib/relays.js        Minimal relay pool (publish, query)
js/lib/crypto.js        Keys, encryption, encoding (WebCrypto)
js/lib/nostr.js         Loads nostr-tools (pinned) from a CDN
js/lib/                 Also DOM helpers, local storage, formatting, .ics
js/views/               Pages: home, editor (create/edit), event, not-found
tools/relay.mjs         Tiny local relay for development and tests
tools/dev-server.mjs    Static server + local relay
tests/                  Data layer tests (node:test)
```

There is no build step. `npm install` is only needed for local development and tests.

## Run locally

```
npm install
npm run dev    # prints a URL that uses the local relay
npm test
```

## Deploy

GitHub Pages: Settings → Pages → Deploy from branch → `main` / root. The site is plain static files
(`.nojekyll` is included). Any other static host works too.

## Limits

300 RSVPs and 500 wall posts per invite. Public relays are free and run by the community: they
may rate-limit or drop data, which is why every write goes to several of them.
