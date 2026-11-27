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

/* #660, Kevin 2026-11-08: one five-stage ladder for every game, each stage closed by a creator review, replacing the
   separate gameplay rungs and visuals, characters and audio tracks. */
describe('five-stage prototype ladder', () => {
  const STAGES = ['Concepts', 'Dioramas', 'Rendered gameplay clips', 'Video to real gameplay', 'Gameplay iterations'];

  it('lists the five stages in order in the ladder reference, each with its review Command and roles', () => {
    const ladder = read('./references/prototype-ladder.md');
    const at = STAGES.map((stage) => ladder.indexOf(`**${stage}**`));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const review of [
      'Pick or reject per concept',
      '"Keep this diorama, or change one of these?"',
      'Pick per clip (phone-ready MP4)',
      'Play-then-vote cards beside the approved clip',
      'Play-then-vote per variant, one feature at a time',
    ])
      expect(ladder).toContain(review);
    expect(ladder).toContain('A rejection loops back within the same stage.');
    expect(ladder).toContain('never against the stage 1 concept');
    expect(ladder).not.toMatch(/\b(V[1-5]|C[1-5]|A[1-4]|P[1-9])\b/);
  });

  it('points the planning skill, design skill and spec template at the five stages', () => {
    const plan = read('./SKILL.md');
    expect(plan).toContain('`references/build-order-template.md`');
    expect(plan).toContain('`references/examples/blobs-ladder.md`');
    expect(plan).toContain('`scripts/check-ladder.ts`');
    expect(plan).toContain('`phase:mock` (`model:low`)');
    const stages = 'concepts, dioramas, rendered gameplay clips, real gameplay, iterations';
    expect(read('../gm-new-game-design/SKILL.md')).toContain(stages);
    expect(read('../gm-new-game-design/references/spec-template.md')).toContain(stages);
  });
});

/* #656, Kevin 2026-11-08: roles assign the mandatory skills aiur inlines per ticket, so the planner stamps a game and a
   role on every ticket and the plan check refuses one without. */
describe('ticket roles', () => {
  it('makes the planner stamp game and role labels from roles.md and run the plan check before queueing', () => {
    const plan = read('./SKILL.md');
    expect(plan).toContain('**Roles on every ticket.**');
    expect(plan).toContain('`../gm-core/references/roles.md`');
    expect(plan).toContain('`gm plan check --tickets <file> --game <slug>`');
    expect(plan).toContain('`game:<slug>` and `role:*` labels');
    expect(read('../gm-core/references/roles.md')).toContain('`game:<slug>` maps to `gm-core` and the set skill');
  });

  it('assigns creative and clone lanes at ticket filing', () => {
    const plan = read('./SKILL.md');
    expect(plan).toContain('### Label tickets when filing');
    expect(plan).toContain('`lane:creative phase:mock`');
    expect(plan).toContain('`lane:clone`');
    expect(plan).toContain('`design:ogm-glass`');
    expect(plan).toContain('`--ogm-ui`');
    expect(plan).toContain('approved design');
  });
});

/* Kevin 2026-11-20: reviewing is the core loop; agents think of the decisions so the creator doesn't have to. A playable
   Dusk Helm build was published and never shown to him, and tickets settled enemies, loot and inventory silently. */
describe('decision inventory and prototype review', () => {
  const REF = '../gm-core/references/decision-inventory.md';

  it('keeps one contract for the inventory: path, fields, statuses, product-only, real pack lineups', () => {
    const rules = read(REF);
    expect(rules).toContain('`docs/<slug>/decisions.json`');
    for (const field of [
      'id',
      'area',
      'question',
      'why',
      'options[]',
      'recommendation',
      'sources[]',
      'ticket',
      'status',
    ])
      expect(rules).toContain(`| \`${field}\` |`);
    for (const status of ['open', 'asked', 'answered', 'defaulted']) expect(rules).toContain(`\`${status}\``);
    expect(rules).toContain('**Product only.**');
    expect(rules).toContain('a lineup of those real assets');
  });

  it('makes planning write the inventory before queueing and stamp its ids on every ticket', () => {
    const plan = read('./SKILL.md');
    expect(plan).toContain(
      '**Decision inventory (required).** The scope job has already committed an initial inventory',
    );
    expect(plan).toContain('Before queueing any ticket, merge into');
    expect(plan).toContain('gm decisions answer <id> <label>');
    expect(plan).toContain('Run `gm plan premises` with the current issue list and decision history');
    expect(plan).toContain('a `## Creator decisions` section listing the inventory ids');
    expect(plan).toContain(`\`${REF}\``);
    expect(read('../gm-scope-options/SKILL.md')).toContain("## List the feature's decisions");
    expect(read('../gm-new-game-design/SKILL.md')).toContain(REF);
  });

  it('raises the first media-backed review batch in the scope job before planning and keeps player words private', () => {
    const design = read('../gm-new-game-design/SKILL.md');
    expect(design).toContain('before finishing the scope ticket');
    expect(design).toContain('at least 15 distinct player-facing decisions');
    expect(design).toContain('at least five areas');
    expect(design).toContain('Raise five to eight open, media-backed decisions');
    expect(design).toContain('Keep raw player words and transcripts in private');
    expect(design).toContain('Do not ask about engine, libraries, packages, implementation');
  });

  it('makes every worker raise open decisions first, build the recommendation and never decide silently', () => {
    const core = read('../gm-core/SKILL.md');
    expect(core).toContain('raise each `open` one');
    expect(core).toContain('never settle one silently');
    expect(core).toContain('`references/decision-inventory.md`');
    const prototype = read('../gm-prototype/SKILL.md');
    expect(prototype).toContain("raise the ticket's `open` inventory decisions");
    expect(prototype).toContain('never settle an inventory decision silently');
  });

  it('counts a playable build as delivered only with its prototype review: limitations and what to weigh in on', () => {
    const rules = read(REF);
    for (const part of ['Play:', '**Works now:**', '**Known limitations:**', '**Weigh in on:**'])
      expect(rules).toContain(part);
    expect(rules).toContain('The build is not delivered until its review is raised.');
    expect(read('../gm-verify/SKILL.md')).toContain('is not delivered until its prototype review is raised');
    expect(read('../gm-qa/SKILL.md')).toContain("the build's prototype review must be raised");
    expect(read('./SKILL.md')).toContain('reaches them as a prototype review');
  });
});
