// A game's short links on its hosted instance (#591): `/<slug>` opens the game, `/<slug>/play` plays it and
// `/<slug>/review/<n>` opens one of its reviews. A slug sits at the top of the path, so no game may take a name an app
// screen (or the API, or a static folder) already answers to. The web app's router test fails when a screen's first
// segment is missing here, so a new screen cannot be shadowed by a game created before it.
export const RESERVED_GAME_SLUGS: ReadonlySet<string> = new Set([
  'about',
  'admin',
  'all',
  'api',
  'art',
  'assets',
  'auth',
  'connect',
  'g',
  'game',
  'games',
  'help',
  'icons',
  'internal',
  'join',
  'login',
  'logout',
  'new',
  'play',
  'proto',
  'review',
  'settings',
  'signin',
  'signout',
  'signup',
  'town',
]);

export function isReservedGameSlug(slug: string): boolean {
  return RESERVED_GAME_SLUGS.has(slug);
}

export function gamePath(slug: string): string {
  return `/${encodeURIComponent(slug)}`;
}

export function gamePlayPath(slug: string): string {
  return `${gamePath(slug)}/play`;
}

export function reviewPath(slug: string, number: number): string {
  return `${gamePath(slug)}/review/${number}`;
}
