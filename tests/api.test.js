// API tests against the in-memory store: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../api/events.js';

const server = createServer(handler);
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

async function call(method, path, body, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

const validEvent = {
  title: '  Cuma film gecesi ',
  startsAt: '2030-05-10T20:30',
  location: 'Kadıköy',
  description: 'Patlamış mısır bizden.',
  hostName: 'Ece',
  theme: 'movie',
};

test('creates an event and hides the host token hash', async () => {
  const created = await call('POST', '/api/events', validEvent);
  assert.equal(created.status, 201);
  assert.ok(created.data.id && created.data.hostToken);

  const fetched = await call('GET', `/api/events/${created.data.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.data.event.title, 'Cuma film gecesi');
  assert.equal(fetched.data.event.hostTokenHash, undefined);
  assert.equal(fetched.data.isHost, false);

  const asHost = await call('GET', `/api/events/${created.data.id}`, undefined, { 'X-Host-Token': created.data.hostToken });
  assert.equal(asHost.data.isHost, true);
});

test('rejects invalid events', async () => {
  assert.equal((await call('POST', '/api/events', { ...validEvent, title: ' ' })).status, 400);
  assert.equal((await call('POST', '/api/events', { ...validEvent, startsAt: '2030-02-30T10:00' })).status, 400);
  assert.equal((await call('POST', '/api/events', { ...validEvent, hostName: 'x'.repeat(41) })).status, 400);
});

test('only the host can edit or delete', async () => {
  const { data } = await call('POST', '/api/events', validEvent);
  const path = `/api/events/${data.id}`;

  assert.equal((await call('PATCH', path, { ...validEvent, title: 'Yeni' })).status, 403);
  const edited = await call('PATCH', path, { ...validEvent, title: 'Yeni' }, { 'X-Host-Token': data.hostToken });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.event.title, 'Yeni');

  assert.equal((await call('DELETE', path, undefined, { 'X-Host-Token': 'wrong' })).status, 403);
  assert.equal((await call('DELETE', path, undefined, { 'X-Host-Token': data.hostToken })).status, 204);
  assert.equal((await call('GET', path)).status, 404);
});

test('guests can RSVP and change only their own answer', async () => {
  const { data } = await call('POST', '/api/events', validEvent);
  const path = `/api/events/${data.id}/rsvp`;

  const first = await call('POST', path, { name: 'Can', status: 'going' });
  assert.equal(first.status, 201);
  const { rsvp, guestToken } = first.data;

  const changed = await call('POST', path, { name: 'Can', status: 'maybe', guestId: rsvp.id, guestToken });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.rsvp.status, 'maybe');

  // A wrong token creates a separate answer instead of overwriting.
  const forged = await call('POST', path, { name: 'Can', status: 'declined', guestId: rsvp.id, guestToken: 'nope' });
  assert.equal(forged.status, 201);

  const { data: event } = await call('GET', `/api/events/${data.id}`);
  assert.equal(event.rsvps.length, 2);
  assert.equal(event.rsvps[0].status, 'maybe');
  assert.equal(event.rsvps[0].tokenHash, undefined);

  assert.equal((await call('POST', path, { name: 'Can', status: 'party' })).status, 400);
});

test('wall posts can be removed by their author or the host', async () => {
  const { data } = await call('POST', '/api/events', validEvent);
  const wall = `/api/events/${data.id}/comments`;

  const posted = await call('POST', wall, { name: 'Deniz', text: 'Ben de geliyorum!' });
  assert.equal(posted.status, 201);
  const { comment, commentToken } = posted.data;
  const second = await call('POST', wall, { name: 'Mert', text: 'Kola getiririm' });

  assert.equal((await call('DELETE', `${wall}/${comment.id}`)).status, 403);
  assert.equal((await call('DELETE', `${wall}/${comment.id}`, undefined, { 'X-Comment-Token': commentToken })).status, 204);
  assert.equal(
    (await call('DELETE', `${wall}/${second.data.comment.id}`, undefined, { 'X-Host-Token': data.hostToken })).status,
    204,
  );
  const { data: event } = await call('GET', `/api/events/${data.id}`);
  assert.equal(event.comments.length, 0);
});

test('unknown events and routes return 404', async () => {
  assert.equal((await call('GET', '/api/events/doesnotexist')).status, 404);
  assert.equal((await call('GET', '/api/events/../../etc')).status, 404);
  assert.equal((await call('PUT', '/api/events')).status, 404);
});

test('rate limits writes per IP', async () => {
  const headers = { 'X-Forwarded-For': '10.9.9.9' };
  let lastStatus = 0;
  for (let i = 0; i < 31; i += 1) {
    lastStatus = (await call('POST', '/api/events/doesnotexist/rsvp', { name: 'a', status: 'going' }, headers)).status;
  }
  assert.equal(lastStatus, 429);
});

test('time polls: guests vote, the host picks, voters become "going"', async () => {
  const options = ['2030-05-12T19:00', '2030-05-10T20:00', '2030-05-11T18:30'];
  const { startsAt, ...rest } = validEvent;
  const created = await call('POST', '/api/events', { ...rest, timeOptions: options }, { 'X-Forwarded-For': '10.0.0.2' });
  assert.equal(created.status, 201);
  const { id, hostToken } = created.data;
  const headers = { 'X-Forwarded-For': '10.0.0.2' };

  const { data: open } = await call('GET', `/api/events/${id}`, undefined, headers);
  assert.equal(open.event.pollOpen, true);
  assert.deepEqual(open.event.timeOptions, [...options].sort());
  assert.equal(open.event.startsAt, '2030-05-10T20:00');

  const ali = await call('POST', `/api/events/${id}/rsvp`, { name: 'Ali', available: ['2030-05-11T18:30', 'bogus'] }, headers);
  assert.equal(ali.status, 201);
  assert.equal(ali.data.rsvp.status, 'maybe');
  assert.deepEqual(ali.data.rsvp.available, ['2030-05-11T18:30']);
  await call('POST', `/api/events/${id}/rsvp`, { name: 'Ayşe', available: ['2030-05-10T20:00'] }, headers);

  const pick = { startsAt: '2030-05-11T18:30' };
  assert.equal((await call('POST', `/api/events/${id}/finalize`, pick, headers)).status, 403);
  assert.equal((await call('POST', `/api/events/${id}/finalize`, { startsAt: '2030-01-01T10:00' }, { ...headers, 'X-Host-Token': hostToken })).status, 400);
  const finalized = await call('POST', `/api/events/${id}/finalize`, pick, { ...headers, 'X-Host-Token': hostToken });
  assert.equal(finalized.status, 200);
  assert.equal(finalized.data.event.pollOpen, false);
  assert.equal(finalized.data.event.startsAt, '2030-05-11T18:30');

  const { data: closed } = await call('GET', `/api/events/${id}`, undefined, headers);
  const byName = Object.fromEntries(closed.rsvps.map((rsvp) => [rsvp.name, rsvp.status]));
  assert.deepEqual(byName, { Ali: 'going', Ayşe: 'maybe' });
  assert.equal((await call('POST', `/api/events/${id}/finalize`, pick, { ...headers, 'X-Host-Token': hostToken })).status, 409);
});

test('time polls need 2 to 6 distinct options', async () => {
  const { startsAt, ...rest } = validEvent;
  const headers = { 'X-Forwarded-For': '10.0.0.3' };
  assert.equal((await call('POST', '/api/events', { ...rest, timeOptions: ['2030-05-10T20:00', '2030-05-10T20:00'] }, headers)).status, 400);
  const seven = Array.from({ length: 7 }, (_, i) => `2030-05-1${i}T20:00`);
  assert.equal((await call('POST', '/api/events', { ...rest, timeOptions: seven }, headers)).status, 400);
});
