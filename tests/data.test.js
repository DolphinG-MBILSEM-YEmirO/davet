// Data layer tests against a local relay: npm test
// Multi-person flows (host and guests in separate browsers) are covered by the
// browser tests; here one browser plays every role.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nostr from 'nostr-tools/pure';
import { startRelay } from '../tools/relay.mjs';

const relay = startRelay(7791);
globalThis.location = { search: `?relays=ws://localhost:${relay.port}` };
globalThis.__davetNostr = nostr;

const { api, ApiError } = await import('../js/lib/api.js');
const { encryptJson, fromBase64Url, inviteKeys } = await import('../js/lib/crypto.js');

test.after(async () => {
  await relay.close();
  // Open sockets in the relay pool would keep the process alive.
  setTimeout(() => process.exit(0), 50).unref();
});

const validEvent = {
  title: '  Cuma film gecesi ',
  startsAt: '2030-05-10T20:30',
  location: 'Kadıköy',
  description: 'Patlamış mısır bizden.',
  hostName: 'Ece',
  theme: 'movie',
};

test('creates an invite and reads it back as the host', async () => {
  const { id } = await api.createEvent(validEvent);
  assert.match(id, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  const data = await api.getEvent(id);
  assert.equal(data.event.title, 'Cuma film gecesi');
  assert.equal(data.isHost, true);
  assert.deepEqual(data.rsvps, []);
});

test('rejects invalid input before publishing', async () => {
  await assert.rejects(api.createEvent({ ...validEvent, title: ' ' }), (error) => error.status === 400);
  await assert.rejects(api.createEvent({ ...validEvent, startsAt: '2030-02-30T10:00' }), (error) => error.status === 400);
});

test('bad links are "not found"', async () => {
  await assert.rejects(api.getEvent('nope.nope'), (error) => error instanceof ApiError && error.status === 404);
  // A well-formed link nobody published.
  const unknown = `${'A'.repeat(22)}.${'B'.repeat(43)}`;
  await assert.rejects(api.getEvent(unknown), (error) => error.status === 404);
});

test('edits, RSVP changes, wall posts and deletion', async () => {
  const { id } = await api.createEvent(validEvent);
  await api.updateEvent(id, { ...validEvent, title: 'Yeni başlık' });

  await api.saveRsvp(id, { name: 'Ece', status: 'going' });
  await api.saveRsvp(id, { name: 'Ece', status: 'maybe', note: 'Belki geç kalırım' });
  const { comment } = await api.addComment(id, { name: 'Ece', text: 'Görüşürüz!' });

  let data = await api.getEvent(id);
  assert.equal(data.event.title, 'Yeni başlık');
  assert.equal(data.rsvps.length, 1, 'a newer RSVP replaces the older one');
  assert.equal(data.rsvps[0].status, 'maybe');
  assert.equal(data.rsvps[0].isMine, true);
  assert.equal(data.comments[0].text, 'Görüşürüz!');

  await api.deleteComment(id, comment.id);
  data = await api.getEvent(id);
  assert.equal(data.comments.length, 0);

  await api.deleteEvent(id);
  await assert.rejects(api.getEvent(id), (error) => error.status === 404);
});

test('time polls: votes, then the host picks and voters count as going', async () => {
  const { startsAt, ...rest } = validEvent;
  const { id } = await api.createEvent({ ...rest, timeOptions: ['2030-05-12T19:00', '2030-05-11T18:30'] });
  let data = await api.getEvent(id);
  assert.equal(data.event.pollOpen, true);
  assert.deepEqual(data.event.timeOptions, ['2030-05-11T18:30', '2030-05-12T19:00']);

  await api.saveRsvp(id, { name: 'Ece', available: ['2030-05-12T19:00', 'bogus'] });
  await assert.rejects(api.finalizeEvent(id, '2030-01-01T10:00'), (error) => error.status === 400);
  await api.finalizeEvent(id, '2030-05-12T19:00');

  data = await api.getEvent(id);
  assert.equal(data.event.pollOpen, false);
  assert.equal(data.event.startsAt, '2030-05-12T19:00');
  assert.equal(data.rsvps[0].status, 'going');
  await assert.rejects(api.finalizeEvent(id, '2030-05-12T19:00'), (error) => error.status === 409);
});

test('an invite signed by anyone but the host is ignored', async () => {
  const { id } = await api.createEvent(validEvent);
  const { topic, aesKey } = await inviteKeys(fromBase64Url(id.split('.')[0]));

  // Someone who has the link tries to overwrite the invite with their own key.
  const forged = nostr.finalizeEvent(
    {
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000) + 60,
      tags: [['d', topic], ['i', topic]],
      content: await encryptJson(aesKey, { ...validEvent, title: 'Sahte' }),
    },
    nostr.generateSecretKey(),
  );
  const socket = new WebSocket(`ws://localhost:${relay.port}`);
  await new Promise((resolve) => socket.addEventListener('open', resolve));
  socket.send(JSON.stringify(['EVENT', forged]));
  await new Promise((resolve) => socket.addEventListener('message', resolve));
  socket.close();

  const data = await api.getEvent(id);
  assert.equal(data.event.title, 'Cuma film gecesi');
});

