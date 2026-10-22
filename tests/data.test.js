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

test('edits, RSVP changes and deletion', async () => {
  const { id } = await api.createEvent(validEvent);
  await api.updateEvent(id, { ...validEvent, title: 'Yeni başlık' });

  await api.saveRsvp(id, { name: 'Ece', status: 'going' });
  await api.saveRsvp(id, { name: 'Ece', status: 'maybe', note: 'Belki geç kalırım' });

  const data = await api.getEvent(id);
  assert.equal(data.event.title, 'Yeni başlık');
  assert.equal(data.rsvps.length, 1, 'a newer RSVP replaces the older one');
  assert.equal(data.rsvps[0].status, 'maybe');
  assert.equal(data.rsvps[0].isMine, true);
  // Davet has no messages; chats and groups are Sharloop's.
  assert.equal(data.comments, undefined);
  assert.equal(api.addComment, undefined);

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

test('answers to a Sharloop plan reach its host’s phone', async () => {
  const { toBase64Url, randomBytes, fromHex } = await import('../js/lib/crypto.js');
  const { setSender } = await import('../js/lib/notify.js');
  const { createDecipheriv, createECDH, createHash, createHmac, hkdfSync } = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000);

  const account = nostr.generateSecretKey();
  const host = nostr.getPublicKey(account);
  const secret = randomBytes(16);
  const id = `${toBase64Url(secret)}.${toBase64Url(fromHex(host))}`;
  const { topic, aesKey } = await inviteKeys(secret);
  const code = 'Q4W8E2RT';
  await publishRaw(
    nostr.finalizeEvent(
      {
        kind: 30078,
        created_at: now,
        tags: [['d', topic], ['i', topic]],
        content: await encryptJson(aesKey, {
          title: 'Moda sahili kahve',
          startsAt: '2030-07-01T10:00',
          timeOptions: [],
          pollOpen: false,
          location: '',
          description: '',
          hostName: 'Deniz Kaya',
          theme: 'coffee',
                sharloop: { kod: code, kullaniciAdi: 'deniz' },
        }),
      },
      account,
    ),
  );

  // Sharloop's directory copy of the host's devices, as it writes it
  // (src/sosyal/nostr/kanal.ts and motor.ts there): everything comes from
  // the friend code.
  const mac = (key, message) => createHmac('sha256', key).update(message).digest();
  const directory = createHash('sha256').update(`cepdost/dizin/kod/${code}`).digest();
  const directoryTopic = mac(directory, 'cepdost/konu').toString('hex');
  const dTag = mac(mac(directory, 'cepdost/d'), 'bildirim').toString('hex').slice(0, 40);
  const directoryKey = await crypto.subtle.importKey('raw', mac(directory, 'cepdost/sifre'), { name: 'AES-GCM' }, false, ['encrypt']);
  const phone = createECDH('prime256v1');
  phone.generateKeys();
  const auth = randomBytes(16);
  const device = (name, turler) => ({
    tur: 'webpush',
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    p256dh: toBase64Url(phone.getPublicKey()),
    auth: toBase64Url(auth),
    turler,
  });
  const directoryRecord = async (signer, adresler, createdAt) =>
    publishRaw(
      nostr.finalizeEvent(
        {
          kind: 30078,
          created_at: createdAt,
          tags: [['d', dTag], ['i', directoryTopic]],
          content: await encryptJson(directoryKey, { t: 'bildirim', k: 'bildirim', v: { adresler } }),
        },
        signer,
      ),
    );
  // The phone takes plan answers, the tablet only messages; someone else's
  // record under the same tag is not the host's.
  await directoryRecord(account, [device('telefon', ['mesaj', 'link']), device('tablet', ['mesaj'])], now);
  await directoryRecord(nostr.generateSecretKey(), [device('baskasi', ['link'])], now + 5);

  const sent = [];
  setSender(async (deliveries) => sent.push(...deliveries));
  await api.saveRsvp(id, { name: 'Zeynep', status: 'maybe' });
  for (let i = 0; i < 60 && sent.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(sent.map((delivery) => delivery.endpoint), ['https://fcm.googleapis.com/fcm/send/telefon']);

  // Only the phone can read it (RFC 8291): a payload signed by the guest
  // that names the invite, which is what lets the host's phone show it.
  const body = fromBase64Url(sent[0].govde);
  const salt = body.subarray(0, 16);
  const senderKey = body.subarray(21, 21 + body[20]);
  const cipher = body.subarray(21 + body[20]);
  const ikm = Buffer.from(
    hkdfSync('sha256', phone.computeSecret(senderKey), auth, Buffer.concat([Buffer.from('WebPush: info\0'), phone.getPublicKey(), senderKey]), 32),
  );
  const contentKey = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce);
  decipher.setAuthTag(cipher.subarray(-16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2);
  const signed = JSON.parse(plain.subarray(0, -1).toString());
  assert.ok(nostr.verifyEvent(signed));
  assert.equal(signed.kind, 27235);
  assert.notEqual(signed.pubkey, host);
  assert.deepEqual(JSON.parse(signed.content), {
    tur: 'link',
    baslik: 'Zeynep belki gelir',
    govde: 'Moda sahili kahve',
    git: `davet:${toBase64Url(secret)}`,
    etiket: `davet:${toBase64Url(secret)}`,
  });

  // Invites made in Davet have no Sharloop host to tell.
  const { id: own } = await api.createEvent(validEvent);
  await api.saveRsvp(own, { name: 'Zeynep', status: 'going' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(sent.length, 1);
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
