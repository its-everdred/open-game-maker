/*
 * The in-app link to one build: the game's editor page on the app's own origin, so a tap on a phone's home-screen app
 * stays in the app. Never the games origin, which opens the browser.
 */
export function editorBuildUrl(appOrigin: string, gameId: string, buildId: string): string {
  const url = new URL(`/g/${encodeURIComponent(gameId)}`, appOrigin);
  url.searchParams.set('mode', 'edit');
  url.searchParams.set('build', buildId);
  return url.toString();
}
