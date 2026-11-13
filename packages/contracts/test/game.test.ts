import { describe, expect, it } from 'vitest';

import { controlDeclSchema, gameManifestSchema, widgetSchema } from '../src/game.js';
import { loadJson } from './helpers.js';
import { emittedValidator } from './json-schema.js';

const gameJson = emittedValidator('game.v1');
const manifest = () => loadJson<Record<string, unknown>>('fixtures/game.v1.json');

const control = {
  id: 'enemy.color',
  label: 'Enemy colour',
  scope: 'prefab',
  path: '/color',
  widget: { kind: 'choice', options: [{ value: 'blue', label: 'Blue' }] },
  default: 'red',
};

describe('game contract', () => {
  it('validates the optional play menu appearance', () => {
    const themed = { ...manifest(), playMenuButton: { colour: '#e02020', icon: 'pause' } };
    expect(gameManifestSchema.parse(themed).playMenuButton).toEqual(themed.playMenuButton);
    expect(gameJson(themed)).toBe(true);
    for (const playMenuButton of [
      { colour: 'red; background: url(x)', icon: 'pause' },
      { colour: '#e02020', icon: 'stop' },
    ]) {
      expect(gameManifestSchema.safeParse({ ...manifest(), playMenuButton }).success).toBe(false);
      expect(gameJson({ ...manifest(), playMenuButton })).toBe(false);
    }
  });
  it('accepts the golden manifest in both Zod and the emitted JSON Schema', () => {
    expect(gameManifestSchema.safeParse(manifest()).success).toBe(true);
    expect(gameJson(manifest())).toBe(true);
  });

  it('accepts an optional trusted host origin and rejects non-origin URLs', () => {
    const trusted = { ...manifest(), hostOrigin: 'https://host-a.example.test:8443' };
    expect(gameManifestSchema.safeParse(trusted).success).toBe(true);
    expect(gameJson(trusted)).toBe(true);

    for (const hostOrigin of ['https://host-a.example.test/path', 'https://user@host-a.example.test', 'file:///game']) {
      const untrusted = { ...manifest(), hostOrigin };
      expect(gameManifestSchema.safeParse(untrusted).success).toBe(false);
      expect(gameJson(untrusted)).toBe(false);
    }
  });

  it('accepts the running build save facts and rejects a negative schema', () => {
    const facts = { ...manifest(), saveSchema: 3, migratesFrom: 2 };
    expect(gameManifestSchema.safeParse(facts).success).toBe(true);
    expect(gameJson(facts)).toBe(true);
    expect(gameManifestSchema.safeParse({ ...manifest(), saveSchema: -1 }).success).toBe(false);
  });

  it('rejects editor tools outside the host vocabulary', () => {
    const doc = { ...manifest(), tools: ['select', 'lasso'] };
    expect(gameManifestSchema.safeParse(doc).error?.issues[0]?.path).toEqual(['tools', 1]);
    expect(gameJson(doc)).toBe(false);
  });

  // Consumers render these as text; the caps bound what a game can push into host UI.
  it('caps the title at 80 and labels and hints at 200 characters', () => {
    expect(gameManifestSchema.safeParse({ ...manifest(), title: 'x'.repeat(81) }).success).toBe(false);
    const palette = (manifest() as { palette: { items: Record<string, unknown>[] } }).palette;
    const longHint = { ...palette, items: [{ ...palette.items[0], hint: 'x'.repeat(201) }] };
    expect(gameManifestSchema.safeParse({ ...manifest(), palette: longHint }).success).toBe(false);
    expect(controlDeclSchema.safeParse({ ...control, label: 'x'.repeat(201) }).success).toBe(false);
    expect(controlDeclSchema.safeParse({ ...control, help: 'x'.repeat(201) }).success).toBe(false);
  });

  it('accepts a dotted lowercase control and rejects an unstable id', () => {
    expect(controlDeclSchema.safeParse(control).success).toBe(true);
    expect(controlDeclSchema.safeParse({ ...control, id: 'EnemyColor' }).error?.issues[0]?.path).toEqual(['id']);
  });

  it('accepts selector scopes and rejects unknown ones', () => {
    expect(controlDeclSchema.safeParse({ ...control, scope: { selector: { prefab: 'skeleton' } } }).success).toBe(true);
    expect(controlDeclSchema.safeParse({ ...control, scope: 'everything' }).success).toBe(false);
  });

  it('requires count semantics and nests rule slots', () => {
    expect(widgetSchema.safeParse({ kind: 'count', min: 0, max: 9 }).success).toBe(false);
    const rule = {
      kind: 'rule',
      template: 'When [who] touches [what]',
      slots: { who: { kind: 'choice', options: [{ value: 'player', label: 'Player' }] }, what: { kind: 'lasso' } },
    };
    expect(widgetSchema.safeParse(rule).success).toBe(false);
    rule.slots.what = { kind: 'toggle' } as never;
    expect(widgetSchema.safeParse(rule).success).toBe(true);
  });
});
