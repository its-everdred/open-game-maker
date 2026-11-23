export { gameHeaders } from '@ogm/contracts';

export function healthHeaders(): Readonly<Record<string, string>> {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  };
}
