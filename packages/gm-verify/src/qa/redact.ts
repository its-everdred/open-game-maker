/** Remove bearer capabilities from diagnostics while preserving useful paths. */
export function redactCapabilities<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value).replace(/(\/(?:d\/[^/\s"?]+\/[^/\s"?]+|p\/[^/\s"?]+)\/)[^/\s"?\\]+/gu, '$1<redacted>'),
  ) as T;
}
