// Invite page: details, one-tap RSVP, guest list, the wall and sharing.
// Refreshes in the background so new answers show up without reloading.

import { el, mount, downloadText } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { local } from '../lib/local.js';
import { buildEventIcs } from '../lib/ics.js';
import { countdown, formatDay, formatTime, timeAgo } from '../lib/format.js';
import { LIMITS } from '../shared/rules.js';
import { renderCover } from './components/cover.js';
import { renderAvatar } from './components/avatar.js';
import { showToast } from './components/toast.js';

const REFRESH_MS = 20000;

const STATUS = {
  going: { emoji: '🙌', button: 'Geliyorum', group: 'Geliyor' },
  maybe: { emoji: '🤔', button: 'Belki', group: 'Belki' },
  declined: { emoji: '😢', button: 'Gelemem', group: 'Gelemiyor' },
};

export function renderEvent(id, context) {
  const container = el('div', { class: 'event-page' });
  mount(container, el('p', { class: 'loading', text: 'Davet yükleniyor…' }));

  const isNew = new URLSearchParams(window.location.search).has('yeni');
  if (isNew) history.replaceState(null, '', `/e/${id}`);

  api
    .getEvent(id)
    .then((data) => {
      const page = createEventPage(id, data, context, { isNew });
      mount(container, page.node);
      startRefreshing(id, page, context);
    })
    .catch((error) => {
      context.setTitle('Davet bulunamadı');
      mount(
        container,
        el(
          'div',
          { class: 'empty-state' },
          el('span', { class: 'empty-state__emoji', 'aria-hidden': 'true', text: '🫥' }),
          el('h1', { text: error.status === 404 ? 'Bu davet bulunamadı' : 'Davet yüklenemedi' }),
          el('p', { class: 'muted', text: error.message }),
          el('a', { class: 'button', href: '/yeni' }, 'Yeni davet oluştur'),
        ),
      );
    });

  return container;
}

function startRefreshing(id, page, context) {
  const refresh = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      page.update(await api.getEvent(id));
    } catch {
      // Keep showing the last good data; the next tick tries again.
    }
  };
  const timer = setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', refresh);
  context.onLeave(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', refresh);
  });
}

/**
 * Build the page once. Forms are created a single time so background
 * refreshes never wipe what the visitor is typing; only the lists re-render.
 */
