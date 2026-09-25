import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { I18nProvider } from './i18n';
import { NetworkStatusBanner } from './components/NetworkStatusBanner';
import { AppErrorBoundary } from './components/AppErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <NetworkStatusBanner />
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
