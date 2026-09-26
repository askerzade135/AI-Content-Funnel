import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { I18nProvider } from './i18n';
import { NetworkStatusBanner } from './components/NetworkStatusBanner';
import { installGlobalCrashFallback } from './components/AppErrorBoundary';
import { isPublicLegalPath, PublicLegalPage } from './components/PublicLegalPage';

installGlobalCrashFallback();

const legalPage = isPublicLegalPath(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      {legalPage ? (
        <PublicLegalPage kind={legalPage} />
      ) : (
        <>
          <NetworkStatusBanner />
          <App />
        </>
      )}
    </I18nProvider>
  </StrictMode>,
);
