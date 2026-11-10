import type { ReactNode } from 'react';
import { createBrowserRouter, matchPath, Navigate, useLocation, type RouteObject } from 'react-router';

import { BuildChatDock } from '../features/build-chat/BuildChatDock';
import { useSession } from '../lib/api/session';
import { Toasts, useNotificationFeed } from '../lib/notify';
import { ScreenErrorBoundary } from './ScreenErrorBoundary';
import { GameMenuProvider } from './GameMenu';
import type { ScreenRoute } from './screen';
import { StudioBackdrop, StudioLogo } from './StudioChrome';
import { StudioMenu } from './StudioMenu';

type ScreenModule = { route?: ScreenRoute };

const modules = import.meta.glob<ScreenModule>('../routes/*/route.tsx', {
  eager: true,
});

export const screenRouteObjects = collectScreenRoutes(modules);
export type AppRouter = ReturnType<typeof createBrowserRouter>;

export function createAppRouter() {
  return createBrowserRouter(screenRouteObjects);
}

export function collectScreenRoutes(routeModules: Record<string, ScreenModule>): RouteObject[] {
  return Object.entries(routeModules)
    .map(([filename, module]) => {
      if (!module.route) {
        throw new Error(`${filename} must export a route`);
      }

      return module.route;
    })
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((screen) => {
      let element = screen.element;

      if (screen.chrome === 'app') {
        element = (
          <AppChrome>
            <ScreenErrorBoundary>{element}</ScreenErrorBoundary>
          </AppChrome>
        );
      }
      if (screen.auth === 'required') {
        element = <RequireSession>{element}</RequireSession>;
      }

      return {
        path: screen.path,
        element,
        children: screen.children?.map((child) => ({
          path: child.path,
          element: child.element,
        })),
      };
    });
}

function RequireSession({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) return null;
  if (session === null) {
    const next = encodeURIComponent(sessionReturnPath(location.pathname, location.search));
    return <Navigate replace to={`/signin?next=${next}`} />;
  }

  return children;
}

function sessionReturnPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('test');
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function AppChrome({ children }: { children: ReactNode }) {
  useNotificationFeed();
  const location = useLocation();
  const gamePlay =
    matchPath('/g/:gameId', location.pathname) !== null && new URLSearchParams(location.search).get('mode') !== 'edit';
  return (
    <GameMenuProvider>
      <div className={`app-chrome${gamePlay ? ' is-game-playing' : ''}`}>
        <StudioBackdrop />
        <StudioLogo />
        <StudioMenu />
        <main>{children}</main>
        <Toasts />
        <div id="chat-dock-slot">
          <BuildChatDock />
        </div>
      </div>
    </GameMenuProvider>
  );
}
