// Safe wrapper around localStorage. Storage can be unavailable (private
// windows, blocked site data), so every access is guarded and falls back
// to an in-memory value.

const memoryFallback = new Map();
const KEY_PREFIX = 'davet:';

export function loadJSON(key, defaultValue) {
  const fullKey = KEY_PREFIX + key;
  try {
    const raw = window.localStorage.getItem(fullKey);
    return raw === null ? defaultValue : JSON.parse(raw);
  } catch {
    return memoryFallback.has(fullKey) ? memoryFallback.get(fullKey) : defaultValue;
  }
}

export function saveJSON(key, value) {
  const fullKey = KEY_PREFIX + key;
  memoryFallback.set(fullKey, value);
  try {
    window.localStorage.setItem(fullKey, JSON.stringify(value));
  } catch {
    // Storage unavailable: the in-memory fallback keeps the session working.
  }
}

export function removeKey(key) {
  const fullKey = KEY_PREFIX + key;
  memoryFallback.delete(fullKey);
  try {
    window.localStorage.removeItem(fullKey);
  } catch {
    // Nothing to do.
  }
}
