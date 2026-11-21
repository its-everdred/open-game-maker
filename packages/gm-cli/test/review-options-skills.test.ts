import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}/${path}`, 'utf8').replace(/\s+/g, ' ');

/* Kevin, #885: a multi-screen mock round bundled title, mode and character screens into each of A–E; he picks per screen. */
it('asks one option set per screen in a multi-screen mock round', () => {
  expect(read('.claude/skills/gm-design-loop/SKILL.md')).toContain('One choice per screen');
  const prototype = read('skills/gm-prototype/SKILL.md');
  expect(prototype).toContain('gives each screen its own option set');
  expect(prototype).toContain('one question per screen');
  expect(prototype).not.toContain('Post one round and one question,');
});

it('delivers three in-engine prototype variations while the recommendation proceeds', () => {
  const prototype = read('skills/gm-prototype/SKILL.md');
  expect(prototype).toContain('exactly three in-engine variations (A/B/C)');
  expect(prototype).toContain('beside the approved mock');
  expect(prototype).toContain('web-design skills mapped to the visual lane (Impeccable)');
  expect(prototype).toContain('keep building and ship your recommendation as provisional');
  const ladder = read('skills/gm-new-game-plan/references/prototype-ladder.md');
  expect(ladder).toContain('Every `phase:prototype` round delivers three in-engine variations (A/B/C)');
});

/* The Blobs trailer came out High at level 6.2 and never played on the creator's phone. */
it('states the phone-safe H.264 profile and level for every MP4 sent to the creator', () => {
  expect(read('.claude/skills/gm-verify/SKILL.md')).toContain('-profile:v main -level:v 4.1 -r <fps>');
});