function createEventPage(id, initialData, context, { isNew }) {
  let state = initialData;
  const shareUrl = `${window.location.origin}/e/${id}`;

  const ownRsvp = () => {
    const mine = local.rsvp(id);
    return mine ? state.rsvps.find((rsvp) => rsvp.id === mine.guestId) || null : null;
  };

  const headerBox = el('div', { class: 'event-header' });
  const countsBox = el('p', { class: 'event-counts', 'aria-live': 'polite' });
  const rsvpBox = el('section', { class: 'panel rsvp', 'aria-labelledby': 'rsvp-heading' });
  const guestsBox = el('section', { class: 'panel', 'aria-labelledby': 'guests-heading' });
  const wallList = el('ul', { class: 'wall__list' });

  let editingRsvp = false;
  // The wall's name field, so an RSVP can fill it in for the visitor.
  let wallNameInput = null;

  function renderHeader() {
    const { event, isHost } = state;
    const { label, past } = countdown(event.startsAt);
    context.setTitle(event.title);

    mount(
      headerBox,
      renderCover(event),
      el(
        'div',
        { class: 'event-info' },
        el('span', { class: past ? 'tag' : 'tag tag--soon', text: label }),
        el(
          'ul',
          { class: 'event-facts' },
          el('li', {}, el('span', { 'aria-hidden': 'true', text: '📅' }), `${formatDay(event.startsAt)} · ${formatTime(event.startsAt)}`),
          event.location &&
            el(
              'li',
              {},
              el('span', { 'aria-hidden': 'true', text: '📍' }),
              el(
                'a',
                {
                  href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
                event.location,
              ),
            ),
          el(
            'li',
            {},
            renderAvatar(event.hostName, { size: 'small' }),
            el('span', {}, el('strong', { text: event.hostName }), ' davet ediyor'),
          ),
        ),
        event.description && el('p', { class: 'event-description', text: event.description }),
        countsBox,
        isHost && renderHostTools(),
      ),
    );
  }

  function renderCounts() {
    const count = (status) => state.rsvps.filter((rsvp) => rsvp.status === status).length;
    const going = count('going');
    const maybe = count('maybe');
    countsBox.textContent = going || maybe ? `${going} kişi geliyor${maybe ? ` · ${maybe} belki` : ''}` : 'Henüz cevap yok. İlk sen ol!';
  }

  function renderHostTools() {
    const deleteButton = el('button', { class: 'button button--ghost button--danger', type: 'button' }, 'Daveti sil');
    const cancelButton = el('button', { class: 'button button--ghost', type: 'button', hidden: true }, 'Vazgeç');
    let confirming = false;

    deleteButton.addEventListener('click', async () => {
      if (!confirming) {
        confirming = true;
        deleteButton.textContent = 'Eminim, sil';
        cancelButton.hidden = false;
        return;
      }
      deleteButton.disabled = true;
      try {
        await api.deleteEvent(id);
        local.forgetInvite(id);
        showToast('Davet silindi');
        context.navigate('/', { replace: true });
      } catch (error) {
        deleteButton.disabled = false;
        showToast(error.message);
      }
    });
    cancelButton.addEventListener('click', () => {
      confirming = false;
      deleteButton.textContent = 'Daveti sil';
      cancelButton.hidden = true;
    });

    return el(
      'div',
      { class: 'host-tools' },
      el('span', { class: 'tag tag--host', text: 'Bu davet senin' }),
      el('a', { class: 'button button--secondary', href: `/e/${id}/duzenle` }, 'Düzenle'),
      deleteButton,
      cancelButton,
    );
  }

  function renderShare() {
    const message = `${state.event.title} · ${formatDay(state.event.startsAt)} ${formatTime(state.event.startsAt)}\nGeliyor musun? 👉 ${shareUrl}`;
    const buttons = [
      el(
        'a',
        {
          class: 'button button--whatsapp',
          href: `https://wa.me/?text=${encodeURIComponent(message)}`,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'WhatsApp\'ta paylaş',
      ),
      el(
        'button',
        {
          class: 'button button--secondary',
          type: 'button',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(shareUrl);
              showToast('Link kopyalandı');
            } catch {
              window.prompt('Linki kopyala:', shareUrl);
            }
          },
        },
        'Linki kopyala',
      ),
    ];
    if (navigator.share) {
      buttons.push(
        el(
          'button',
          {
            class: 'button button--secondary',
            type: 'button',
            onclick: () => navigator.share({ title: state.event.title, text: message, url: shareUrl }).catch(() => {}),
          },
          'Diğer',
        ),
      );
    }
    buttons.push(
      el(
        'button',
        {
          class: 'button button--ghost',
          type: 'button',
          onclick: () => downloadText('davet.ics', buildEventIcs(state.event, shareUrl), 'text/calendar'),
        },
        'Takvime ekle',
      ),
    );

    return el(
      'section',
      { class: `panel share${isNew ? ' share--new' : ''}`, 'aria-labelledby': 'share-heading' },
      isNew
        ? el('h2', { id: 'share-heading', text: '🎉 Davetin hazır! Şimdi linki grubuna at.' })
        : el('h2', { id: 'share-heading', class: 'visually-hidden', text: 'Paylaş' }),
      el('div', { class: 'button-row' }, buttons),
    );
  }

  function renderRsvp() {
    const mine = ownRsvp();
    const past = countdown(state.event.startsAt).past;
    const heading = el('h2', { id: 'rsvp-heading', text: past ? 'Bu plan bitti' : 'Geliyor musun?' });

    if (past) {
      mount(rsvpBox, heading, el('p', { class: 'muted', text: 'Cevaplar kapandı ama duvara hâlâ yazabilirsin.' }));
      return;
    }

    if (mine && !editingRsvp) {
      const status = STATUS[mine.status];
      mount(
        rsvpBox,
        heading,
        el(
          'div',
          { class: 'rsvp__current' },
          el('span', { class: `pill pill--${mine.status}`, text: `${status.emoji} ${status.button}` }),
          mine.note && el('span', { class: 'muted', text: `“${mine.note}”` }),
          el(
            'button',
            {
              class: 'button button--ghost',
              type: 'button',
              onclick: () => {
                editingRsvp = true;
                renderRsvp();
                rsvpBox.querySelector('button[data-status]')?.focus();
              },
            },
            'Değiştir',
          ),
        ),
      );
      return;
    }

    const nameInput = el('input', {
      id: 'rsvp-name',
      maxlength: LIMITS.name,
      autocomplete: 'given-name',
      placeholder: 'Adın',
      value: mine?.name || local.name(),
    });
    const noteInput = el('input', {
      id: 'rsvp-note',
      maxlength: LIMITS.note,
      placeholder: 'Not (isteğe bağlı): "10 dk geç kalırım"',
      value: mine?.note || '',
    });
    const errorBox = el('p', { class: 'form-error', role: 'alert' });

    async function answer(status, button) {
      errorBox.textContent = '';
      if (!nameInput.value.trim()) {
        errorBox.textContent = 'Önce adını yaz ki kim olduğunu bilelim.';
        nameInput.focus();
        return;
      }
      button.disabled = true;
      try {
        const result = await api.saveRsvp(id, { name: nameInput.value, status, note: noteInput.value });
        if (result.guestToken) local.setRsvp(id, { guestId: result.rsvp.id, guestToken: result.guestToken });
        local.setName(result.rsvp.name);
        if (wallNameInput && !wallNameInput.value.trim()) wallNameInput.value = result.rsvp.name;
        local.rememberInvite(state.event, 'guest');
        state = { ...state, rsvps: [...state.rsvps.filter((rsvp) => rsvp.id !== result.rsvp.id), result.rsvp] };
        editingRsvp = false;
        showToast(status === 'going' ? 'Harika, görüşürüz! 🙌' : 'Cevabın kaydedildi');
        renderRsvp();
        renderCounts();
        renderGuests();
      } catch (error) {
        errorBox.textContent = error.message;
        button.disabled = false;
      }
    }

    mount(
      rsvpBox,
      heading,
      el(
        'div',
        { class: 'rsvp__form' },
        el('label', { class: 'visually-hidden', for: 'rsvp-name', text: 'Adın' }),
        nameInput,
        el(
          'div',
          { class: 'rsvp__choices', role: 'group', 'aria-label': 'Cevabın' },
          Object.entries(STATUS).map(([status, info]) =>
            el(
              'button',
              {
                class: `choice choice--${status}${mine?.status === status ? ' choice--selected' : ''}`,
                type: 'button',
                'data-status': status,
                'aria-pressed': mine?.status === status ? 'true' : 'false',
                onclick: (event) => answer(status, event.currentTarget),
              },
              el('span', { class: 'choice__emoji', 'aria-hidden': 'true', text: info.emoji }),
              info.button,
            ),
          ),
        ),
        el('label', { class: 'visually-hidden', for: 'rsvp-note', text: 'Not' }),
        noteInput,
        errorBox,
      ),
    );
  }

  function renderGuests() {
    const mine = local.rsvp(id);
    const groups = Object.keys(STATUS).map((status) => ({
      status,
      people: state.rsvps.filter((rsvp) => rsvp.status === status),
    }));

    mount(
      guestsBox,
      el('h2', { id: 'guests-heading', text: 'Kimler geliyor?' }),
      state.rsvps.length === 0
        ? el('p', { class: 'muted', text: 'Linki paylaş, cevaplar burada görünsün.' })
        : groups
            .filter((group) => group.people.length > 0)
            .map((group) =>
              el(
                'div',
                { class: 'guest-group' },
                el('h3', { text: `${STATUS[group.status].emoji} ${STATUS[group.status].group} (${group.people.length})` }),
                el(
                  'ul',
                  { class: 'guest-list' },
                  group.people.map((rsvp) =>
                    el(
                      'li',
                      { class: 'guest' },
                      renderAvatar(rsvp.name),
                      el(
                        'span',
                        { class: 'guest__text' },
                        el('span', { class: 'guest__name' }, rsvp.name, mine?.guestId === rsvp.id && el('span', { class: 'muted', text: ' (sen)' })),
                        rsvp.note && el('span', { class: 'guest__note', text: rsvp.note }),
                      ),
                    ),
                  ),
                ),
              ),
            ),
    );
  }

  function renderWallList() {
    const comments = [...state.comments].reverse();
    mount(
      wallList,
      comments.length === 0
        ? el('li', { class: 'muted wall__empty', text: 'Henüz kimse yazmadı. Bir “Ben varım!” bırak.' })
        : comments.map((comment) => {
            const canDelete = state.isHost || Boolean(local.commentToken(comment.id));
            return el(
              'li',
              { class: 'post' },
              renderAvatar(comment.name),
              el(
                'div',
                { class: 'post__body' },
                el(
                  'p',
                  { class: 'post__meta' },
                  el('strong', { text: comment.name }),
                  el('span', { class: 'muted', text: ` · ${timeAgo(comment.createdAt)}` }),
                ),
                el('p', { class: 'post__text', text: comment.text }),
              ),
              canDelete &&
                el(
                  'button',
                  {
                    class: 'post__delete',
                    type: 'button',
                    'aria-label': `${comment.name} adlı kişinin mesajını sil`,
                    onclick: async () => {
                      try {
                        await api.deleteComment(id, comment.id);
                        state = { ...state, comments: state.comments.filter((item) => item.id !== comment.id) };
                        renderWallList();
                        showToast('Mesaj silindi');
                      } catch (error) {
                        showToast(error.message);
                      }
                    },
                  },
                  '✕',
                ),
            );
          }),
    );
  }

  function renderWall() {
    const nameInput = el('input', {
      id: 'wall-name',
      maxlength: LIMITS.name,
      autocomplete: 'given-name',
      placeholder: 'Adın',
      value: local.name(),
    });
    wallNameInput = nameInput;
    const textInput = el('textarea', { id: 'wall-text', rows: 2, maxlength: LIMITS.comment, placeholder: 'Bir şey yaz…' });
    const errorBox = el('p', { class: 'form-error', role: 'alert' });
    const sendButton = el('button', { class: 'button', type: 'submit' }, 'Gönder');

    async function onSubmit(event) {
      event.preventDefault();
      errorBox.textContent = '';
      if (!nameInput.value.trim()) {
        errorBox.textContent = 'Adını yazmayı unutma.';
        nameInput.focus();
        return;
      }
      if (!textInput.value.trim()) {
        textInput.focus();
        return;
      }
      sendButton.disabled = true;
      try {
        const { comment, commentToken } = await api.addComment(id, { name: nameInput.value, text: textInput.value });
        local.setCommentToken(comment.id, commentToken);
        local.setName(comment.name);
        state = { ...state, comments: [...state.comments, comment] };
        textInput.value = '';
        renderWallList();
      } catch (error) {
        errorBox.textContent = error.message;
      } finally {
        sendButton.disabled = false;
      }
    }

    return el(
      'section',
      { class: 'panel wall', 'aria-labelledby': 'wall-heading' },
      el('h2', { id: 'wall-heading', text: 'Duvar' }),
      el(
        'form',
        { class: 'wall__form', onsubmit: onSubmit },
        el('label', { class: 'visually-hidden', for: 'wall-name', text: 'Adın' }),
        nameInput,
        el('label', { class: 'visually-hidden', for: 'wall-text', text: 'Mesajın' }),
        textInput,
        errorBox,
        el('div', { class: 'button-row' }, sendButton),
      ),
      wallList,
    );
  }

  renderHeader();
  renderCounts();
  renderRsvp();
  renderGuests();
  renderWallList();

  // Keep "Davetlerim" in sync with the latest title and time.
  if (state.isHost) local.rememberInvite(state.event, 'host');
  else if (local.rsvp(id)) local.rememberInvite(state.event, 'guest');

  const node = el(
    'div',
    { class: 'event-layout' },
    el('div', { class: 'event-layout__main' }, headerBox, renderShare()),
    el('div', { class: 'event-layout__side' }, rsvpBox, guestsBox, renderWall()),
  );

  return {
    node,
    update(data) {
      const detailsChanged = data.event.updatedAt !== state.event.updatedAt;
      state = data;
      if (detailsChanged) renderHeader();
      renderCounts();
      if (!editingRsvp && !rsvpBox.contains(document.activeElement)) renderRsvp();
      renderGuests();
      renderWallList();
    },
  };
}
