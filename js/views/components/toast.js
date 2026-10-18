// Short confirmation messages ("Link kopyalandı"), announced to screen readers.

const VISIBLE_MS = 2600;
let hideTimer = null;

export function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('toast--visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toast.classList.remove('toast--visible'), VISIBLE_MS);
}
