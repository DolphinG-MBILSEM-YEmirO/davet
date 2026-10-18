// Loads the Nostr signing functions (nostr-tools, pinned version) on demand.
// Two CDNs are tried so one outage doesn't break the site. Tests can provide
// the module directly through globalThis.__davetNostr.

const SOURCES = [
  'https://cdn.jsdelivr.net/npm/nostr-tools@2.25.2/+esm',
  'https://esm.sh/nostr-tools@2.25.2/pure',
];

let modulePromise = null;

/** @returns {Promise<{ generateSecretKey: Function, getPublicKey: Function, finalizeEvent: Function, verifyEvent: Function }>} */
export function loadNostr() {
  if (globalThis.__davetNostr) return Promise.resolve(globalThis.__davetNostr);

  modulePromise ??= (async () => {
    for (const url of SOURCES) {
      try {
        return await import(url);
      } catch {
        // Try the next source.
      }
    }
    modulePromise = null;
    throw new Error('Gerekli dosyalar yüklenemedi. İnternetini kontrol edip sayfayı yenile.');
  })();
  return modulePromise;
}
