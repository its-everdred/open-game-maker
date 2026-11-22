/** Reviewed or detected scene facts. Absence must be observed, not inferred from a missing record. */
export type SceneObservation = {
  id: string;
  region: string;
  presence: 'present' | 'absent' | 'unknown';
  facing?: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  scaleInCharacters?: number;
  density?: number;
  connected?: boolean;
};

type DiscrepancyKind = 'missing' | 'broken-structure' | 'facing' | 'scale' | 'sparse-dressing';
const priority: Record<DiscrepancyKind, number> = {
  missing: 5,
  'broken-structure': 4,
  facing: 3,
  scale: 2,
  'sparse-dressing': 1,
};

function indexObservations(values: readonly SceneObservation[]) {
  const result = new Map<string, SceneObservation>();
  for (const item of values) {
    if (
      typeof item.id !== 'string' ||
      !item.id ||
      typeof item.region !== 'string' ||
      !item.region ||
      result.has(item.id) ||
      !['present', 'absent', 'unknown'].includes(item.presence)
    )
      throw new Error('invalid or duplicate scene observation');
    if (
      item.scaleInCharacters !== undefined &&
      (!Number.isFinite(item.scaleInCharacters) || item.scaleInCharacters <= 0)
    )
      throw new Error('invalid observed scale');
    if (item.density !== undefined && (!Number.isFinite(item.density) || item.density < 0 || item.density > 1))
      throw new Error('invalid observed density');
    if (item.facing !== undefined && !['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].includes(item.facing))
      throw new Error('invalid observed facing');
    if (item.connected !== undefined && typeof item.connected !== 'boolean')
      throw new Error('invalid observed connection');
    result.set(item.id, item);
  }
  return result;
}

/** Compare supplied facts; unknowns remain unobserved and cannot be called missing. */
export function compareSceneObservations(
  expected: readonly SceneObservation[],
  actual: readonly SceneObservation[],
  tolerance: { scaleFraction: number; densityFraction: number },
) {
  if (
    [tolerance.scaleFraction, tolerance.densityFraction].some(
      (value) => !Number.isFinite(value) || value < 0 || value >= 1,
    )
  )
    throw new Error('invalid scene comparison tolerance');
  const expectedById = indexObservations(expected);
  const actualById = indexObservations(actual);
  const discrepancies: { id: string; region: string; kind: DiscrepancyKind; priority: number }[] = [];
  const unobserved: string[] = [];
  for (const target of expectedById.values()) {
    if (target.presence !== 'present') throw new Error('expected scene observations must be present');
    const seen = actualById.get(target.id);
    if (!seen || seen.presence === 'unknown') {
      unobserved.push(`${target.id}.presence`);
      continue;
    }
    if (seen.region !== target.region) throw new Error('scene observation region mismatch');
    const add = (kind: DiscrepancyKind) =>
      discrepancies.push({ id: target.id, region: target.region, kind, priority: priority[kind] });
    if (seen.presence === 'absent') {
      add('missing');
      continue;
    }
    for (const field of ['connected', 'facing', 'scaleInCharacters', 'density'] as const) {
      if (target[field] !== undefined && seen[field] === undefined) unobserved.push(`${target.id}.${field}`);
    }
    if (target.connected === true && seen.connected === false) add('broken-structure');
    if (target.facing !== undefined && seen.facing !== undefined && target.facing !== seen.facing) add('facing');
    if (
      target.scaleInCharacters !== undefined &&
      seen.scaleInCharacters !== undefined &&
      Math.abs(seen.scaleInCharacters / target.scaleInCharacters - 1) > tolerance.scaleFraction
    )
      add('scale');
    if (
      target.density !== undefined &&
      seen.density !== undefined &&
      seen.density < target.density * (1 - tolerance.densityFraction)
    )
      add('sparse-dressing');
  }
  discrepancies.sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { discrepancies, unobserved };
}
