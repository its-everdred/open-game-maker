/** Blobs' shipped sandbox scenario starts deterministic real gameplay for capture. */
export function parityEditorRoute(route: string, gameId: string | undefined): string {
  if (gameId !== 'blobs') return route;
  const url = new URL(route, 'http://parity.test');
  url.searchParams.set('scenario', 'sandbox');
  return `${url.pathname}${url.search}${url.hash}`;
}
