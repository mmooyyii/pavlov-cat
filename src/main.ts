import { initRealtime, realtimeOnEnter, realtimeOnLeave } from './realtime';

// ── Boot ─────────────────────────────────────────────────────────────────────
initRealtime();
realtimeOnEnter();

// Release mic if user navigates away from the page entirely
window.addEventListener('beforeunload', () => realtimeOnLeave());
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') realtimeOnLeave();
});
