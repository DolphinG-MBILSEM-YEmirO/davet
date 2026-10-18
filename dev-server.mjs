// Local development server: serves the static site and runs the API handler
// with the in-memory store. Mirrors the rewrites in vercel.json.
//
//   node dev-server.mjs            -> http://localhost:3000

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './api/events.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Paths without a file extension load the app shell; the client router
// decides what to show (including its own "not found" page).
async function serveStatic(pathname, res) {
  const isAppRoute = !extname(pathname);
  const relative = isAppRoute ? 'index.html' : normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (relative.startsWith('api') || relative.includes('_lib')) return false;

  try {
    const body = await readFile(join(ROOT, relative));
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(relative)] || 'application/octet-stream' });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/events' || pathname.startsWith('/api/events/')) {
    return handler(req, res);
  }
  if (await serveStatic(pathname, res)) return;

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}).listen(PORT, () => {
  console.log(`Davet running at http://localhost:${PORT}`);
});
