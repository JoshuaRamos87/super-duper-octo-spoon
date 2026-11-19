import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const COI_RELOAD_FLAG = 'clipshrink_coi_reloaded';

if (typeof window !== 'undefined') {
  if (window.crossOriginIsolated) {
    try {
      sessionStorage.removeItem(COI_RELOAD_FLAG);
    } catch {
      // Ignore storage restrictions
    }
  }

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const base = import.meta.env.BASE_URL || '/';
    const swUrl = base.endsWith('/') ? `${base}sw.js` : `${base}/sw.js`;

    const reloadOnceForCoi = () => {
      if (window.crossOriginIsolated) return;
      try {
        if (sessionStorage.getItem(COI_RELOAD_FLAG)) return;
        sessionStorage.setItem(COI_RELOAD_FLAG, '1');
      } catch {
        return;
      }
      window.location.reload();
    };

    if (!window.crossOriginIsolated) {
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnceForCoi);
    }

    navigator.serviceWorker
      .register(swUrl, { scope: base })
      .then((reg) => {
        if (!window.crossOriginIsolated && reg.active && !navigator.serviceWorker.controller) {
          reloadOnceForCoi();
        }
      })
      .catch(() => {
        // Service worker registration failed (e.g. strict private mode); ST fallback stays active.
      });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
