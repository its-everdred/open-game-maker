import { flushSync } from 'react-dom';
import { RouterProvider } from 'react-router';

import type { AppRouter } from './router';

function flushRouterUpdate(callback: () => unknown): undefined {
  flushSync(callback);
  return undefined;
}

export function App({ router }: { router: AppRouter }) {
  return <RouterProvider router={router} flushSync={flushRouterUpdate} />;
}
