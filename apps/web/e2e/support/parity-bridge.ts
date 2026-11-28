/** The browser build and Playwright game server both default to port 10001. */
export function parityBridgePort(environment: NodeJS.ProcessEnv): string {
  return environment.OGM_WEB_BRIDGE_PORT ?? '10001';
}
