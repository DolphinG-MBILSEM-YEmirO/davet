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
