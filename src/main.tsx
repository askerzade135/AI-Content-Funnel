import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { I18nProvider } from './i18n';
import { NetworkStatusBanner } from './components/NetworkStatusBanner';
import { installGlobalCrashFallback } from './components/AppErrorBoundary';

installGlobalCrashFallback();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <NetworkStatusBanner />
      <App />
    </I18nProvider>
  </StrictMode>,
);
