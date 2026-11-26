import { describe, expect, it } from 'vitest';
import {
  checkInstalledPreferenceSections,
  checkPreferenceBundle,
  checkPreferenceSection,
  checkPromptPreferenceSection,
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
    const result = validatePreferences([
      { ...entry('old', '2026-01-01', 'letters'), quote: 'Use letters' },
      { ...entry('new', '2026-02-01', 'icons'), quote: 'Use icons', scope: 'role:visual' },
    ]);
    expect(result.errors.join(' ')).toContain('Use letters');
    expect(result.errors.join(' ')).toContain('2026-01-01');
    expect(result.errors.join(' ')).toContain('Use icons');
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

it('detects explicitly contradictory rules in overlapping topic paths', () => {
  const general = entry('general', '2026-01-01', 'letters');
  const specific = {
    ...entry('specific', '2026-02-01', 'icons'),
    topic: 'controls.buttons',
    conflicts_with: ['general'],
  };
  expect(validatePreferences([general, specific]).errors.join(' ')).toContain('conflict');
});

it('does not flag matching rules or unrelated scopes', () => {
  const first = entry('first', '2026-01-01', 'icons');
  const matching = entry('matching', '2026-02-01', 'icons');
  const otherScope = { ...entry('other', '2026-03-01', 'letters'), scope: 'game:other' };
  const firstGame = { ...first, scope: 'game:first' };
  const matchingGame = { ...matching, scope: 'game:first' };
  expect(validatePreferences([firstGame, matchingGame, otherScope]).errors).toEqual([]);
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

it('reports stale installed worker skills', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'gm-pref-skill-'));
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['-C', root, 'init', '-q']);
  const nested = join(root, 'games', 'example');
  mkdirSync(nested, { recursive: true });
  const dir = join(root, '.agents', 'skills', 'gm-core');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), 'old skill');
  expect(checkInstalledPreferenceSections(readPreferences(preferencesDirectory), nested).join(' ')).toContain(
    '.agents/skills/gm-core/SKILL.md: preference section is stale',
  );
});

it('allows compatible parent and child constraints', () => {
  const general = entry('general', '2026-01-01', 'crisp');
  const specific = {
    ...entry('specific', '2026-02-01', 'separation'),
    topic: 'controls.buttons',
    compatible_with: ['general'],
  };
  expect(validatePreferences([general, specific]).errors).toEqual([]);
});

it('rejects an unrelated preference claiming the distortion check', () => {
  const wrong = { ...entry('wrong', '2026-01-01', 'icons'), check: { kind: 'rule' as const, id: 'image-distortion' } };
  expect(validatePreferences([wrong]).errors.join(' ')).toContain('does not enforce');
});

it('keeps the generated daemon prompt preferences current', async () => {
  const { fileURLToPath } = await import('node:url');
  const prompt = fileURLToPath(new URL('../../game-repo-template/templates/prompt.md.liquid', import.meta.url));
  expect(checkPromptPreferenceSection(readPreferences(preferencesDirectory), prompt)).toEqual([]);
});

it('refreshes installed preferences without replacing project context', async () => {
  const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { refreshInstalledPreferenceSections } = await import('../src/preferences.js');
  const root = mkdtempSync(join(tmpdir(), 'gm-pref-refresh-'));
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['-C', root, 'init', '-q']);
  const skill = join(root, '.claude', 'skills', 'gm-core', 'SKILL.md');
  mkdirSync(join(skill, '..'), { recursive: true });
  writeFileSync(skill, 'local project context\n<!-- preferences:start -->stale<!-- preferences:end -->\n');
  refreshInstalledPreferenceSections(readPreferences(preferencesDirectory), root);
  expect(readFileSync(skill, 'utf8')).toContain('local project context');
  expect(checkInstalledPreferenceSections(readPreferences(preferencesDirectory), root)).toEqual([]);
});

it('refuses to refresh an absent or external installed skill', async () => {
  const { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { refreshInstalledPreferenceSections } = await import('../src/preferences.js');
  const root = mkdtempSync(join(tmpdir(), 'gm-pref-missing-'));
  const external = mkdtempSync(join(tmpdir(), 'gm-pref-outside-'));
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['-C', root, 'init', '-q']);
  const entries = readPreferences(preferencesDirectory);
  expect(checkInstalledPreferenceSections(entries, root, true)).toContain(
    'no installed gm-core skill; install the skill pack first',
  );
  expect(() => refreshInstalledPreferenceSections(entries, root)).toThrow('no installed gm-core');
  mkdirSync(join(root, '.claude', 'skills'), { recursive: true });
  mkdirSync(join(external, 'gm-core'));
  writeFileSync(join(external, 'gm-core', 'SKILL.md'), 'external');
  symlinkSync(join(external, 'gm-core'), join(root, '.claude', 'skills', 'gm-core'));
  expect(() => refreshInstalledPreferenceSections(entries, root)).toThrow('outside the workspace');
});

