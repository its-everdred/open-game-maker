/** The game frame's launch navigation, which catch-all API mocks pass on to the bridge fixture through the proxy. */
export function isGameLaunch(url: string): boolean {
  return /^\/api\/v1\/games\/[^/]+\/launch\/[^/]+$/u.test(new URL(url).pathname);
}
