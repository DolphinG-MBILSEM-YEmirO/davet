// Local development: serves the static site and runs a local relay, so
// nothing is published to the public relays while you work.
//
//   npm run dev   -> open the printed URL

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRelay } from './relay.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const RELAY_PORT = Number(process.env.RELAY_PORT) || 7777;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

startRelay(RELAY_PORT);

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const relative = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, relative));
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(relative)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Davet: http://localhost:${PORT}/?relays=ws://localhost:${RELAY_PORT}`);
});
