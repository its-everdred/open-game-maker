import type { BrowserContext } from 'playwright';

const BINDING = '__gmCspViolation';

/** One line per blocked load or script, in the words a player's browser would log. */
function listen({ name, skipOrigin }: { name: string; skipOrigin: string | null }): void {
  if (skipOrigin !== null && location.origin === skipOrigin) return;
  document.addEventListener(
    'securitypolicyviolation',
    (event) => {
      const report = (window as unknown as Record<string, (text: string) => Promise<void>>)[name];
      const where = event.sourceFile ? ` at ${event.sourceFile}:${event.lineNumber}` : '';
      void report?.(`CSP violation: ${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}${where}`);
    },
    true,
  );
}

/**
 * Calls `onViolation` for every `securitypolicyviolation` in the context's pages and frames, from before their first
 * script. Frames on `skipOrigin` (the app shell around a game) are not watched.
 */
export async function watchCspViolations(
  context: BrowserContext,
  onViolation: (text: string) => void,
  skipOrigin?: string,
): Promise<void> {
  await context.exposeBinding(BINDING, (_source, text: unknown) => onViolation(String(text).slice(0, 200)));
  await context.addInitScript(listen, { name: BINDING, skipOrigin: skipOrigin ?? null });
}
