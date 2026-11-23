import { SCENARIO_NAME, type GameModule, type SaveData } from '@ogm/contracts/game';

/** The scenario a boot starts in: its name, its seed and the state the game mounts with. */
export type ScenarioBoot<S> = { name: string; seed: number; save: SaveData<S> };

/** The seed a scenario runs with when the link names none, so the same link always plays the same slice. */
export function scenarioSeed(name: string): number {
  let hash = 0x811c9dc5;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return hash >>> 0;
}

/**
 * The declared scenario `?scenario=` names, or undefined. A name the game does not declare is left to the game, which
 * may still read its own query (games written before `GameModule.scenarios`).
 */
export function startScenario<D, S>(module: GameModule<D, S>, search: string): ScenarioBoot<S> | undefined {
  const query = new URLSearchParams(search);
  const name = query.get('scenario') ?? '';
  const declared = module.scenarios;
  if (!declared || !SCENARIO_NAME.test(name) || !Object.hasOwn(declared, name)) return undefined;
  const raw = query.get('seed') ?? '';
  const seed = /^\d{1,10}$/u.test(raw) && Number(raw) <= 0xffffffff ? Number(raw) : scenarioSeed(name);
  return { name, seed, save: declared[name]!({ name, seed }) };
}
