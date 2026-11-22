import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { SessionProvider } from './lib/session.tsx';
import { ToastProvider, ConfirmProvider } from './components/ui.tsx';
import { Api } from './lib/api.ts';

window.addEventListener('error', (e) => Api.log(String(e.message), `${e.filename?.split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => Api.log(String(e.reason?.message ?? e.reason), 'promise'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </SessionProvider>
  </StrictMode>,
);
