import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { watchForNewDeploy } from './app/app-version';
import { applyHashRedirect } from './app/hashRedirect';
import { queryClient } from './app/query';
import { createAppRouter } from './app/router';
import { registerServiceWorker } from './app/sw-register';
import { installTestHook } from './app/testHook';
import { flushQueue, installErrorCapture } from './features/bug-report';
import { installTelemetry } from './features/telemetry/telemetry';
import { initFocus, startGamepadPoller } from './lib/input';
import './tokens.css';
import './glass-tokens.css';
import './app/chrome.css';

applyHashRedirect();

const router = createAppRouter();
installTestHook(router);
registerServiceWorker();
if (import.meta.env.PROD) watchForNewDeploy();
installErrorCapture();
installTelemetry();
void flushQueue();
initFocus();
startGamepadPoller();

const root = document.querySelector('#root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
