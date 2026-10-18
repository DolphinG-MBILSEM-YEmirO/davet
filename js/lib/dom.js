// Small DOM helpers so views can build markup without innerHTML string
// concatenation of user data.

/**
 * Create an element.
 * @param {string} tag
 * @param {Object} [attrs] Attributes; `class`, `text`, `html` and `on*` handlers are special.
 * @param {...(Node|string|null|false)} children
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;

    if (name === 'class') {
      node.className = value;
    } else if (name === 'text') {
      node.textContent = value;
    } else if (name.startsWith('on') && typeof value === 'function') {
      node.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(name, '');
    } else {
      node.setAttribute(name, String(value));
    }
  }

  append(node, children);
  return node;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      append(parent, child);
    } else {
      parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
}

/** Replace all children of a container. */
export function mount(container, ...children) {
  container.replaceChildren();
  append(container, children);
}

/**
 * Replace children but keep keyboard focus on the element with the same id,
 * so re-rendering after an answer doesn't send the user back to the top.
 */
export function remount(container, ...children) {
  const activeId = container.contains(document.activeElement) ? document.activeElement.id : null;
  mount(container, ...children);
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
}


/** Trigger a browser download for generated text content. */
export function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
