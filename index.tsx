
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider } from '@clerk/clerk-react';
import { ptBR } from '@clerk/localizations';
import './src/tailwind.css';
import App from './App';

Sentry.init({
  dsn: 'https://c860f11de7bc00e1542d6c0c2bc891dd@o4511502063108096.ingest.us.sentry.io/4511502070185984',
  environment: import.meta.env.MODE,
  sendDefaultPii: false, // LGPD: não envia dados pessoais automaticamente
  tracesSampleRate: 0.2, // captura 20% das transações para performance
  replaysOnErrorSampleRate: 1.0, // replay completo em caso de erro
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
});

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Clerk Publishable Key');
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} localization={ptBR}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
);

// ── Auto-atualização agressiva do PWA/service worker ──────────────────────
// Em webview nativo (Capacitor) o app "retoma" a página em cache e não checa
// por atualização. Aqui forçamos a checagem ao ganhar foco e periodicamente, e
// recarregamos assim que um novo service worker assume o controle.
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker.ready
    .then((registration) => {
      const check = () => registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('focus', check);
      setInterval(check, 60_000);
    })
    .catch(() => {});
}