/** Publish a raw event straight to the relay, the way another app would. */
async function publishRaw(event) {
  const socket = new WebSocket(`ws://localhost:${relay.port}`);
  await new Promise((resolve) => socket.addEventListener('open', resolve));
  socket.send(JSON.stringify(['EVENT', event]));
  await new Promise((resolve) => socket.addEventListener('message', resolve));
  socket.close();
}

test('plans shared from Sharloop keep their extra fields and take answers', async () => {
  const { toBase64Url, randomBytes, fromHex } = await import('../js/lib/crypto.js');
  const { buildEventIcs } = await import('../js/lib/ics.js');
  // Sharloop signs the invite with the host's account key, which is in the link.
  const account = nostr.generateSecretKey();
  const secret = randomBytes(16);
  const id = `${toBase64Url(secret)}.${toBase64Url(fromHex(nostr.getPublicKey(account)))}`;
  const { topic, aesKey } = await inviteKeys(secret);
  const invite = {
    title: 'Belgrad Ormanı yürüyüşü',
    startsAt: '2030-06-01T00:00',
    timeOptions: [],
    pollOpen: false,
    location: 'Bahçeköy girişi',
    description: '',
    hostName: 'Deniz Kaya',
    theme: 'outdoor',
    hiddenComments: [],
    allDay: true,
    emoji: '🥾',
    durationMinutes: null,
    sharloop: { kod: '7K2M9QXA', kullaniciAdi: 'deniz' },
  };
  await publishRaw(
    nostr.finalizeEvent(
      { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', topic], ['i', topic]], content: await encryptJson(aesKey, invite) },
      account,
    ),
  );

  let data = await api.getEvent(id);
  assert.equal(data.isHost, false);
  assert.equal(data.event.allDay, true);
  assert.equal(data.event.emoji, '🥾');
  assert.deepEqual(data.event.sharloop, { kod: '7K2M9QXA', kullaniciAdi: 'deniz' });
  assert.equal(data.event.durationMinutes, undefined);
  const ics = buildEventIcs(data.event, 'https://example.com');
  assert.match(ics, /DTSTART;VALUE=DATE:20300601\r\nDTEND;VALUE=DATE:20300602/);

  // A guest answers here; Sharloop reads the same answer.
  await api.saveRsvp(id, { name: 'Zeynep', status: 'going' });
  data = await api.getEvent(id);
  assert.deepEqual(data.rsvps.map((rsvp) => [rsvp.name, rsvp.status]), [['Zeynep', 'going']]);

  // Malformed extras are dropped; the invite itself still shows.
  await publishRaw(
    nostr.finalizeEvent(
      {
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000) + 5,
        tags: [['d', topic], ['i', topic]],
        content: await encryptJson(aesKey, {
          ...invite,
          allDay: 'yes',
          emoji: 'x'.repeat(40),
          durationMinutes: 90,
          sharloop: { kod: 'javascript:alert(1)', kullaniciAdi: '<b>' },
        }),
      },
      account,
    ),
  );
  data = await api.getEvent(id);
  assert.equal(data.event.title, 'Belgrad Ormanı yürüyüşü');
  assert.equal(data.event.allDay, undefined);
  assert.equal(data.event.emoji, undefined);
  assert.equal(data.event.durationMinutes, 90);
  assert.equal(data.event.sharloop, undefined);
  assert.match(buildEventIcs(data.event, 'https://example.com'), /DTSTART:20300601T000000\r\nDTEND:20300601T013000/);
});

test('an all-day plan counts as today for the whole day', async () => {
  const { countdown, formatWhen } = await import('../js/lib/format.js');
  const evening = new Date(2030, 5, 1, 21, 0);
  assert.deepEqual(countdown('2030-06-01T00:00', evening, { allDay: true }), { label: 'Bugün', past: false });
  assert.equal(countdown('2030-06-01T00:00', evening).past, true);
  assert.equal(countdown('2030-06-01T00:00', new Date(2030, 5, 2, 9, 0), { allDay: true }).past, true);
  assert.doesNotMatch(formatWhen({ startsAt: '2030-06-01T00:00', allDay: true }), /00:00/);
  assert.match(formatWhen({ startsAt: '2030-06-01T00:00', allDay: true }), /Tüm gün$/);
});
