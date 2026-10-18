// Fallback for unknown paths.

import { el } from '../lib/dom.js';

export function renderNotFound(context) {
  context.setTitle('Sayfa bulunamadı');
  return el(
    'div',
    { class: 'empty-state' },
    el('span', { class: 'empty-state__emoji', 'aria-hidden': 'true', text: '🧭' }),
    el('h1', { text: 'Bu sayfa yok' }),
    el('p', { class: 'muted', text: 'Link yanlış kopyalanmış olabilir.' }),
    el('a', { class: 'button', href: '/' }, 'Ana sayfaya dön'),
  );
}
