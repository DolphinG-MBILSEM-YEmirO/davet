// Home page: pitch, the visitor's own invites, and how it works.

import { el } from '../lib/dom.js';
import { local } from '../lib/local.js';
import { countdown, formatDay, formatTime, isPast } from '../lib/format.js';
import { THEMES } from '../shared/rules.js';
import { renderCover } from './components/cover.js';

// A sample invite shown in the hero so first-time visitors see the result.
const SAMPLE_INVITE = {
  title: 'Cuma film gecesi',
  theme: 'movie',
  startsAt: nextFridayEvening(),
};

const STEPS = [
  { emoji: '✍️', title: 'Daveti oluştur', text: 'Ne, nerede, ne zaman? Saat belli değilse seçenek ekle, arkadaşların oylasın.' },
  { emoji: '💬', title: 'Linki gruba at', text: 'WhatsApp, Instagram ya da Discord. Kimsenin uygulama indirmesi gerekmez.' },
  { emoji: '🙋', title: 'Kim geliyor gör', text: 'Herkes tek dokunuşla cevap verir, duvara yazar. Sayım sende.' },
];

function nextFridayEvening() {
  const date = new Date();
  date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7 || 7));
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T20:30`;
}

export function renderHome() {
  const invites = local.invites();
  const upcoming = invites.filter((invite) => !isPast(invite.startsAt));
  const past = invites.filter((invite) => isPast(invite.startsAt));

  return [
    el(
      'section',
      { class: 'hero' },
      el(
        'div',
        { class: 'hero__text' },
        el('p', { class: 'eyebrow', text: 'Üyelik yok · Uygulama yok · Ücretsiz' }),
        el('h1', {}, 'Planı yap, ', el('span', { class: 'highlight', text: 'linki at' }), ', kim geliyor gör.'),
        el('p', {
          class: 'hero__lead',
          text: 'Doğum günü, halı saha, ders çalışma, film gecesi… Davetini oluştur, grubuna at; kimin geldiğini ve kimin "belki" dediğini tek yerde gör.',
        }),
        el('div', { class: 'button-row' }, el('a', { class: 'button button--large', href: '/yeni' }, 'Davet oluştur')),
      ),
      el(
        'div',
        { class: 'hero__preview', 'aria-hidden': 'true' },
        el(
          'div',
          { class: 'preview-card' },
          renderCover(SAMPLE_INVITE, { size: 'small', titleTag: 'p' }),
          el(
            'div',
            { class: 'preview-card__body' },
            el('p', { class: 'preview-card__meta', text: `${formatDay(SAMPLE_INVITE.startsAt)} · 20:30` }),
            el(
              'div',
              { class: 'preview-card__faces' },
              ['Ece', 'Can', 'Deniz', 'Mert'].map((name, index) =>
                el('span', { class: 'avatar avatar--small', style: `--avatar-hue: ${index * 80 + 20}`, text: name[0] }),
              ),
              el('span', { class: 'preview-card__count', text: '4 kişi geliyor' }),
            ),
            el(
              'div',
              { class: 'preview-card__answers' },
              el('span', { class: 'pill pill--going', text: '🙌 Geliyorum' }),
              el('span', { class: 'pill', text: '🤔 Belki' }),
            ),
          ),
        ),
      ),
    ),

    invites.length > 0 &&
      el(
        'section',
        { class: 'section', 'aria-labelledby': 'my-invites-heading' },
        el('h2', { id: 'my-invites-heading', text: 'Davetlerim' }),
        upcoming.length > 0
          ? el('ul', { class: 'invite-list' }, upcoming.map(renderInviteItem))
          : el('p', { class: 'muted', text: 'Yaklaşan davetin yok. Yeni bir plan yap!' }),
        past.length > 0 &&
          el(
            'details',
            { class: 'past-invites' },
            el('summary', { text: `Geçmiş davetler (${past.length})` }),
            el('ul', { class: 'invite-list' }, past.map(renderInviteItem)),
          ),
      ),

    el(
      'section',
      { class: 'section', 'aria-labelledby': 'how-heading' },
      el('h2', { id: 'how-heading', text: 'Nasıl çalışır?' }),
      el(
        'ol',
        { class: 'steps' },
        STEPS.map((step) =>
          el(
            'li',
            { class: 'step' },
            el('span', { class: 'step__emoji', 'aria-hidden': 'true', text: step.emoji }),
            el('h3', { text: step.title }),
            el('p', { class: 'muted', text: step.text }),
          ),
        ),
      ),
    ),

    el(
      'section',
      { class: 'section theme-strip', 'aria-labelledby': 'themes-heading' },
      el('h2', { id: 'themes-heading', text: 'Her plana bir tema' }),
      el(
        'ul',
        { class: 'theme-strip__list' },
        THEMES.map((theme) =>
          el(
            'li',
            {},
            el(
              'a',
              { class: 'theme-chip', href: `/yeni?tema=${theme.id}` },
              el('span', { 'aria-hidden': 'true', text: theme.emoji }),
              theme.label,
            ),
          ),
        ),
      ),
    ),
  ];
}

function renderInviteItem(invite) {
  const { label, past } = invite.pollOpen ? { label: 'Saat oylanıyor', past: false } : countdown(invite.startsAt);
  return el(
    'li',
    {},
    el(
      'a',
      { class: 'invite-item', href: `/e/${invite.id}` },
      renderCover({ theme: invite.theme }, { size: 'tiny' }),
      el(
        'span',
        { class: 'invite-item__text' },
        el('span', { class: 'invite-item__title', text: invite.title }),
        el('span', {
          class: 'muted',
          text: invite.pollOpen ? 'Herkese uyan saat seçiliyor' : `${formatDay(invite.startsAt)} · ${formatTime(invite.startsAt)}`,
        }),
      ),
      el(
        'span',
        { class: 'invite-item__tags' },
        invite.role === 'host' && el('span', { class: 'tag tag--host', text: 'Düzenleyen' }),
        el('span', { class: past ? 'tag' : 'tag tag--soon', text: label }),
      ),
    ),
  );
}
