import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { GmContext } from '../src/command.js';
import { command } from '../src/commands/design/parity.js';

const child = vi.hoisted(() => ({ calls: [] as { args: string[]; env: NodeJS.ProcessEnv }[], codes: [] as number[] }));
vi.mock('../src/commands/capture/shell.js', async (original) => ({
  ...(await original<typeof import('../src/commands/capture/shell.js')>()),
  runChild: async (_cwd: string, args: string[], env: NodeJS.ProcessEnv) => {
    child.calls.push({ args, env });
    return child.codes.shift() ?? 0;
  },
}));
beforeEach(() => {
  child.calls = [];
  child.codes = [];
});
const flags = { screen: 'Home', web: 'apps/web', timeout: 900, port: 43175, 'bridge-port': 43176 };
function fixture(): GmContext {
  const cwd = mkdtempSync(join(tmpdir(), 'gm-parity-'));
  mkdirSync(join(cwd, 'apps/web/e2e'), { recursive: true });
  writeFileSync(join(cwd, 'apps/web/e2e/glass-parity.spec.ts'), '');
  return { cwd, env: {}, err: vi.fn() } as unknown as GmContext;
}
it('builds and runs the selected screen with isolated preview ports', async () => {
  expect(await command.run(fixture(), [], flags)).toBe(0);
  expect(child.calls.map((call) => call.args)).toEqual([
    ['run', 'prepare:browser'],
    ['exec', 'playwright', 'test', 'e2e/glass-parity.spec.ts', '--project', 'desktop', '--workers=1'],
  ]);
  expect(child.calls[1]!.env).toMatchObject({
    OGM_GLASS_PARITY_SCREEN: 'Home',
    OGM_WEB_E2E_PORT: '43175',
    OGM_WEB_BRIDGE_PORT: '43176',
  });
});
it('fails closed on invalid selection and propagates a failing build or comparison', async () => {
  const ctx = fixture();
  await expect(command.run(ctx, [], { ...flags, screen: 'Other' })).rejects.toThrow('invalid screen');
  await expect(command.run(ctx, [], { ...flags, screen: 'Editor' })).rejects.toThrow('real game build');
  await expect(command.run(ctx, [], { ...flags, screen: 'all' })).rejects.toThrow('real game build');
  child.codes = [1];
  expect(await command.run(ctx, [], flags)).toBe(1);
  expect(child.calls).toHaveLength(1);
  child.calls = [];
  child.codes = [0, 1];
  expect(await command.run(ctx, [], flags)).toBe(1);
  expect(child.calls).toHaveLength(2);
});

it('propagates the all-artboard capture result', async () => {
  const ctx = fixture();
  mkdirSync(join(ctx.cwd, 'real-game/dist/design'), { recursive: true });
  for (const file of ['index.html', 'manifest.json', 'design/design.json'])
    writeFileSync(join(ctx.cwd, 'real-game/dist', file), '{}');
  expect(await command.run(ctx, [], { ...flags, screen: 'all', dist: 'real-game/dist' })).toBe(0);
  expect(child.calls[1]!.env.OGM_GLASS_PARITY_SCREEN).toBe('all');
  child.codes = [0, 1];
  expect(await command.run(ctx, [], { ...flags, screen: 'all', dist: 'real-game/dist' })).toBe(1);
});

it('passes an explicit real game build to editor capture', async () => {
  const ctx = fixture();
  mkdirSync(join(ctx.cwd, 'real-game/dist/design'), { recursive: true });
  for (const file of ['index.html', 'manifest.json', 'design/design.json'])
    writeFileSync(join(ctx.cwd, 'real-game/dist', file), '{}');
  expect(await command.run(ctx, [], { ...flags, screen: 'Editor', dist: 'real-game/dist' })).toBe(0);
  expect(child.calls[1]!.env.OGM_GLASS_GAME_DIST).toBe(join(ctx.cwd, 'real-game/dist'));
});

it('rejects fixture games as editor evidence', async () => {
  const ctx = fixture();
  mkdirSync(join(ctx.cwd, 'fixtures/bridge-game'), { recursive: true });
  await expect(command.run(ctx, [], { ...flags, screen: 'Editor', dist: 'fixtures/bridge-game' })).rejects.toThrow(
    'test fixture',
  );
  expect(child.calls).toHaveLength(0);
});
