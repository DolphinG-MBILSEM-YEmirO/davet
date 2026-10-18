// Entry point: a small hash router (#/e/<id>). Hash routes work on any static
// host, including GitHub Pages, and the invite secret in the link never
// reaches a server because browsers don't send the #fragment.

import { mount } from './lib/dom.js';
import { renderHome } from './views/home.js';
import { renderEditor } from './views/editor.js';
import { renderEvent } from './views/event.js';
import { renderNotFound } from './views/not-found.js';

const SITE_NAME = 'Davet';
const INVITE_ID = '([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)';

const routes = [
  { pattern: /^\/$/, render: () => renderHome(context) },
  { pattern: /^\/yeni$/, render: () => renderEditor(context) },
  { pattern: new RegExp(`^/e/${INVITE_ID}$`), render: ([id]) => renderEvent(id, context) },
  { pattern: new RegExp(`^/e/${INVITE_ID}/duzenle$`), render: ([id]) => renderEditor(context, id) },
];

let leaveHandlers = [];
let isFirstRender = true;

/** Split "#/e/abc?yeni=1" into a path and query parameters. */
function currentRoute() {
  const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  return { path: path.replace(/\/+$/, '') || '/', query: new URLSearchParams(query) };
}

const context = {
  /** Query parameters of the current route (the part after "?" in the hash). */
  query: new URLSearchParams(),
  /** Go to an in-app path such as "/e/abc". `replace` swaps the history entry. */
  navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState(null, '', `#${path}`);
    else history.pushState(null, '', `#${path}`);
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
  const { path, query } = currentRoute();
  const route = routes.find((item) => item.pattern.test(path));
  const params = route ? path.match(route.pattern).slice(1) : [];

  context.query = query;
  context.setTitle(null);
  mount(app, route ? route.render(params) : renderNotFound(context));
  window.scrollTo(0, 0);

  // Move focus to the new content so screen readers announce the page change.
  if (!isFirstRender) app.focus({ preventScroll: true });
  isFirstRender = false;
}

document.querySelector('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  document.getElementById('app').focus();
});

const header = document.querySelector('.site-header');
window.addEventListener('scroll', () => header?.classList.toggle('site-header--scrolled', window.scrollY > 12), {
  passive: true,
});
window.addEventListener('hashchange', render);
render();
