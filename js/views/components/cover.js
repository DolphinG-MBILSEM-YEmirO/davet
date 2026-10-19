// Invite cover: a theme gradient with a big emoji, the title and a date chip.
// Used on the invite page, in the editor's live preview and in lists.

import { el } from '../../lib/dom.js';
import { dateChip } from '../../lib/format.js';
import { findTheme } from '../../shared/rules.js';

export function coverStyle(themeId) {
  const [from, to] = findTheme(themeId).colors;
  return `--cover-from: ${from}; --cover-to: ${to}`;
}

/**
 * @param {{ title?: string, theme?: string, startsAt?: string, emoji?: string }} event
 *   `emoji` (plans from Sharloop) replaces the theme's emoji.
 * @param {{ size?: 'large' | 'small' | 'tiny', titleTag?: string }} [options]
 *   Tiny covers (list thumbnails) show only the emoji.
 */
export function renderCover(event, { size = 'large', titleTag = 'h1' } = {}) {
  const theme = findTheme(event.theme);
  const isTiny = size === 'tiny';
  const chip = event.startsAt && !isTiny ? dateChip(event.startsAt) : null;

  return el(
    'div',
    { class: `cover cover--${size}`, style: coverStyle(theme.id) },
    el('span', { class: 'cover__emoji', 'aria-hidden': 'true', text: event.emoji || theme.emoji }),
    chip &&
      el(
        'span',
        { class: 'cover__chip', 'aria-hidden': 'true' },
        el('span', { class: 'cover__chip-month', text: chip.month }),
        el('span', { class: 'cover__chip-day', text: chip.day }),
      ),
    !isTiny && el(titleTag, { class: 'cover__title', text: event.title || 'Davetinin adı' }),
  );
}
