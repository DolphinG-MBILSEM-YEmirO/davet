// Create or edit an invite. The cover preview updates as the host types.

import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { local } from '../lib/local.js';
import { DEFAULT_THEME, LIMITS, THEMES, findTheme } from '../shared/rules.js';
import { renderCover } from './components/cover.js';
import { showToast } from './components/toast.js';

const DEFAULT_HOUR = 20;

function defaultStartsAt() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${DEFAULT_HOUR}:00`;
}

/**
 * @param {object} context Router context.
 * @param {string} [eventId] When given, edit that invite instead of creating one.
 */
export function renderEditor(context, eventId) {
  const container = el('div', { class: 'editor-page' });

  if (!eventId) {
    const theme = context.query.get('tema');
    context.setTitle('Yeni davet');
    mount(container, renderForm(context, {
      title: '',
      startsAt: defaultStartsAt(),
      location: '',
      description: '',
      hostName: local.name(),
      theme: THEMES.some((item) => item.id === theme) ? theme : DEFAULT_THEME,
    }));
    return container;
  }

  context.setTitle('Daveti düzenle');
  mount(container, el('p', { class: 'loading', text: 'Davet yükleniyor…' }));
  api
    .getEvent(eventId)
    .then(({ event, isHost }) => {
      if (!isHost) {
        mount(container, renderMessage('Bu daveti yalnızca oluşturan kişi düzenleyebilir.', `#/e/${eventId}`));
        return;
      }
      mount(container, renderForm(context, event, eventId));
    })
    .catch((error) => mount(container, renderMessage(error.message, '#/')));
  return container;
}

function renderMessage(text, backHref) {
  return el(
    'div',
    { class: 'empty-state' },
    el('p', { text }),
    el('a', { class: 'button button--secondary', href: backHref }, 'Geri dön'),
  );
}

function field({ id, label, hint, input }) {
  return el(
    'div',
    { class: 'field' },
    el('label', { for: id, text: label }),
    input,
    hint && el('p', { class: 'field__hint', id: `${id}-hint`, text: hint }),
  );
}

