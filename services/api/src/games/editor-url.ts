/*
 * The in-app link to one build: the game's editor page on the app's own origin, so a tap on a phone's home-screen app
 * stays in the app. Never the games origin, which opens the browser. A scenario starts the build at that moment.
 */
export function editorBuildUrl(appOrigin: string, gameId: string, buildId: string, scenario?: string): string {
  const url = new URL(`/g/${encodeURIComponent(gameId)}`, appOrigin);
  url.searchParams.set('mode', 'edit');
  url.searchParams.set('build', buildId);
  if (scenario) url.searchParams.set('scenario', scenario);
  return url.toString();
}

/* One playable slice: only that build, started in that scenario, which a review card embeds (#1281). */
export function sliceUrl(appOrigin: string, gameId: string, buildId: string, scenario: string): string {
  const url = new URL(`/g/${encodeURIComponent(gameId)}/play`, appOrigin);
  url.searchParams.set('build', buildId);
  url.searchParams.set('scenario', scenario);
  return url.toString();
}
