import { describe, expect, it } from 'vitest';
import {
  checkPreferenceBundle,
  checkPreferenceSection,
  readPreferences,
  updatePreferenceSection,
  validatePreferences,
  type Preference,
} from '../src/preferences.js';
import { bundledPreferences, bundledSkill, preferenceSkill, preferencesDirectory } from '../src/commands/prefs/list.js';

const entry = (id: string, date: string, value: string): Preference => ({
  id,
  date,
  quote: id,
  source: 'https://example.com/source',
  scope: 'all',
  topic: 'controls',
  value,
  owner_ticket: 1,
  check: { kind: 'review-only', reason: 'requires review' },
  status: 'active',
});

describe('preference conflicts', () => {
  it('accepts an explicit newer replacement and excludes the old entry', () => {
    const older = { ...entry('old', '2026-01-01', 'letters'), status: 'superseded' as const, superseded_by: 'new' };
    const newer = { ...entry('new', '2026-02-01', 'icons'), supersedes: ['old'] };
    const result = validatePreferences([older, newer]);
    expect(result.errors).toEqual([]);
    expect(result.active.map((item) => item.id)).toEqual(['new']);
  });

  it('reports unresolved contradictions with both quotes and dates', () => {
    const result = validatePreferences([entry('old', '2026-01-01', 'letters'), entry('new', '2026-02-01', 'icons')]);
    expect(result.errors.join(' ')).toContain('old');
    expect(result.errors.join(' ')).toContain('2026-01-01');
    expect(result.errors.join(' ')).toContain('new');
    expect(result.errors.join(' ')).toContain('2026-02-01');
  });

  it('rejects broken and backwards supersession links', () => {
    const older = { ...entry('old', '2026-01-01', 'letters'), supersedes: ['new'] };
    const newer = { ...entry('new', '2026-02-01', 'icons'), status: 'superseded' as const, superseded_by: 'old' };
    expect(validatePreferences([older, newer]).errors.length).toBeGreaterThan(0);
  });
});

it('rejects a missing reciprocal link even when the replacement is newer', () => {
  const older = { ...entry('old', '2026-01-01', 'letters'), status: 'superseded' as const, superseded_by: 'new' };
  const newer = entry('new', '2026-02-01', 'icons');
  expect(validatePreferences([older, newer]).errors.join(' ')).toContain('reciprocal');
});

it('rejects supersession across unrelated topics', () => {
  const older = { ...entry('old', '2026-01-01', 'letters'), status: 'superseded' as const, superseded_by: 'new' };
  const newer = { ...entry('new', '2026-02-01', 'icons'), topic: 'audio', supersedes: ['old'] };
  expect(validatePreferences([older, newer]).errors.join(' ')).toContain('same scope and topic');
});

it('keeps the shipped registry valid', () => {
  const entries = readPreferences(preferencesDirectory);
  expect(entries.length).toBeGreaterThan(0);
  expect(validatePreferences(entries).errors).toEqual([]);
});

it('lists only all-game and requested scope entries', async () => {
  const { command } = await import('../src/commands/prefs/list.js');
  const output: string[] = [];
  const errors: string[] = [];
  const ctx = { json: true, out: (line: string) => output.push(line), err: (line: string) => errors.push(line) };
  const code = await command.run(ctx as never, [], { scope: 'role:audio' });
  expect(code).toBe(0);
  expect(errors).toEqual([]);
  const entries = JSON.parse(output[0]!) as Preference[];
  expect(entries.some((item) => item.id === 'controller-icons')).toBe(true);
  expect(entries.some((item) => item.id === 'pixel-finish')).toBe(false);
});

it('rejects a rule that gm check does not implement', () => {
  const unknown = { ...entry('unknown', '2026-01-01', 'value'), check: { kind: 'rule' as const, id: 'missing' } };
  expect(validatePreferences([unknown]).errors.join(' ')).toContain('unregistered gm check rule missing');
});

it('rejects malformed registry files', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'gm-preferences-'));
  writeFileSync(join(root, 'bad.json'), JSON.stringify({ ...entry('bad', 'not-a-date', 'icons') }));
  expect(() => readPreferences(root)).toThrow('cannot read preferences');
});

it('detects contradictory rules in overlapping topic paths', () => {
  const general = entry('general', '2026-01-01', 'letters');
  const specific = { ...entry('specific', '2026-02-01', 'icons'), topic: 'controls.buttons' };
  expect(validatePreferences([general, specific]).errors.join(' ')).toContain('conflict');
});

it('does not flag matching rules or unrelated scopes', () => {
  const first = entry('first', '2026-01-01', 'icons');
  const matching = entry('matching', '2026-02-01', 'icons');
  const otherScope = { ...entry('other', '2026-03-01', 'letters'), scope: 'role:audio' };
  expect(validatePreferences([first, matching, otherScope]).errors).toEqual([]);
});

it('keeps worker-injected preferences current', () => {
  const entries = readPreferences(preferencesDirectory);
  expect(checkPreferenceSection(entries, preferenceSkill)).toEqual([]);
  expect(checkPreferenceSection(entries.slice(1), preferenceSkill)).toContain('gm-core preference section is stale');
});

it('refreshes only the marked worker section', () => {
  const input = 'before\n<!-- preferences:start -->stale<!-- preferences:end -->\nafter';
  const output = updatePreferenceSection(input, [entry('one', '2026-01-01', 'icons')]);
  expect(output).toContain('before\n<!-- preferences:start -->');
  expect(output).toContain('one');
  expect(output).toContain('<!-- preferences:end -->\nafter');
  expect(output).not.toContain('stale');
  expect(() => updatePreferenceSection('missing markers', [])).toThrow('missing');
});

it('fails a missing registry instead of accepting an empty one', () => {
  expect(validatePreferences([]).errors).toContain('preference registry is empty');
});

it('keeps the CLI tarball registry current', () => {
  const entries = readPreferences(preferencesDirectory);
  expect(checkPreferenceBundle(entries, bundledPreferences, bundledSkill)).toEqual([]);
  expect(checkPreferenceBundle(entries.slice(1), bundledPreferences, bundledSkill)).toContain(
    'bundled preferences are stale',
  );
});
