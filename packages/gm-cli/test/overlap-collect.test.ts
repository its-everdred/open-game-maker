import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { collect } from '../../../scripts/meta/overlap-collect.ts';

const oldPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = oldPath;
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'overlap-collect-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const aiur = join(bin, 'aiur-main');
  writeFileSync(
    aiur,
    '#!/bin/sh\ncase "$PWD" in */bad) echo "registry unavailable" >&2; exit 1;; esac\necho \'{"features":[{"key":"combat"}]}\'\n',
  );
  chmodSync(aiur, 0o755);
  process.env.PATH = `${bin}:${oldPath}`;
  const wakes = join(root, 'wakes');
  const dispositions = join(root, 'dispositions');
  writeFileSync(wakes, '');
  writeFileSync(dispositions, '');
  return { root, wakes, dispositions };
}

it('collects features but expires stale coverage verification', () => {
  const { root, wakes, dispositions } = fixture();
  const config = join(root, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({
      instances: [
        {
          name: 'games',
          launch_dir: root,
          wakes,
          dispositions,
          coverage_complete: true,
          coverage_verified_at: '2020-01-01T00:00:00Z',
        },
      ],
    }),
  );
  collect(config, join(root, 'reports'));
  const result = JSON.parse(readFileSync(join(root, 'reports/games.json'), 'utf8'));
  expect(result.features.combat.duplicate_implementations_this_week).toBeNull();
  expect(result.coverage).toContain('unverified');
});

it('rejects output path traversal and preserves reports when a later instance fails', () => {
  const { root, wakes, dispositions } = fixture();
  const config = join(root, 'config.json');
  writeFileSync(config, JSON.stringify({ instances: [{ name: '../outside' }] }));
  expect(() => collect(config, join(root, 'reports'))).toThrow('lowercase slugs');
  mkdirSync(join(root, 'bad'));
  const reports = join(root, 'reports');
  writeFileSync(join(reports, 'first.json'), 'previous');
  writeFileSync(
    config,
    JSON.stringify({
      instances: [
        { name: 'first', launch_dir: root, wakes, dispositions },
        { name: 'second', launch_dir: join(root, 'bad'), wakes, dispositions },
      ],
    }),
  );
  expect(() => collect(config, reports)).toThrow('registry unavailable');
  expect(readFileSync(join(reports, 'first.json'), 'utf8')).toBe('previous');
});

it('the hourly collector invokes overlap collection when configured', () => {
  const root = mkdtempSync(join(tmpdir(), 'overlap-hourly-'));
  const target = join(root, 'scripts/meta/skill-usage');
  mkdirSync(target, { recursive: true });
  cpSync(new URL('../../../scripts/meta/skill-usage/collect.sh', import.meta.url), join(target, 'collect.sh'));
  const config = join(root, 'assets-local/experiments/overlaps');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'config.json'), '{}');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const fake = join(bin, 'node');
  writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n');
  chmodSync(fake, 0o755);
  const fakePython = join(bin, 'python3');
  writeFileSync(fakePython, '#!/bin/sh\nexit 0\n');
  chmodSync(fakePython, 0o755);
  const log = join(root, 'calls');
  execFileSync('bash', [join(target, 'collect.sh')], {
    env: { ...process.env, PATH: `${bin}:${oldPath}`, CALL_LOG: log },
  });
  expect(readFileSync(log, 'utf8')).toContain('scripts/meta/overlap-collect.ts --config');
});
