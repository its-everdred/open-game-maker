export function apiHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'x-ogm-service': 'commit' };
}
