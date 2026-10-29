import '@fontsource/bebas-neue/400.css';
import '@fontsource-variable/geist';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './index.css';

if ('__TAURI_INTERNALS__' in window) {
  // Desktop: forward uncaught errors to the app log.
  const send = (level: string, message: string) =>
    void import('@tauri-apps/api/core').then((c) =>
      c.invoke('client_log', { level, message }).catch(() => undefined),
    );
  window.addEventListener('error', (e) => send('error', `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) =>
    send('error', `unhandled: ${String(e.reason?.stack ?? e.reason)}`),
  );
  send(
    'info',
    `started webcodecs=${'VideoEncoder' in window} offscreen=${'OffscreenCanvas' in window} mediarecorder=${'MediaRecorder' in window} ${navigator.userAgent}`,
  );
  setTimeout(
    () => send('info', `rendered: ${document.body.innerText.slice(0, 120).replace(/\s+/g, ' ')}`),
    9000,
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline caching is for the web build; the desktop app serves its files locally.
if ('serviceWorker' in navigator && import.meta.env.PROD && !('__TAURI_INTERNALS__' in window)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is best-effort */
    });
  });
}
