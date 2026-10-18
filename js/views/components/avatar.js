// Round initials avatar with a color derived from the name.

import { el } from '../../lib/dom.js';
import { avatarHue, initials } from '../../lib/format.js';

export function renderAvatar(name, { size = 'medium' } = {}) {
  return el('span', {
    class: `avatar avatar--${size}`,
    style: `--avatar-hue: ${avatarHue(name)}`,
    'aria-hidden': 'true',
    text: initials(name),
  });
}
