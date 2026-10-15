import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

// Check for deployments at startup, hourly, on return to the tab and after reconnection.
// The PWA registration helper reloads the page when it observes the updated worker activate.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => { void reg.update().catch(() => { /* Offline: keep the installed app usable. */ }); };
    check(); // Registration alone may reuse a recent update check; explicitly check on every visit.
    setInterval(check, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.addEventListener('online', check);
  },
  onNeedRefresh() { updateSW(true); },
});
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
