import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { renderRedirects } from '../tools/redirects.mjs';
import { isReservedGameSlug } from '../../../packages/contracts/src/game-links';

const cli = fileURLToPath(new URL('../tools/redirects.mjs', import.meta.url));
const scratch: string[] = [];

afterAll(() => scratch.forEach((path) => rmSync(path, { recursive: true, force: true })));

function envDir(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogm-site-env-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'web.env'), contents);
  return dir;
}

describe('marketing-site redirects', () => {
  it('reserves every top-level site directory against game slugs', () => {
    const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
    const directories = readdirSync(publicDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const entry of directories) expect(isReservedGameSlug(entry.name), entry.name).toBe(true);
    for (const page of ['docs', 'setup']) expect(isReservedGameSlug(page), page).toBe(true);
  });
  it('sends every app-shaped path to the configured try-it instance and preserves nested paths', () => {
    expect(renderRedirects('https://app.example').split('\n').filter(Boolean)).toEqual([
      '/games  https://app.example/games  302!',
      '/games/*  https://app.example/games/:splat  302!',
      '/new  https://app.example/new  302!',
      '/signin  https://app.example/signin  302!',
      '/auth/*  https://app.example/auth/:splat  302!',
      '/api/*  https://app.example/api/:splat  302!',
      '/docs  /docs/index.html  200',
      '/:slug  https://app.example/play/:slug  302',
    ]);
  });

  it('reads only the existing public app origin and refuses a missing deploy-time value', () => {
    const configured = spawnSync(process.execPath, [cli], {
      encoding: 'utf8',
      env: { ...process.env, OGM_ENV_DIR: envDir('SECRET=do-not-print\nOGM_PUBLIC_APP_ORIGIN=https://app.example/\n') },
    });
    expect(configured.status).toBe(0);
    expect(configured.stderr).toBe('');
    expect(configured.stdout).toBe(renderRedirects('https://app.example'));
    expect(configured.stdout).not.toContain('do-not-print');

    const missing = spawnSync(process.execPath, [cli], {
      encoding: 'utf8',
      env: { ...process.env, OGM_ENV_DIR: envDir('SECRET=do-not-print\n') },
    });
    expect([missing.status, missing.stdout]).toEqual([1, '']);
    expect(missing.stderr).toMatch(/^deploy: OGM_PUBLIC_APP_ORIGIN is not set/);
    expect(missing.stderr).not.toContain('do-not-print');
  });

  it('stages generated redirects in the separate marketing deploy payload', () => {
    const deploy = fileURLToPath(new URL('../tools/deploy.sh', import.meta.url));
    const source = readFileSync(deploy, 'utf8');

    expect(source).toContain('REDIRECTS="$(node "$SITE/tools/redirects.mjs")"');
    expect(source).toContain(`printf '%s\\n' "$REDIRECTS"`);
    expect(source).toContain('>"$DEPLOY_DIR/_redirects"');
    expect(source).toContain('"$SITE/.netlify-site-id"');
    expect(source).not.toContain('apps/web/dist');
  });
});
