// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GameManifest } from '@ogm/contracts';

import { gmBuildArtifacts } from './index.js';
import { assertNoGameMenu, type BundleFile } from './shell-menu.js';

const chunk = (code: string): Record<string, BundleFile> => ({
  'assets/index.js': { fileName: 'assets/index.js', type: 'chunk', code },
});
const manifest = () =>
  JSON.parse(readFileSync(join(process.cwd(), '../contracts/fixtures/game.v1.json'), 'utf8')) as GameManifest;

/* Kevin saw Blobs with a different top-right button than every other game (#1294): one shell menu, never a game's own. */
describe('assertNoGameMenu', () => {
  it("fails a game that restyles the shell's menu button", () => {
    expect(() => assertNoGameMenu({ ...manifest(), playMenuButton: { colour: '#c5220e', icon: 'pause' } }, {})).toThrow(
      /remove playMenuButton/u,
    );
  });

  it('fails a game that draws its own hamburger or menu control', () => {
    for (const code of [
      'button.textContent = "☰";',
      'el.innerHTML = "<span>&#9776;</span>";',
      'btn.setAttribute("aria-label", "Menu");',
      'btn.ariaLabel = `Open menu`;',
      '<button aria-label="Game menu"></button>',
      'h("button", { "aria-label": "Pause menu" })',
    ])
      expect(() => assertNoGameMenu(manifest(), chunk(code)), code).toThrow(/draws its own menu control/u);
    expect(() =>
      assertNoGameMenu(manifest(), {
        'index.html': { fileName: 'index.html', type: 'asset', source: '<button aria-label="Menu">☰</button>' },
      }),
    ).toThrow(/index\.html/u);
  });

  it("passes what real games ship: a comment about the shell's button and a game's own menu screen", () => {
    expect(() =>
      assertNoGameMenu(
        manifest(),
        chunk(
          '/* the NEXT tray yields the hamburger\'s measured control */ const screens = ["title","menu"]; ' +
            'b.setAttribute("aria-label", "Back to the menu screen"); host.settings.onChange(() => {});',
        ),
      ),
    ).not.toThrow();
  });

  it('runs in every game build', () => {
    const plugin = gmBuildArtifacts({
      manifest: { ...manifest(), playMenuButton: { colour: '#c5220e', icon: 'pause' } } as GameManifest,
      designDir: '/game/design',
    });
    expect(() => plugin.generateBundle.call({ emitFile: () => '' }, {}, {})).toThrow(/remove playMenuButton/u);
    expect(() =>
      gmBuildArtifacts({ manifest: manifest(), designDir: '/game/design' }).generateBundle.call(
        { emitFile: () => '' },
        {},
        chunk('btn.ariaLabel = "Menu";'),
      ),
    ).toThrow(/draws its own menu control/u);
  });
});
