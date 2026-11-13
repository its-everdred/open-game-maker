type Row = { at: string; patches: string; inverse: string };
type Patch = { path?: unknown; value?: unknown };

function patches(value: string): Patch[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is Patch => !!item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

/** Find the latest edit to scenery globals or a scenery entity, including undo and deletion. */
export function latestSceneryEdit(rows: Row[]): string | undefined {
  const parsed = rows.map((row) => ({ at: row.at, patches: patches(row.patches), inverse: patches(row.inverse) }));
  const sceneryIds = new Set<string>();
  for (const row of parsed) {
    for (const patch of [...row.patches, ...row.inverse]) {
      if (!Array.isArray(patch.path) || patch.path[0] !== 'entities' || typeof patch.path[1] !== 'string') continue;
      const value = patch.value;
      if (
        value &&
        typeof value === 'object' &&
        'prefab' in value &&
        typeof value.prefab === 'string' &&
        value.prefab.startsWith('scenery:')
      ) {
        sceneryIds.add(patch.path[1]);
      }
    }
  }
  return parsed.find((row) =>
    row.patches.some((patch) => {
      if (!Array.isArray(patch.path)) return false;
      return (
        (patch.path[0] === 'globals' && typeof patch.path[1] === 'string' && patch.path[1].startsWith('scenery.')) ||
        (patch.path[0] === 'entities' && typeof patch.path[1] === 'string' && sceneryIds.has(patch.path[1]))
      );
    }),
  )?.at;
}
