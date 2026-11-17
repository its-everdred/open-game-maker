/** The pure half of `gm qa playtest`: the seeded bot's moves and the verdict, kept out of the browser runner. */

/** The four touch sizes every playtest covers: phone and tablet, portrait and landscape. */
export const PLAYTEST_SIZES = [
  [390, 844],
  [844, 390],
  [820, 1180],
  [1180, 820],
] as const;

export const PLAYTEST_RESULT = 'playtest.json';

/** Actions a random player must not press mid-run: they leave the match instead of playing it. */
const LEAVING = /^(back|confirm|pause|menu|quit|exit|cancel)\b/i;

export type BotKey = { key: string; action: string; drop: boolean };

/** The keys a player may press during play, from the manifest's `controlBindings`. */
export function botKeys(bindings: Record<string, string> | undefined): BotKey[] {
  return Object.entries(bindings ?? {})
    .filter(([, action]) => !LEAVING.test(action))
    .map(([key, action]) => ({ key, action, drop: /drop/i.test(action) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** mulberry32: the same seed always gives the same run, so a failure replays. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BotMove = { kind: 'key'; key: string } | { kind: 'tap'; x: number; y: number };

/**
 * `count` moves: random legal keys with every fourth a drop, so pieces actually land and stack. A game with no key
 * bindings gets taps at random points of its board (fractions of the board rect).
 */
export function botMoves(keys: BotKey[], seed: number, count: number): BotMove[] {
  const random = seededRandom(seed);
  const drops = keys.filter((key) => key.drop);
  const moves: BotMove[] = [];
  for (let index = 0; index < count; index++) {
    if (!keys.length) {
      moves.push({ kind: 'tap', x: random(), y: random() });
      continue;
    }
    const pool = drops.length && index % 4 === 3 ? drops : keys;
    moves.push({ kind: 'key', key: pool[Math.floor(random() * pool.length)]!.key });
  }
  return moves;
}

export type PlaytestRun = {
  mode: string;
  viewport: string;
  /** Each a reason the run fails, first seen first. */
  failures: string[];
  /** What the run could not check, reported but not failed. */
  unchecked: string[];
  still?: string;
  clip?: string;
};

export type PlaytestSample = {
  boards: number;
  selectable: string[];
  callout: boolean;
  invariants: { name: string; ok: boolean; detail?: string }[] | null | 'absent';
  /** The play-area inspector's error: a HUD element over the board, or the board clipped. */
  playArea?: string;
};

/** Turns one in-play sample into failure and unchecked lines; a game without a board skips the board checks. */
export function judgeSample(
  sample: PlaytestSample,
  options: { board: boolean } = { board: true },
): { failures: string[]; unchecked: string[] } {
  const failures: string[] = [];
  const unchecked: string[] = [];
  if (!options.board) unchecked.push('board: the game has no play area (playArea: false)');
  else if (sample.boards !== 1)
    failures.push(sample.boards === 0 ? 'no board on screen' : `${sample.boards} boards on screen, expected one`);
  if (options.board && sample.playArea) failures.push(`board: ${sample.playArea}`);
  if (sample.selectable.length)
    failures.push(`long press selects text: ${sample.selectable.map((text) => JSON.stringify(text)).join(', ')}`);
  if (!sample.callout) failures.push('no -webkit-touch-callout:none on the page');
  if (sample.invariants === 'absent') unchecked.push('game state: the game build has no gm.qa (SDK older than #866)');
  else if (sample.invariants === null) unchecked.push('game state: the game implements no qa.invariants()');
  else
    for (const item of sample.invariants)
      if (!item.ok) failures.push(`game state: ${item.name}${item.detail ? ` (${item.detail})` : ''}`);
  return { failures, unchecked };
}

/** Adds lines a run has not reported yet, so a defect seen every second is one line, not sixty. */
export function addOnce(lines: string[], next: string[]): void {
  for (const line of next) if (!lines.includes(line)) lines.push(line);
}