function renderForm(context, initial, eventId) {
  const isEditing = Boolean(eventId);
  const values = {
    ...initial,
    mode: initial.pollOpen ? 'poll' : 'fixed',
    timeOptions: initial.pollOpen ? [...initial.timeOptions] : [initial.startsAt, ''],
  };
  // A fixed time can't be turned back into a poll once guests have answered it.
  const canPoll = !isEditing || initial.pollOpen;
  const preview = el('div', { class: 'editor__preview' });
  const errorBox = el('p', { class: 'form-error', role: 'alert' });

  const previewStartsAt = () =>
    values.mode === 'poll' ? values.timeOptions.filter(Boolean).sort()[0] || '' : values.startsAt;
  const updatePreview = () =>
    mount(preview, renderCover({ ...values, startsAt: previewStartsAt() }, { size: 'large', titleTag: 'p' }));
  updatePreview();

  const bind = (name) => (event) => {
    values[name] = event.target.value;
    updatePreview();
  };

  const themePicker = el(
    'fieldset',
    { class: 'theme-picker' },
    el('legend', { text: 'Tema' }),
    THEMES.map((theme) =>
      el(
        'label',
        { class: 'theme-option', style: `--cover-from: ${theme.colors[0]}; --cover-to: ${theme.colors[1]}` },
        el('input', {
          type: 'radio',
          name: 'theme',
          value: theme.id,
          checked: theme.id === values.theme,
          onchange: bind('theme'),
        }),
        el('span', { class: 'theme-option__emoji', 'aria-hidden': 'true', text: theme.emoji }),
        el('span', { class: 'theme-option__label', text: theme.label }),
      ),
    ),
  );

  const whenBox = el('div', { class: 'when' });

  function renderWhen() {
    const modeSwitch =
      canPoll &&
      el(
        'div',
        { class: 'segmented', role: 'radiogroup', 'aria-label': 'Saat' },
        [
          ['fixed', 'Saat belli'],
          ['poll', '🗳️ Arkadaşlarım oylasın'],
        ].map(([mode, label]) =>
          el(
            'label',
            { class: 'segmented__option' },
            el('input', {
              type: 'radio',
              name: 'when-mode',
              value: mode,
              checked: values.mode === mode,
              onchange: () => {
                values.mode = mode;
                renderWhen();
                updatePreview();
                whenBox.querySelector(`input[value="${mode}"]`)?.focus();
              },
            }),
            el('span', { text: label }),
          ),
        ),
      );

    if (values.mode === 'fixed') {
      mount(
        whenBox,
        el('p', { class: 'when__label', text: 'Ne zaman?' }),
        modeSwitch,
        el('label', { class: 'visually-hidden', for: 'startsAt', text: 'Tarih ve saat' }),
        el('input', {
          id: 'startsAt',
          name: 'startsAt',
          type: 'datetime-local',
          required: true,
          value: values.startsAt,
          oninput: bind('startsAt'),
        }),
      );
      return;
    }

    const canAdd = values.timeOptions.length < LIMITS.timeOptionsMax;
    const canRemove = values.timeOptions.length > LIMITS.timeOptionsMin;
    mount(
      whenBox,
      el('p', { class: 'when__label', text: 'Ne zaman?' }),
      modeSwitch,
      el('p', { class: 'field__hint', text: 'Birkaç seçenek ekle; herkes uyduğu saatleri işaretlesin, en çok oyu alanı sen seç.' }),
      el(
        'ol',
        { class: 'option-inputs' },
        values.timeOptions.map((option, index) =>
          el(
            'li',
            {},
            el('label', { class: 'visually-hidden', for: `option-${index}`, text: `${index + 1}. seçenek` }),
            el('input', {
              id: `option-${index}`,
              type: 'datetime-local',
              value: option,
              oninput: (event) => {
                values.timeOptions[index] = event.target.value;
                updatePreview();
              },
            }),
            canRemove &&
              el(
                'button',
                {
                  class: 'icon-button',
                  type: 'button',
                  'aria-label': `${index + 1}. seçeneği kaldır`,
                  onclick: () => {
                    values.timeOptions.splice(index, 1);
                    renderWhen();
                    updatePreview();
                  },
                },
                '✕',
              ),
          ),
        ),
      ),
      canAdd &&
        el(
          'button',
          {
            class: 'button button--ghost button--small',
            type: 'button',
            onclick: () => {
              values.timeOptions.push('');
              renderWhen();
              whenBox.querySelector(`#option-${values.timeOptions.length - 1}`)?.focus();
            },
          },
          '+ Seçenek ekle',
        ),
    );
  }
  renderWhen();

  const submitButton = el('button', { class: 'button button--large', type: 'submit' }, isEditing ? 'Kaydet' : 'Daveti oluştur');

  async function onSubmit(event) {
    event.preventDefault();
    errorBox.textContent = '';
    submitButton.disabled = true;
    submitButton.textContent = isEditing ? 'Kaydediliyor…' : 'Oluşturuluyor…';

    const input = {
      title: values.title,
      ...(values.mode === 'poll'
        ? { timeOptions: values.timeOptions.filter(Boolean) }
        : { startsAt: values.startsAt }),
      location: values.location,
      description: values.description,
      hostName: values.hostName,
      theme: findTheme(values.theme).id,
    };

    try {
      if (isEditing) {
        const { event: saved } = await api.updateEvent(eventId, input);
        local.rememberInvite(saved, 'host');
        showToast('Değişiklikler kaydedildi');
        context.navigate(`/e/${eventId}`, { replace: true });
      } else {
        // The data layer stores the host's key itself.
        const { id } = await api.createEvent(input);
        local.setName(input.hostName.trim());
        local.rememberInvite({ id, ...input, startsAt: previewStartsAt(), pollOpen: values.mode === 'poll' }, 'host');
        context.navigate(`/e/${id}?yeni=1`, { replace: true });
      }
    } catch (error) {
      errorBox.textContent = error.message;
      submitButton.disabled = false;
      submitButton.textContent = isEditing ? 'Kaydet' : 'Daveti oluştur';
    }
  }

  return el(
    'div',
    { class: 'editor' },
    el(
      'div',
      { class: 'editor__head' },
      el('h1', { text: isEditing ? 'Daveti düzenle' : 'Yeni davet' }),
      el('p', { class: 'muted', text: isEditing ? 'Değişiklikler linki açan herkese görünür.' : 'Bir dakikada hazır. Sonra linki gruba atarsın.' }),
    ),
    preview,
    el(
      'form',
      { class: 'editor__form', novalidate: true, onsubmit: onSubmit },
      field({
        id: 'title',
        label: 'Ne yapıyoruz?',
        input: el('input', {
          id: 'title',
          name: 'title',
          required: true,
          maxlength: LIMITS.title,
          placeholder: 'Örn. Cuma film gecesi',
          value: values.title,
          oninput: bind('title'),
        }),
      }),
      themePicker,
      whenBox,
      field({
        id: 'location',
        label: 'Nerede?',
        hint: 'İsteğe bağlı. Kafe adı, adres ya da "Discord".',
        input: el('input', {
          id: 'location',
          name: 'location',
          maxlength: LIMITS.location,
          placeholder: 'Örn. Moda Sahili',
          'aria-describedby': 'location-hint',
          value: values.location,
          oninput: bind('location'),
        }),
      }),
      field({
        id: 'description',
        label: 'Detaylar',
        hint: 'İsteğe bağlı. Ne getirilecek, kaç para, dress code…',
        input: (() => {
          const textarea = el('textarea', {
            id: 'description',
            name: 'description',
            rows: 4,
            maxlength: LIMITS.description,
            'aria-describedby': 'description-hint',
            oninput: bind('description'),
          });
          textarea.value = values.description;
          return textarea;
        })(),
      }),
      field({
        id: 'hostName',
        label: 'Senin adın',
        input: el('input', {
          id: 'hostName',
          name: 'hostName',
          required: true,
          maxlength: LIMITS.name,
          autocomplete: 'given-name',
          placeholder: 'Örn. Ece',
          value: values.hostName,
          oninput: bind('hostName'),
        }),
      }),
      errorBox,
      el(
        'div',
        { class: 'button-row' },
        submitButton,
        el('a', { class: 'button button--ghost', href: isEditing ? `#/e/${eventId}` : '#/' }, 'Vazgeç'),
      ),
    ),
  );
}
