import type { GameToHost } from '@ogm/contracts/bridge';

type GameFault = Extract<GameToHost, { t: 'fault' }>['payload'];

const MAX_FAULTS = 20;
const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);
// Asset URLs carry signed query strings; the path is enough to find the file.
const withoutQuery = (url: string) => url.split(/[?#]/)[0] ?? url;

function describeRejection(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: `${reason.name}: ${reason.message}`, stack: reason.stack };
  return { message: typeof reason === 'string' ? reason : 'non-error rejection' };
}

function faultFor(event: Event): GameFault | null {
  if (event.type === 'unhandledrejection') {
    return { kind: 'rejection', ...describeRejection((event as PromiseRejectionEvent).reason) };
  }
  if (event.type === 'securitypolicyviolation') {
    const violation = event as SecurityPolicyViolationEvent;
    return { kind: 'csp', message: `${violation.effectiveDirective} blocked ${withoutQuery(violation.blockedURI)}` };
  }
  if (event.type === 'webglcontextlost') return { kind: 'webgl', message: 'WebGL context lost' };
  if (event.type !== 'error') return null;
  // A failed <img>/<script>/<link>/<audio> load reaches window only in the capture phase, as a plain Event.
  const target = event.target as (Element & { src?: string; href?: string }) | null;
  if (target && target !== (globalThis as unknown) && typeof target.tagName === 'string') {
    return {
      kind: 'asset',
      message: `${target.tagName.toLowerCase()} ${withoutQuery(target.src || target.href || '')}`,
    };
  }
  const error = event as ErrorEvent;
  const cause = error.error instanceof Error ? error.error : undefined;
  return {
    kind: 'error',
    message: cause ? `${cause.name}: ${cause.message}` : error.message || 'script error',
    stack: cause?.stack ?? (error.filename ? `at ${error.filename}:${error.lineno}:${error.colno}` : undefined),
  };
}

/** Relays the frame's uncaught failures to the host without stopping the game; each distinct one once. */
export function installFaultRelay(target: Window, report: (fault: GameFault) => void): () => void {
  const seen = new Set<string>();
  const listener = (event: Event) => {
    if (seen.size >= MAX_FAULTS) return;
    const fault = faultFor(event);
    if (!fault) return;
    const key = `${fault.kind}|${fault.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    try {
      report({
        ...fault,
        message: clip(fault.message, 500),
        ...(fault.stack ? { stack: clip(fault.stack, 4000) } : {}),
      });
    } catch {
      // Reporting must never become the failure.
    }
  };
  const types = ['error', 'unhandledrejection', 'securitypolicyviolation', 'webglcontextlost'] as const;
  for (const type of types) target.addEventListener(type, listener, true);
  return () => {
    for (const type of types) target.removeEventListener(type, listener, true);
  };
}
