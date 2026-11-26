/** Produce only changed uploads and remove stale published files to stay below the cap. */
export function filesDelta(
  current: Record<string, string>,
  published: Record<string, string>,
  cap = 512,
): Record<string, string | null> {
  const uploads = Object.keys(current)
    .filter((path) => current[path] !== published[path])
    .sort();
  const stale = Object.keys(published)
    .filter((path) => /^m\/[A-Za-z0-9._-]+$/.test(path) && !(path in current))
    .sort();
  const needed = Math.max(
    0,
    Object.keys(published).length + uploads.filter((path) => !(path in published)).length - cap,
  );
  if (needed > stale.length) throw new Error('Active media exceed the artifact file limit');
  return Object.fromEntries([
    ...stale.slice(0, needed).map((path) => [path, null] as const),
    ...uploads.map((path) => [path, path] as const),
  ]);
}
