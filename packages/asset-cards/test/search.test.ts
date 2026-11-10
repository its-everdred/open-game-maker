import { beforeAll, describe, expect, it } from 'vitest';

import { buildIndex, formatRow, info, search, statusAllowed, type CardIndex } from '../src/index.js';
import { FIXTURE } from './helpers.js';

const ORC = 't1:kenney-mini-dungeon/character-orc@2.0';
const TORCH = 't1:synty-polygon-goblin-war-camp/buildings/sm-bld-prop-torch-01@v3';
const LOOP = 't1:kenney-music-loops/loops/infinite-descent@1.1';
const DRAFT_LOOP = 't1:kenney-music-loops/loops/night-patrol@1.1';
const MAP = 't1:profantasy-cartographers-annual/example-dungeon-01@illustrative';
const TILE = 't1:kenney-tiny-dungeon/tiles/tile-0097@1.0';
const MUSIC = 't1:kenney-music-loops@1.1';
const QUARANTINED = 't1:drive-2026-10-26-dungeon-sfx/door-creak@1';

let index: CardIndex;
const ids = (q: Parameters<typeof search>[1]) => search(index, q).map((card) => card.id);

beforeAll(async () => {
  index = await buildIndex(FIXTURE);
});

describe('search', () => {
  it('ranks the Mini Dungeon orc first for "orc" and prints the contract row', () => {
    const hits = search(index, { words: ['orc'] });
    expect(hits[0].id).toBe(ORC);
    expect(formatRow(hits[0])).toBe(`${ORC}  model/character  reviewed  chunky-low-poly  Orc`);
  });

  it('includes AI-generated assets by default, marks rows, and can exclude them', () => {
    const base = index.cards.find((card) => card.id === ORC);
    if (!base) throw new Error('fixture model missing');
    const generated = {
      ...base,
      generation: { method: 'ai' as const, tool: 'test generator' },
    };
    const only = { ...index, cards: [generated] };
    expect(search(only, { words: ['orc'] }).map((card) => card.id)).toEqual([ORC]);
    expect(formatRow(generated)).toContain('[AI-generated: test generator]');
    expect(
      formatRow({ ...generated, title: 'spoof\nrow', generation: { method: 'ai', tool: 'tool\u001b[2J\u200e' } }),
    ).toContain('spoof?row  [AI-generated: tool?[2J?]');
    expect(search(only, { words: ['orc'], excludeAiGenerated: true })).toEqual([]);
  });

  it('defaults to in-game use: assets whose resolved rights lack it never show', () => {
    expect(ids({ words: [] })).not.toContain('t1:kenney-particle-pack/flame-01@1.1');
    expect(ids({ words: [], use: 'vision-input' })).toContain('t1:sidetrax-pack-60-battle/war-drums@v1');
    expect(ids({ words: [] })).not.toContain('t1:sidetrax-pack-60-battle/war-drums@v1');
  });

  it('keeps inspiration maps out of in-game searches and finds them for derive-layout', () => {
    expect(ids({ words: ['dungeon'] })).not.toContain(MAP);
    expect(ids({ words: ['dungeon'], use: 'derive-layout' })).toContain(MAP);
  });

  it('keeps inspiration out of in-game searches even when its card wrongly claims in-game', () => {
    const map = index.cards.find((card) => card.id === MAP);
    if (!map) throw new Error('fixture map missing');
    const wrong = {
      ...map,
      resolved: { ...map.resolved, rights: { ...map.resolved.rights, uses: ['in-game' as const] } },
    };
    expect(search({ ...index, cards: [wrong] }, { words: [] })).toEqual([]);
  });

  it('includes model drafts by default but audio drafts only with --include-draft', () => {
    expect(ids({ words: ['torch'] })).toEqual([TORCH]);
    expect(ids({ words: [], kind: 'audio' })).toEqual([LOOP, MUSIC]);
    expect(ids({ words: [], kind: 'audio', includeDraft: true })).toEqual([LOOP, DRAFT_LOOP, MUSIC]);
  });

  it('hides every card in a quarantined collection, even with --include-draft and a matching use', () => {
    expect(ids({ words: ['door'], use: 'vision-input', includeDraft: true })).not.toContain(QUARANTINED);
    expect(ids({ words: [], use: 'vision-input', includeDraft: true })).not.toContain(
      't1:drive-2026-10-26-dungeon-sfx@1',
    );
  });

  it('filters by kind/subkind, family, rig and collection; collections match on their counted kinds', () => {
    expect(ids({ words: [], kind: 'model', subkind: 'kit' })).toEqual([
      't1:kenney-mini-dungeon/wall@2.0',
      't1:kenney-mini-dungeon@2.0',
      't1:synty-polygon-goblin-war-camp@v3',
    ]);
    expect(ids({ words: [], kind: 'sprite' })).toEqual(['t1:kenney-tiny-dungeon/tiles/tile-0097@1.0']);
    expect(ids({ words: [], family: 'detailed-low-poly' })).toEqual([TORCH, 't1:synty-polygon-goblin-war-camp@v3']);
    expect(ids({ words: [], sameRigAs: ORC })).toEqual([ORC]);
    expect(ids({ words: [], rigId: 'rig:none' })).toEqual([]);
    expect(ids({ words: [], collection: 't1:kenney-mini-dungeon@2.0' })).toContain('t1:kenney-mini-dungeon/wall@2.0');
  });

  it("keeps a game's search to its family and style-neutral cards; --family stays an exact match", () => {
    const all = ids({ words: [], use: 'vision-input', includeDraft: true });
    const pixel = ids({ words: [], use: 'vision-input', includeDraft: true, gameFamily: 'pixel-art' });
    expect(all).toContain(ORC);
    expect(pixel).not.toContain(ORC);
    expect(pixel).not.toContain(TORCH);
    expect(pixel).toContain('t1:sidetrax-pack-60-battle/war-drums@v1');
    expect(ids({ words: ['orc'], gameFamily: 'chunky-low-poly' })).toEqual([ORC, 't1:kenney-mini-dungeon@2.0']);
    expect(ids({ words: [], use: 'vision-input', family: 'any' })).not.toContain(ORC);
  });

  it('treats a locked compatibility set as one pack without widening through loose matches', () => {
    const tile = 't1:kenney-tiny-dungeon/tiles/tile-0097@1.0';
    expect(ids({ words: ['knight'], gameFamily: 'pixel-art', gameSets: ['kenney-tiny'] })).toContain(tile);
    expect(ids({ words: ['knight'], gameFamily: 'pixel-art', gameSets: ['kenney-pixel-platformer'] })).not.toContain(
      tile,
    );
    expect(
      ids({
        words: ['knight'],
        gameFamily: 'pixel-art',
        gameSets: ['kenney-pixel-platformer'],
        gamePacks: ['kenney-tiny-dungeon'],
      }),
    ).toContain(tile);
    expect(
      ids({ words: ['drums'], use: 'vision-input', gameFamily: 'pixel-art', gameSets: ['kenney-tiny'] }),
    ).toContain('t1:sidetrax-pack-60-battle/war-drums@v1');
  });

  it('uses the curated set mapping when a stored resolved set is stale', () => {
    const tileId = 't1:kenney-tiny-dungeon/tiles/tile-0097@1.0';
    const tile = index.cards.find((card) => card.id === tileId);
    if (!tile) throw new Error('fixture tile missing');
    const stale = { ...tile, resolved: { ...tile.resolved, set: 'kenney-pixel-platformer' } };
    const hits = search(
      { ...index, cards: [stale] },
      { words: [], gameFamily: 'pixel-art', gameSets: ['kenney-tiny'] },
    );
    expect(hits.map((card) => card.id)).toContain(tileId);
  });

  it('splits numbered vendor titles and indexes sprite action names', () => {
    const base = index.cards.find((card) => card.id === 't1:kenney-tiny-dungeon/tiles/tile-0097@1.0');
    if (!base) throw new Error('fixture sprite missing');
    const knight = {
      ...base,
      id: 't1:kenney-tiny-dungeon/characters/1knight@1.0',
      title: '1Knight',
      describe: { ...base.describe, objects: [], keywords: [] },
      source: { ...base.source!, files: [{ ...base.source!.files[0]!, path: 'Sprites/1Knight.png' }] },
      sprite: { ...base.sprite!, animations: [{ name: 'attack', frames: [0, 1] }] },
    };
    expect(search({ ...index, cards: [knight] }, { words: ['knight', 'attack'] }).map((card) => card.id)).toEqual([
      knight.id,
    ]);
  });

  it('filters by the curated compatibility set instead of stale card metadata', () => {
    const tileId = 't1:kenney-tiny-dungeon/tiles/tile-0097@1.0';
    const tile = index.cards.find((card) => card.id === tileId);
    if (!tile) throw new Error('fixture tile missing');
    const stale = { ...tile, resolved: { ...tile.resolved, set: 'wrong-stored-set' } };
    expect(search({ ...index, cards: [stale] }, { words: [], set: 'kenney-tiny' }).map((card) => card.id)).toEqual([
      tileId,
    ]);
    expect(search({ ...index, cards: [stale] }, { words: [], set: 'kenney-pixel-platformer' })).toEqual([]);
    expect(search({ ...index, cards: [stale] }, { words: [], set: '' })).toEqual([]);
  });

  it('indexes rig and standalone animation clip names and canonical actions', () => {
    expect(ids({ words: ['drive'] })).toContain(ORC);
    const base = index.cards.find((card) => card.id === ORC);
    if (!base) throw new Error('fixture model missing');
    const library = {
      ...base,
      id: 't1:kaykit-character-animations/rig-medium-general@7',
      title: 'Rig Medium General',
      kind: 'anim' as const,
      subkind: 'humanoid',
      geometry: undefined,
      rig: undefined,
      anim: {
        target_rig_id: 'rig:0123456789ab',
        clips: [
          { name: 'Idle_A', duration_s: 1.5, canonical: 'idle' as const, loop: true },
          { name: 'Melee_1H_Attack', duration_s: 0.4, canonical: 'attack-melee' as const, loop: false },
        ],
      },
    };
    const animationIndex = { ...index, cards: [library] };
    expect(search(animationIndex, { words: ['idle'] }).map((card) => card.id)).toEqual([library.id]);
    expect(search(animationIndex, { words: ['attack'] }).map((card) => card.id)).toEqual([library.id]);
  });

  it('splits query words on underscores and hyphens like titles, so a file-name query finds the card', () => {
    const base = index.cards.find((card) => card.id === ORC);
    if (!base) throw new Error('fixture model missing');
    const library = {
      ...base,
      id: 't1:kaykit-character-animations/rig_medium_general@1.1',
      title: 'Rig Medium General',
    };
    const only = { ...index, cards: [library] };
    expect(search(only, { words: ['Rig_Medium'] }).map((card) => card.id)).toEqual([library.id]);
    expect(search(only, { words: ['rig-medium-general'] }).map((card) => card.id)).toEqual([library.id]);
    expect(search(only, { words: ['Rig_Large'] })).toEqual([]);
  });

  it('ranks rigged characters named by the query above sprite characters, then props with more word hits', () => {
    // Asking for "knight" means the playable character: a board-game token or a sprite sheet whose paths
    // repeat the word must not bury the rigged model that the shared clip libraries animate.
    const base = index.cards.find((card) => card.id === ORC);
    if (!base) throw new Error('fixture model missing');
    const rigged = { ...base, id: 't1:kaykit-adventurers/characters/knight@2.0', title: 'Knight', describe: {} };
    const sprite = {
      ...base,
      id: 't1:smallscaleint-knight/characters/knight-knight-knight@1',
      title: 'Knight Knight',
      kind: 'sprite' as const,
      subkind: 'character',
      rig: undefined,
      describe: {},
    };
    const token = {
      ...base,
      id: 't1:kaykit-board-game-bits/assets/playercard_knight_knight@1.0',
      title: 'Playercard Knight Knight Knight',
      subkind: 'prop',
      rig: undefined,
      describe: {},
    };
    const hits = search({ ...index, cards: [token, sprite, rigged] }, { words: ['knight'] });
    expect(hits.map((card) => card.id)).toEqual([rigged.id, sprite.id, token.id]);
  });

  it('gives no character tier to a character that matches only through a clip or file name', () => {
    // "walk" asks for walking, not for every character that ships a walk cycle: the sprite named "Walk" leads
    // even though the rogue's four walk clips give it more word hits.
    const base = index.cards.find((card) => card.id === ORC);
    if (!base?.rig) throw new Error('fixture rig missing');
    const walk = { name: 'Walking_A', duration_s: 1, canonical: 'walk' as const, loop: true };
    const walker = {
      ...base,
      id: 't1:kaykit-adventurers/characters/rogue@2.0',
      title: 'Rogue',
      describe: {},
      rig: { ...base.rig, clips: [walk, walk, walk, walk] },
    };
    const named = {
      ...base,
      id: 't1:smallscaleint-heroes/characters/hero@1',
      title: 'Walk',
      kind: 'sprite' as const,
      subkind: 'character',
      rig: undefined,
      describe: {},
    };
    const hits = search({ ...index, cards: [walker, named] }, { words: ['walk'] });
    expect(hits.map((card) => card.id)).toEqual([named.id, walker.id]);
  });

  it('ranks a rigged character first only when it has clips or a clip library targets its rig', () => {
    // A skeleton nothing animates is not playable, so the knight on a library rig beats the bare one even
    // though the bare one's title repeats the word.
    const base = index.cards.find((card) => card.id === ORC);
    if (!base?.rig) throw new Error('fixture rig missing');
    const bare = {
      ...base,
      id: 't1:vendor/characters/knight-knight@1',
      title: 'Knight Knight',
      describe: {},
      rig: { ...base.rig, rig_id: 'rig:aaaaaaaaaaaa', clips: [] },
    };
    const animated = {
      ...base,
      id: 't1:kaykit-adventurers/characters/knight@2.0',
      title: 'Knight',
      describe: {},
      rig: { ...base.rig, rig_id: 'rig:bbbbbbbbbbbb', clips: [] },
    };
    const library = {
      ...base,
      id: 't1:kaykit-character-animations/rig_medium_general@1.1',
      title: 'Rig Medium General',
      kind: 'anim' as const,
      subkind: 'humanoid',
      rig: undefined,
      describe: {},
      anim: { target_rig_id: 'rig:bbbbbbbbbbbb', clips: [] },
    };
    const hits = search({ ...index, cards: [bare, animated, library] }, { words: ['knight'] });
    expect(hits.map((card) => card.id)).toEqual([animated.id, bare.id]);
  });

  it('matches a skeleton by the rig it retargets to, for --rig-id and --same-rig-as', () => {
    const base = index.cards.find((card) => card.id === ORC);
    if (!base?.rig) throw new Error('fixture rig missing');
    const shared = { ...base, id: 't1:kaykit/knight@1', rig: { ...base.rig, rig_id: 'rig:89200673d97d' } };
    const mannequin = {
      ...base,
      id: 't1:kaykit/mannequin_medium@1',
      rig: { ...base.rig, rig_id: 'rig:a83c5e75e523', retarget_rig_id: 'rig:89200673d97d' },
    };
    const rigs = { ...index, cards: [shared, mannequin] };
    const rigIds = (q: Parameters<typeof search>[1]) => search(rigs, q).map((card) => card.id);
    expect(rigIds({ words: [], rigId: 'rig:89200673d97d' })).toEqual([shared.id, mannequin.id]);
    expect(rigIds({ words: [], sameRigAs: mannequin.id })).toEqual([shared.id, mannequin.id]);
    expect(rigIds({ words: [], sameRigAs: shared.id })).toEqual([shared.id, mannequin.id]);
    expect(rigIds({ words: [], rigId: 'rig:a83c5e75e523' })).toEqual([mannequin.id]);
  });

  it('filters directional sprites by the facing count their card records', () => {
    const tile = index.cards.find((card) => card.id === TILE);
    if (!tile?.sprite) throw new Error('fixture sprite missing');
    const directional = {
      ...tile,
      sprite: { ...tile.sprite, directions: ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] },
    };
    const facing8 = { ...index, cards: [directional as typeof tile] };
    expect(search(facing8, { words: [], directions: 8 }).map((card) => card.id)).toEqual([TILE]);
    expect(search(facing8, { words: [], directions: 4 })).toEqual([]);
    // A card that records no facing set is not directional, so the filter drops it.
    expect(search(index, { words: [], directions: 8 })).toEqual([]);
  });

  it('applies --limit after ranking', () => {
    expect(search(index, { words: [], limit: 2 })).toHaveLength(2);
    expect(search(index, { words: [] }).length).toBeGreaterThan(2);
  });
});

