import { initRealtime, realtimeOnEnter, realtimeOnLeave } from './realtime';

// ── Boot ─────────────────────────────────────────────────────────────────────
initRealtime();
realtimeOnEnter();

// Release mic if user navigates away from the page entirely
window.addEventListener('beforeunload', () => realtimeOnLeave());
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') realtimeOnLeave();
});

// PWA: register the offline service worker in production builds only (avoids
// interfering with the Vite dev server's hot-reload).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* */ });
  });
}
