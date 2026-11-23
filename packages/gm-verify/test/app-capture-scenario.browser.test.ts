import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../../../apps/web/e2e/fixtures/bridge-game/', import.meta.url));
const runner = fileURLToPath(new URL('../dist/app-capture/runner.js', import.meta.url));

/* Capture `scenario` from a copy of the bridge fixture whose build declares `declared`; the runner's exit and stderr. */
async function capture(scenario: string, declared: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'gm-app-capture-scenario-'));
  const game = join(root, 'game');
  try {
    cpSync(fixture, game, { recursive: true });
    /* The capture page's policy allows the game's own script files only, as the other capture tests set up. */
    const html = join(game, 'index.html');
    const source = readFileSync(html, 'utf8');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('fixture script missing');
    writeFileSync(join(game, 'fixture.js'), script);
    writeFileSync(
      html,
      source.replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="fixture.js"></script>'),
    );
    const manifestFile = join(game, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
    writeFileSync(manifestFile, JSON.stringify({ ...manifest, scenarios: declared }));
    // eslint-disable-next-line no-restricted-properties -- the browser test harness reads its own GL switch
    const software = process.env.GM_VERIFY_SOFTWARE_GL === '1' ? '1' : '0';
    const args = [runner, game, join(root, 'shots'), '[]', '0', '0', software, '--test-fast', '', scenario];
    return await exec(process.execPath, args, { timeout: 240_000 }).then(
      ({ stderr }) => ({ ok: true, stderr }),
      (error: { stderr?: string }) => ({ ok: false, stderr: error.stderr ?? '' }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* Kevin, #1281: agents verify through the scenario a review plays. A name the build does not declare boots the title,
   so a capture of it must fail rather than pass on the wrong screen. */
it('fails a capture whose scenario the build does not declare', async () => {
  const undeclared = await capture('wave-9', ['wave-3']);
  expect(undeclared.ok).toBe(false);
  expect(undeclared.stderr).toContain('scenario "wave-9" is not declared by this build (declared: wave-3)');

  const declared = await capture('wave-3', ['wave-3']);
  expect(declared.stderr).not.toContain('is not declared by this build');
}, 600_000);
