/** A preview of the built-in terrain brush, which has no model in the asset lock. */
export function TerrainThumbnail({ prefab }: { prefab: string }) {
  const colors: Record<string, string> = {
    'scenery-band:grass': '#719557',
    'scenery-band:path': '#bc9b70',
    'scenery-band:water': '#609fc5',
  };
  const color = colors[prefab];
  if (!color) return null;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="scenery-thumbnail">
      <path d="M5 29 32 15 59 29 32 45Z" fill={color} stroke="#49392c" strokeWidth="2" />
      <path d="M5 29v8l27 14 27-14v-8L32 45Z" fill={color} stroke="#49392c" strokeWidth="2" />
    </svg>
  );
}