it('synchronizes changed and removed entries into generated files', async () => {
  const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { syncPreferenceCopies } = await import('../src/commands/prefs/sync.js');
  const root = mkdtempSync(join(tmpdir(), 'gm-pref-sync-'));
  const source = join(root, 'source');
  const bundle = join(root, 'bundle');
  mkdirSync(source);
  mkdirSync(bundle);
  const entries = [entry('one', '2026-01-01', 'icons')];
  writeFileSync(join(source, 'one.json'), JSON.stringify(entries[0]));
  writeFileSync(join(bundle, 'old.json'), '{}');
  const skill = join(root, 'skill.md');
  const prompt = join(root, 'prompt.md');
  const fixture = join(root, 'fixture.md');
  const bundledSkill = join(root, 'bundled.md');
  for (const path of [skill, prompt, fixture])
    writeFileSync(path, '<!-- preferences:start -->old<!-- preferences:end -->');
  syncPreferenceCopies({ source, bundle, skill, prompt, fixture, bundledSkill });
  expect(existsSync(join(bundle, 'old.json'))).toBe(false);
  expect(JSON.parse(readFileSync(join(bundle, 'one.json'), 'utf8')).id).toBe('one');
  for (const path of [skill, prompt, fixture, bundledSkill]) expect(readFileSync(path, 'utf8')).toContain('[one]');
});

it('checks game and role scopes together, and rejects broken conflict references', () => {
  const game = { ...entry('game', '2026-01-01', 'letters'), scope: 'game:castle' };
  const role = { ...entry('role', '2026-02-01', 'icons'), scope: 'role:visual' };
  expect(validatePreferences([game, role]).errors.join(' ')).toContain('recommend role');
  expect(validatePreferences([{ ...game, conflicts_with: ['missing'] }]).errors.join(' ')).toContain(
    'invalid conflicts_with',
  );
});

it('requires an installed gm-core skill when checking a game workspace', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { command } = await import('../src/commands/prefs/check.js');
  const root = mkdtempSync(join(tmpdir(), 'gm-pref-game-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  writeFileSync(join(root, 'gm.manifest.json'), '{}');
  const errors: string[] = [];
  const ctx = { cwd: root, err: (line: string) => errors.push(line), out: () => {} };
  expect(await command.run(ctx as never, [], {})).toBe(1);
  expect(errors.join(' ')).toContain('no installed gm-core skill');
});

it('preserves exact quoted wording when loading entries', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'gm-pref-quote-'));
  writeFileSync(
    join(root, 'quoted.json'),
    JSON.stringify({ ...entry('quoted', '2026-01-01', 'icons'), quote: '  exact words  ' }),
  );
  expect(readPreferences(root)[0]?.quote).toBe('  exact words  ');
});

it('rejects duplicate generated sections instead of hiding stale instructions', async () => {
  const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'gm-pref-duplicate-'));
  const skill = join(root, 'SKILL.md');
  const entries = readPreferences(preferencesDirectory);
  const { renderPreferenceSection } = await import('../src/preferences.js');
  writeFileSync(skill, `${renderPreferenceSection(entries)}\n<!-- preferences:start -->old<!-- preferences:end -->`);
  expect(checkPreferenceSection(entries, skill)).toContain('gm-core preference section is stale');
  expect(() => updatePreferenceSection(readFileSync(skill, 'utf8'), entries)).toThrow('markers');
});

it('requires classification for unmarked overlapping topics', () => {
  const general = entry('general', '2026-01-01', 'crisp');
  const specific = { ...entry('specific', '2026-02-01', 'separation'), topic: 'controls.buttons' };
  expect(validatePreferences([general, specific]).errors.join(' ')).toContain('unclassified overlap');
});

it('finds a workspace skill when the game directory is reached through a symlink', async () => {
  const { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const scratch = mkdtempSync(join(tmpdir(), 'gm-pref-symlink-'));
  const root = join(scratch, 'repo');
  const game = join(root, 'games', 'game');
  mkdirSync(game, { recursive: true });
  execFileSync('git', ['-C', root, 'init', '-q']);
  const skill = join(root, '.claude', 'skills', 'gm-core');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), 'old');
  const alias = join(scratch, 'alias');
  symlinkSync(game, alias);
  expect(checkInstalledPreferenceSections(readPreferences(preferencesDirectory), alias, true).join(' ')).toContain(
    'preference section is stale',
  );
});

it('refuses registry entries that are symbolic links', async () => {
  const { mkdtempSync, symlinkSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'gm-pref-link-'));
  const target = join(root, 'target');
  writeFileSync(target, JSON.stringify(entry('linked', '2026-01-01', 'icons')));
  symlinkSync(target, join(root, 'linked.json'));
  expect(() => readPreferences(root)).toThrow('regular file');
});
