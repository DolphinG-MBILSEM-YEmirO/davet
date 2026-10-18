// Entry point: a small history-API router. Real paths (/e/abc123) make invite
// links look clean when shared; vercel.json sends those paths to index.html.

import { mount } from './lib/dom.js';
import { renderHome } from './views/home.js';
import { renderEditor } from './views/editor.js';
import { renderEvent } from './views/event.js';
import { renderNotFound } from './views/not-found.js';

const SITE_NAME = 'Davet';

const routes = [
  { pattern: /^\/$/, render: () => renderHome(context) },
  { pattern: /^\/yeni$/, render: () => renderEditor(context) },
  { pattern: /^\/e\/([A-Za-z0-9_-]+)$/, render: ([id]) => renderEvent(id, context) },
  { pattern: /^\/e\/([A-Za-z0-9_-]+)\/duzenle$/, render: ([id]) => renderEditor(context, id) },
];

let leaveHandlers = [];
let isFirstRender = true;

const context = {
  /** Go to an in-app path. `replace` swaps the history entry (e.g. after create). */
  navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
    render();
  },
  /** Register cleanup (timers, listeners) for when the visitor leaves the view. */
  onLeave(handler) {
    leaveHandlers.push(handler);
  },
  /** Set the document title; null means the site name only. */
  setTitle(title) {
    document.title = title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} · Planı yap, linki at`;
  },
};

function render() {
  leaveHandlers.forEach((handler) => handler());
  leaveHandlers = [];

  const app = document.getElementById('app');
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const route = routes.find((item) => item.pattern.test(path));
  const params = route ? path.match(route.pattern).slice(1) : [];

  context.setTitle(null);
  mount(app, route ? route.render(params) : renderNotFound(context));
  window.scrollTo(0, 0);

  // Move focus to the new content so screen readers announce the page change.
  if (!isFirstRender) app.focus({ preventScroll: true });
  isFirstRender = false;
}

// Handle in-app links without a full page load.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link || link.target || link.hasAttribute('download')) return;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname === window.location.pathname && url.hash) return;

  event.preventDefault();
  context.navigate(url.pathname + url.search);
});

document.querySelector('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  document.getElementById('app').focus();
});

const header = document.querySelector('.site-header');
window.addEventListener('scroll', () => header?.classList.toggle('site-header--scrolled', window.scrollY > 12), {
  passive: true,
});
window.addEventListener('popstate', render);
render();
