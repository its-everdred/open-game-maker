import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

import { checkControls } from '../src/controls-check.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function game(inputs: unknown, source = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'gm-controls-'));
  roots.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify({ inputs }));
  writeFileSync(join(root, 'src', 'game.ts'), source);
  return root;
}
const inputs = {
  actions: { move: 'stick', attack: 'button' },
  controls: {
    gameplay: {
      layout: 'stick',
      stick: 'move',
      buttons: [{ action: 'attack', icon: 'attack', label: 'Attack', behavior: 'tap' }],
    },
  },
};

it('requires host control sets and rejects invalid action references', () => {
  expect(checkControls(game(inputs, '// The host draws touch controls for this game.'))).toEqual([]);
  expect(checkControls(game({ actions: inputs.actions, touch: 'self' })).join(' ')).toMatch(/self|controls/u);
  const bad = { ...inputs, controls: { gameplay: { ...inputs.controls.gameplay, stick: 'attack' } } };
  expect(checkControls(game(bad)).join(' ')).toMatch(/attack/u);
});

it('flags recognizable game-owned on-screen controller markup', () => {
  expect(
    checkControls(game(inputs, '<div class="virtual-joystick"><button class="touch-button">A</button></div>')).join(
      ' ',
    ),
  ).toMatch(/controller/u);
  expect(checkControls(game(inputs, "showPrompt('TAP A!');")).join(' ')).toMatch(/controller/u);
  const root = game(inputs);
  writeFileSync(join(root, 'index.html'), '<div id="touch"><button data-key="ArrowUp"></button></div>');
  expect(checkControls(root).join(' ')).toMatch(/index.html/u);
});

it('makes the controls check available as a failing CLI gate', async () => {
  const { gm } = await import('./helpers.js');
  const root = game({ actions: { move: 'stick' }, touch: 'self' });
  const result = await gm(['check', 'controls'], { cwd: root });
  expect(result.code).toBe(1);
  expect(result.err.join(' ')).toMatch(/self|controls/u);
}, 90_000);

it('checks a TypeScript scaffold manifest and fails closed on dynamic inputs', () => {
  const root = game(inputs);
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify({ id: 'scaffold' }));
  writeFileSync(
    join(root, 'src', 'manifest.ts'),
    `export const manifest = { inputs: ${JSON.stringify(inputs)} } as const;`,
  );
  expect(checkControls(root)).toEqual([]);
  writeFileSync(
    join(root, 'src', 'manifest.ts'),
    "export const manifest = { inputs: { actions: { move: 'stick' } } };",
  );
  expect(checkControls(root).join(' ')).toMatch(/gameplay/u);
  writeFileSync(join(root, 'src', 'manifest.ts'), 'export const manifest = { inputs: importedInputs };');
  expect(checkControls(root).join(' ')).toMatch(/static|resolve/u);
  writeFileSync(
    join(root, 'src', 'manifest.ts'),
    `export const manifest = { inputs: ${JSON.stringify(inputs)}, ...other };`,
  );
  expect(checkControls(root).join(' ')).toMatch(/static|resolve/u);
});

it('rejects conflicting JSON and runtime control declarations', () => {
  const root = game(inputs);
  writeFileSync(
    join(root, 'src', 'manifest.ts'),
    "export const manifest = { inputs: { actions: { move: 'stick' }, touch: 'self' } };",
  );
  expect(checkControls(root).join(' ')).toMatch(/static|resolve|conflict/u);
});

it('includes TypeScript manifest failures in the main check command', async () => {
  const { gm } = await import('./helpers.js');
  const root = game(inputs);
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify({ id: 'scaffold' }));
  writeFileSync(
    join(root, 'src', 'manifest.ts'),
    "export const manifest = { inputs: { actions: { move: 'stick' } } };",
  );
  const result = await gm(['check', '--json'], { cwd: root });
  expect(result.code).not.toBe(0);
  expect(result.out.join(' ')).toMatch(/inputs\.controls must declare a gameplay set/u);
}, 90_000);

it('rejects generic directional controllers without banning ordinary menu helpers', () => {
  expect(checkControls(game(inputs, '<button class="left-button" aria-label="Move left"></button>')).join(' ')).toMatch(
    /controller/u,
  );
  expect(checkControls(game(inputs, 'drawTouchButton(canvas, "left");')).join(' ')).toMatch(/controller/u);
  expect(checkControls(game(inputs, "const miniButton = () => makeMenuButton('Settings');"))).toEqual([]);
});

it('scans root-level game source files for game-drawn controls', () => {
  const root = game(inputs);
  writeFileSync(join(root, 'main.ts'), 'drawTouchButton(canvas, "left");');
  expect(checkControls(root).join(' ')).toMatch(/main\.ts/u);
});

it.each(['game-2d', 'game-3d', 'game-multiplayer'])('checks the real %s scaffold', (name) => {
  const root = fileURLToPath(new URL(`../../../templates/${name}/`, import.meta.url));
  expect(checkControls(root)).toEqual([]);
});
