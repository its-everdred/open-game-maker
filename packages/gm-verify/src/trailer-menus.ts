import type { Frame, Page } from 'playwright';

/** Games mark menu, pause and countdown screens with this attribute; a manifest can name more markers and routes. */
export const MENU_MARKER = '[data-gm-menu]';

export type TrailerMenus = { selectors: string[]; routes: string[] };

/** The marker of the menu showing in the game, or null while the game is in play. */
export async function visibleMenu(game: Page | Frame, menus: TrailerMenus): Promise<string | null> {
  return game.evaluate(
    ({ selectors, routes }) => {
      for (const route of routes) if (location.pathname === route || location.hash === route) return route;
      for (const selector of selectors)
        for (const element of document.querySelectorAll(selector))
          if (
            element.checkVisibility
              ? element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
              : element.getClientRects().length > 0
          )
            return selector;
      return null;
    },
    { selectors: [MENU_MARKER, ...menus.selectors], routes: menus.routes },
  );
}
