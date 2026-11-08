import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\s+/g, ' ');
}

/* #650, Kevin 2026-11-08: every new game maps its loops and screens before building, so screen order, modes and
   round-end options are decided once with the creator instead of guessed per ticket. */
describe('game flow diagram step', () => {
  it('makes the planning skill draw and approve the flow diagram before any screen ticket', () => {
    const plan = read('./SKILL.md');
    expect(plan).toContain('**Flow diagram before any screen ticket.**');
    expect(plan).toContain('`references/flow-diagram.md`');
    expect(plan).toContain('`references/flow-template.md`');
    expect(plan).toContain('Screen and gameplay tickets cite their node');
    expect(plan).toContain('its flow node or loop');
  });

  it('keeps the rules on the levels, per-screen images, deck review, commit path and ticket and QA use', () => {
    const rules = read('./references/flow-diagram.md');
    for (const level of ['**Core loop**', '**Session loop**', '**Meta loop**', '**Navigation**'])
      expect(rules).toContain(level);
    expect(rules).toContain('screens/<id>.target.png');
    expect(rules).toContain('screens/<id>.live.png');
    expect(rules).toContain('`decision.requested` Command');
    expect(rules).toContain('`media[]`');
    expect(rules).toContain('Run it from a host checkout');
    expect(rules).toContain('review deck');
    expect(rules).toContain('games/<name>/design/flow/flow.md');
    expect(rules).toContain('scripts/render-flow.ts');
    expect(rules).toContain('`flow: round_end`');
    expect(rules).toContain('together the journeys cover every edge');
  });

  it('points the design conversation and QA journeys at the diagram', () => {
    expect(read('../gm-new-game-design/SKILL.md')).toContain('../gm-new-game-plan/references/flow-diagram.md');
    expect(read('../gm-qa/SKILL.md')).toContain("follows a path of edges in the game's flow diagram");
  });
});
