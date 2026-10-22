// Invite page: details, one-tap RSVP, guest list and sharing. Messages and
// groups live in Sharloop, which the page points to.
// Refreshes in the background so new answers show up without reloading.

import { el, mount, downloadText } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { local } from '../lib/local.js';
import { buildEventIcs } from '../lib/ics.js';
import { countdown, formatDay, formatTime, formatWhen } from '../lib/format.js';
import { LIMITS, SHARLOOP_URL } from '../shared/rules.js';
import { renderCover } from './components/cover.js';
import { renderAvatar } from './components/avatar.js';
import { showToast } from './components/toast.js';

const REFRESH_MS = 15000;

const STATUS = {
  going: { emoji: '🙌', button: 'Geliyorum', group: 'Geliyor' },
  maybe: { emoji: '🤔', button: 'Belki', group: 'Belki' },
  declined: { emoji: '😢', button: 'Gelemem', group: 'Gelemiyor' },
};

export function renderEvent(id, context) {
  const container = el('div', { class: 'event-page' });
  mount(container, el('p', { class: 'loading', text: 'Davet yükleniyor…' }));

  const isNew = context.query.has('yeni');
  if (isNew) history.replaceState(null, '', `#/e/${id}`);

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
          el('a', { class: 'button', href: '#/yeni' }, 'Yeni davet oluştur'),
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
  const shareUrl = `${window.location.href.split('#')[0]}#/e/${id}`;

  const ownRsvp = () => state.rsvps.find((rsvp) => rsvp.isMine) || null;
  const isOver = () => countdown(state.event.startsAt, new Date(), { allDay: state.event.allDay });

  const headerBox = el('div', { class: 'event-header' });
  const shareBox = el('div');
  const countsBox = el('p', { class: 'event-counts', 'aria-live': 'polite' });
  const rsvpBox = el('section', { class: 'panel rsvp', 'aria-labelledby': 'rsvp-heading' });
  const guestsBox = el('section', { class: 'panel', 'aria-labelledby': 'guests-heading' });
  const sharloopBox = el('div');

  let editingRsvp = false;

  function renderHeader() {
    const { event, isHost } = state;
    const { label, past } = event.pollOpen ? { label: '🗳️ Saat oylanıyor', past: false } : isOver();
    const when = event.pollOpen ? `Saat oylanıyor · ${event.timeOptions.length} seçenek` : formatWhen(event);
    context.setTitle(event.title);

    mount(
      headerBox,
      renderCover(event.pollOpen ? { ...event, startsAt: null } : event),
      el(
        'div',
        { class: 'event-info' },
        el('span', { class: past ? 'tag' : 'tag tag--soon', text: label }),
        el(
          'ul',
          { class: 'event-facts' },
          el('li', {}, el('span', { 'aria-hidden': 'true', text: '📅' }), when),
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
    mount(shareBox, renderShare());
  }

  function renderCounts() {
    if (state.event.pollOpen) {
      const voters = state.rsvps.filter((rsvp) => rsvp.available?.length).length;
      countsBox.textContent = voters ? `${voters} kişi oy verdi` : 'Henüz oy yok. İlk sen ol!';
      return;
    }
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
      el('a', { class: 'button button--secondary', href: `#/e/${id}/duzenle` }, 'Düzenle'),
      deleteButton,
      cancelButton,
    );
  }

  function renderShare() {
    const { event } = state;
    const message = event.pollOpen
      ? `${event.title}\nHangi saat uyar? Oyla 👉 ${shareUrl}`
      : `${event.title} · ${formatWhen(event)}\nGeliyor musun? 👉 ${shareUrl}`;
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
    if (!event.pollOpen) {
      buttons.push(
        el(
          'button',
          {
            class: 'button button--ghost',
            type: 'button',
            onclick: () => downloadText('davet.ics', buildEventIcs(event, shareUrl), 'text/calendar'),
          },
          'Takvime ekle',
        ),
      );
    }

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
    if (state.event.pollOpen) {
      renderPoll();
      return;
    }
    const mine = ownRsvp();
    const { past } = isOver();
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
        local.setName(result.rsvp.name);
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

  /**
   * "Ortak saat" poll: everyone ticks the options that suit them, the best
   * option is highlighted, and the host locks in the final time.
   */
  function renderPoll() {
    const { event, isHost } = state;
    const mine = ownRsvp();
    const myChoices = new Set(mine?.available || []);
    const votesFor = (option) => state.rsvps.filter((rsvp) => rsvp.available?.includes(option));
    const bestCount = Math.max(0, ...event.timeOptions.map((option) => votesFor(option).length));
    const errorBox = el('p', { class: 'form-error', role: 'alert' });

    const nameInput = el('input', {
      id: 'poll-name',
      maxlength: LIMITS.name,
      autocomplete: 'given-name',
      placeholder: 'Adın',
      value: mine?.name || local.name(),
    });

    async function pick(option, button) {
      button.disabled = true;
      try {
        await api.finalizeEvent(id, option);
        // Reload so the RSVPs promoted to "going" show up too.
        state = await api.getEvent(id);
        local.rememberInvite(state.event, 'host');
        showToast('Saat belirlendi, oy verenler "geliyor" oldu 🎉');
        renderHeader();
        renderCounts();
        renderRsvp();
        renderGuests();
      } catch (error) {
        button.disabled = false;
        showToast(error.message);
      }
    }

    const optionRows = event.timeOptions.map((option, index) => {
      const voters = votesFor(option);
      const isBest = bestCount > 0 && voters.length === bestCount;
      const checkboxId = `poll-option-${index}`;
      return el(
        'li',
        { class: `poll-option${isBest ? ' poll-option--best' : ''}` },
        el('input', { id: checkboxId, type: 'checkbox', value: option, checked: myChoices.has(option) }),
        el(
          'label',
          { for: checkboxId, class: 'poll-option__label' },
          el('span', { class: 'poll-option__day', text: formatDay(option) }),
          el('span', { class: 'poll-option__time', text: formatTime(option) }),
        ),
        el(
          'span',
          { class: 'poll-option__votes' },
          isBest && el('span', { class: 'tag tag--soon', text: 'En uygun' }),
          el('span', { class: 'poll-option__count', text: `${voters.length} kişi` }),
        ),
        el('span', {
          class: 'poll-option__bar',
          style: `--share: ${state.rsvps.length ? voters.length / state.rsvps.length : 0}`,
          'aria-hidden': 'true',
        }),
        voters.length > 0 &&
          el('span', { class: 'poll-option__names', text: voters.map((rsvp) => rsvp.name).join(', ') }),
        isHost &&
          el(
            'button',
            {
              class: 'button button--small button--secondary poll-option__pick',
              type: 'button',
              onclick: (clickEvent) => pick(option, clickEvent.currentTarget),
            },
            'Bu saati seç',
          ),
      );
    });

    async function onSubmit(submitEvent) {
      submitEvent.preventDefault();
      errorBox.textContent = '';
      if (!nameInput.value.trim()) {
        errorBox.textContent = 'Önce adını yaz ki kim olduğunu bilelim.';
        nameInput.focus();
        return;
      }
      const available = [...rsvpBox.querySelectorAll('.poll-option input:checked')].map((input) => input.value);
      const button = submitEvent.submitter;
      if (button) button.disabled = true;
      try {
        const result = await api.saveRsvp(id, {
          name: nameInput.value,
          status: available.length ? 'maybe' : 'declined',
          available,
        });
        local.setName(result.rsvp.name);
        local.rememberInvite(state.event, 'guest');
        state = { ...state, rsvps: [...state.rsvps.filter((rsvp) => rsvp.id !== result.rsvp.id), result.rsvp] };
        showToast(available.length ? 'Oyun kaydedildi 🗳️' : 'Hiçbir saat uymuyor diye kaydettik');
        renderRsvp();
        renderCounts();
        renderGuests();
      } catch (error) {
        errorBox.textContent = error.message;
        if (button) button.disabled = false;
      }
    }

    mount(
      rsvpBox,
      el('h2', { id: 'rsvp-heading', text: 'Hangi saat uyar?' }),
      el('p', { class: 'muted', text: isHost ? 'Oylar geldikçe en uygun saati seç.' : 'Uyan saatlerin hepsini işaretle.' }),
      el(
        'form',
        { class: 'poll', onsubmit: onSubmit },
        el('ul', { class: 'poll__options' }, optionRows),
        el('label', { class: 'visually-hidden', for: 'poll-name', text: 'Adın' }),
        nameInput,
        errorBox,
        el('div', { class: 'button-row' }, el('button', { class: 'button', type: 'submit' }, mine ? 'Oyumu güncelle' : 'Oyumu kaydet')),
      ),
    );
  }

  /**
   * Davet has no chat: messages and groups are Sharloop's, and this panel
   * leads there. For a plan shared from Sharloop, people with the app can
   * open the plan there (a "coming" also goes into their calendar), and
   * the rest can join with the host found, ready to add as a friend.
   * Answering here works either way.
   */
  function renderSharloop() {
    const { event } = state;
    const fromSharloop = Boolean(event.sharloop);
    const buttons = fromSharloop
      ? [
          el('a', { class: 'button', href: `${SHARLOOP_URL}/#davet=${id}`, rel: 'noopener' }, 'Sharloop’ta aç'),
          el(
            'a',
            { class: 'button button--secondary', href: `${SHARLOOP_URL}/?ekle=${event.sharloop.kod}`, rel: 'noopener' },
            'Sharloop’a katıl',
          ),
        ]
      : [el('a', { class: 'button', href: SHARLOOP_URL, rel: 'noopener' }, 'Sharloop’u aç')];
    mount(
      sharloopBox,
      el(
        'section',
        { class: 'panel sharloop', 'aria-labelledby': 'sharloop-heading' },
        el('h2', { id: 'sharloop-heading', text: fromSharloop ? 'Bu plan Sharloop’tan' : 'Sohbet ve gruplar Sharloop’ta' }),
        el('p', {
          class: 'muted',
          text: fromSharloop
            ? `${event.hostName} bu planı Sharloop’ta kurdu. Uygulaman varsa planı orada aç; “Geliyorum” dersen takvimine de eklenir. ${event.hostName} ile mesajlaşmak ve grup kurmak için de Sharloop’u kullan.`
            : 'Davet’te yalnızca davet ve cevaplar var. Arkadaşlarınla mesajlaşmak, grup kurmak ve sonraki planı birlikte ayarlamak için Sharloop’u kullan.',
        }),
        el('div', { class: 'button-row' }, buttons),
        fromSharloop &&
          event.sharloop.kullaniciAdi &&
          el('p', { class: 'sharloop__hint muted', text: `Sharloop’ta @${event.sharloop.kullaniciAdi} olarak bulabilirsin.` }),
      ),
    );
  }

  function renderGuests() {
    const groups = state.event.pollOpen
      ? [{ title: `🗳️ Oy verenler`, people: state.rsvps }]
      : Object.keys(STATUS).map((status) => ({
          title: `${STATUS[status].emoji} ${STATUS[status].group}`,
          people: state.rsvps.filter((rsvp) => rsvp.status === status),
        }));

    mount(
      guestsBox,
      el('h2', { id: 'guests-heading', text: state.event.pollOpen ? 'Kimler katılıyor?' : 'Kimler geliyor?' }),
      state.rsvps.length === 0
        ? el('p', { class: 'muted', text: 'Linki paylaş, cevaplar burada görünsün.' })
        : groups
            .filter((group) => group.people.length > 0)
            .map((group) =>
              el(
                'div',
                { class: 'guest-group' },
                el('h3', { text: `${group.title} (${group.people.length})` }),
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
                        el('span', { class: 'guest__name' }, rsvp.name, rsvp.isMine && el('span', { class: 'muted', text: ' (sen)' })),
                        rsvp.note && el('span', { class: 'guest__note', text: rsvp.note }),
                      ),
                    ),
                  ),
                ),
              ),
            ),
    );
  }

  renderHeader();
  renderCounts();
  renderRsvp();
  renderSharloop();
  renderGuests();

  // Keep "Davetlerim" in sync with the latest title and time.
  if (state.isHost) local.rememberInvite(state.event, 'host');
  else if (ownRsvp()) local.rememberInvite(state.event, 'guest');

  const node = el(
    'div',
    { class: 'event-layout' },
    el('div', { class: 'event-layout__main' }, headerBox, shareBox),
    el('div', { class: 'event-layout__side' }, rsvpBox, sharloopBox, guestsBox),
  );

  return {
    node,
    update(data) {
      const detailsChanged = data.event.updatedAt !== state.event.updatedAt;
      const pollClosed = state.event.pollOpen && !data.event.pollOpen;
      state = data;
      if (detailsChanged) {
        renderHeader();
        renderSharloop();
      }
      renderCounts();
      if (pollClosed || (!editingRsvp && !rsvpBox.contains(document.activeElement))) renderRsvp();
      renderGuests();
    },
  };
}