describe('audio direction', () => {
  it('finds music by mood and by kind without any search words', () => {
    expect(ids({ words: [], kind: 'audio', moods: ['tense'] })).toEqual([LOOP]);
    expect(ids({ words: [], kind: 'audio', moods: ['tense', 'mysterious'] })).toEqual([LOOP]);
    expect(ids({ words: [], kind: 'audio', moods: ['tense', 'cheerful'] })).toEqual([]);
    expect(ids({ words: [], kind: 'audio', moods: ['tense'], includeDraft: true })).toEqual([LOOP, DRAFT_LOOP]);
  });

  it('matches any of the given genres, and only cards that carry one', () => {
    expect(ids({ words: [], genres: ['chiptune'] })).toEqual([LOOP]);
    expect(ids({ words: [], genres: ['chiptune', 'ambient'], includeDraft: true })).toEqual([LOOP, DRAFT_LOOP]);
    expect(ids({ words: [], genres: ['orchestral'] })).toEqual([]);
  });

  it('ranks a card tagged with the mood above one that only says the word in its description', () => {
    const tagged = index.cards.find((card) => card.id === LOOP);
    const sleezy = index.cards.find((card) => card.id === ORC);
    if (!tagged || !sleezy) throw new Error('fixture cards missing');
    const taggedCopy = { ...tagged, describe: { ...tagged.describe, moods: ['calm'] } };
    const proseCopy = {
      ...sleezy,
      describe: { ...sleezy.describe, description: 'A calm, quiet prop for a still room.' },
    };
    const library = { ...index, cards: [proseCopy, taggedCopy] };
    expect(search(library, { words: ['calm'], includeDraft: true }).map((card) => card.id)).toEqual([
      taggedCopy.id,
      proseCopy.id,
    ]);
  });
});

describe('statusAllowed', () => {
  it('encodes the per-kind defaults', () => {
    expect(statusAllowed('model', 'draft')).toBe(true);
    expect(statusAllowed('sprite', 'draft')).toBe(true);
    expect(statusAllowed('audio', 'measured')).toBe(false);
    expect(statusAllowed('inspiration', 'draft')).toBe(false);
    expect(statusAllowed('texture', 'measured')).toBe(true);
    expect(statusAllowed('texture', 'draft')).toBe(false);
    expect(statusAllowed('model', 'quarantined', true)).toBe(false);
  });
});

describe('info', () => {
  it('returns cards in order and marks unknown ids missing', () => {
    expect(info(index, [ORC, 'nope']).map((card) => ('missing' in card ? 'missing' : card.id))).toEqual([
      ORC,
      'missing',
    ]);
  });
});
