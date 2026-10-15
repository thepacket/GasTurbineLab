import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

// Update the service worker as soon as a new build is published: check hourly and on every return to the tab,
// and reload when the new worker has taken control so existing installs do not keep showing an old version.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    setInterval(() => reg.update(), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
  },
  onNeedRefresh() { updateSW(true); },
});
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
