import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderRedirects } from '../../tools/redirects.mjs';

const publicFile = (name: string) => readFileSync(resolve(process.cwd(), 'public', name), 'utf8');

describe('Netlify static configuration', () => {
  it('places both backend proxies, built from the deploy-time origin, before the SPA fallback', () => {
    expect(renderRedirects('https://api.example:8443', 'https://makeopen.games').split('\n').filter(Boolean)).toEqual([
      'https://ogm2000.netlify.app/*  https://makeopen.games/:splat  301!',
      '/api/*  https://api.example:8443/api/:splat  200',
      '/auth/*  https://api.example:8443/auth/:splat  200',
      '/proto  /proto/  301',
      '/proto/*  /proto/:splat  200',
      '/*  /index.html  200',
    ]);
  });

  it('publishes the custom domain as the canonical and Open Graph URL', () => {
    const index = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

    expect(index).toContain('<link rel="canonical" href="https://makeopen.games/" />');
    expect(index).toContain('<meta property="og:url" content="https://makeopen.games/" />');
  });

  // The host is a deploy-time value (#317): the repo keeps no _redirects of its own.
  it('writes _redirects only into the deploy payload', () => {
    const deploy = readFileSync(resolve(process.cwd(), 'tools/deploy.sh'), 'utf8');

    expect(existsSync(resolve(process.cwd(), 'public/_redirects'))).toBe(false);
    expect(deploy).toContain('REDIRECTS="$(node "$ROOT/apps/web/tools/redirects.mjs")"');
    expect(deploy).toContain(`printf '%s\\n' "$REDIRECTS"`);
    expect(deploy).toContain('>"$DEPLOY_DIR/_redirects"');
  });

  it('pins cache policy for the worker, town, and built assets', () => {
    const headers = publicFile('_headers');

    expect(headers).toContain('/sw.js\n  Cache-Control: no-cache');
    expect(headers).toContain('/town/*\n  Cache-Control: no-cache');
    expect(headers).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
  });

  it('keeps load evidence outside the temporary deploy payload', () => {
    const deploy = readFileSync(resolve(process.cwd(), 'tools/deploy.sh'), 'utf8');

    expect(deploy).toContain('RECORD_DIR="$(mktemp -d)"');
    expect(deploy).not.toContain('RECORD_DIR="$DEPLOY_DIR');
    expect(deploy).not.toContain('>"$DEPLOY_DIR/preview.log"');
  });

  it('selects the web project without a Netlify monorepo prompt', () => {
    const deploy = readFileSync(resolve(process.cwd(), 'tools/deploy.sh'), 'utf8');

    expect(deploy).toContain('netlify deploy --prod --no-build --filter @ogm/web --dir "$DEPLOY_DIR"');
  });

  it('stages the prototype and stamps both service workers before previewing the payload', () => {
    const deploy = readFileSync(resolve(process.cwd(), 'tools/deploy.sh'), 'utf8');

    const buildPrototype = deploy.indexOf('prototypes/studio-v0/tools/build.sh');
    const stagePrototype = deploy.indexOf('tools/stage-prototype.mjs');
    expect(buildPrototype).toBeGreaterThan(-1);
    expect(stagePrototype).toBeGreaterThan(buildPrototype);
    expect(deploy).toContain('tools/stage-prototype.mjs');
    expect(deploy).toContain('"$DEPLOY_DIR/proto"');
    expect(deploy).toContain('"$DEPLOY_DIR/proto/sw.js"');
  });

  it('rebuilds ignored title assets before the web and prototype payloads', () => {
    const deploy = readFileSync(resolve(process.cwd(), 'tools/deploy.sh'), 'utf8');

    const titleBuild = deploy.indexOf('title-town/tools/build.sh');
    const titleSounds = deploy.indexOf('title-town/tools/sounds.sh');
    const publicTown = deploy.indexOf('apps/web/tools/town.sh');
    const webBuild = deploy.indexOf('--filter @ogm/web build');
    const prototypeBuild = deploy.indexOf('prototypes/studio-v0/tools/build.sh');

    expect(titleBuild).toBeGreaterThan(-1);
    expect(titleSounds).toBeGreaterThan(titleBuild);
    expect(publicTown).toBeGreaterThan(titleSounds);
    expect(webBuild).toBeGreaterThan(publicTown);
    expect(prototypeBuild).toBeGreaterThan(webBuild);
    expect(deploy).toContain('OGM_INSTANCE_ALL_ASSETS');
    expect(deploy).toContain('bash "$ROOT/apps/web/tools/town.sh" "${ASSET_FILTER_ARGS[@]}"');
    expect(deploy).toContain('"$DEPLOY_DIR/proto" "${ASSET_FILTER_ARGS[@]}"');
    expect(deploy).toContain('[[ "$INSTANCE_ALL_ASSETS" == 0 && -d "$DEPLOY_DIR/art/packs" ]]');
    expect(deploy).toContain("-name 'synty-*' -delete");
  });

  it('checks every ignored deploy input before building', () => {
    const deploy = readFileSync(resolve(process.cwd(), 'tools/deploy.sh'), 'utf8');

    for (const input of [
      'assets-local',
      'scripts/audio/.venv',
      'prototypes/ui-v0/site/assets',
      'prototypes/studio-v0/town',
      'prototypes/studio-v0/demo',
      'apps/web/title-town/models/bake',
      'apps/web/title-town/models/sprites',
      'apps/web/title-town/models/variants',
      'apps/web/title-town/models/candidates',
      'apps/web/title-town/models/mdungeon',
    ]) {
      expect(deploy).toContain(`require_directory "$ROOT/${input}"`);
    }
  });

  it('refuses a deploy whose load check never reports town-ready', () => {
    const deploy = readFileSync(resolve(process.cwd(), 'tools/deploy.sh'), 'utf8');

    expect(deploy).toContain(`grep ' msg town-ready$' "$LOAD_LOG"`);
    expect(deploy).toContain('if [[ -z "$TOWN_READY" ]]; then');
    expect(deploy).toContain('deploy: load check did not report town-ready; refusing to deploy');
  });

  it('gives the load check a configurable 240-second readiness window', () => {
    const deploy = readFileSync(resolve(process.cwd(), 'tools/deploy.sh'), 'utf8');

    expect(deploy).toContain('LOAD_SECONDS="${OGM_DEPLOY_LOAD_SECONDS:-240}"');
    expect(deploy).toContain('"$RECORD_DIR" http://127.0.0.1:43171/ "$LOAD_SECONDS"');
  });

  it('bundles the copied timeline in the public town payload', () => {
    const publicTown = readFileSync(resolve(process.cwd(), 'tools/town.sh'), 'utf8');

    expect(publicTown).toContain('"$TC/timeline.js"');
    expect(publicTown).toMatch(/\{city,rampage,earthbound,fx,timeline\}\.js/);
  });

  it('keeps the music fallback when the licensed title tracks are unavailable', () => {
    const publicTown = readFileSync(resolve(process.cwd(), 'tools/town.sh'), 'utf8');

    expect(publicTown).toContain('[[ -f "$CAMELOT" && -f "$UNDERGROUND" ]]');
    expect(publicTown).toContain('rm -f "$A/music/camelot.mp3" "$A/music/underground.mp3"');
    expect(publicTown).toContain('town: licensed music unavailable; using built-in fallbacks');
  });

  it('falls back to the title source timeline for the frozen prototype build', () => {
    const town = mkdtempSync(join(tmpdir(), 'ogm-title-town-'));
    writeFileSync(
      join(town, 'city.js'),
      "import { loopedSceneTime } from './timeline.js'; console.log(loopedSceneTime(1, 2, 3));\n",
    );

    try {
      const build = spawnSync(process.execPath, [resolve(process.cwd(), 'title-town/tools/bundle.mjs'), town], {
        encoding: 'utf8',
      });
      expect([build.status, build.stderr]).toEqual([0, '']);

      const run = spawnSync(process.execPath, [join(town, 'city.bundle.js')], { encoding: 'utf8' });
      expect([run.status, run.stdout, run.stderr]).toEqual([0, '1\n', '']);
    } finally {
      rmSync(town, { recursive: true, force: true });
    }
  });

  it('preserves host-only title inputs when rebuilding the vendored models', () => {
    const titleBuild = readFileSync(resolve(process.cwd(), 'title-town/tools/build.sh'), 'utf8');

    expect(titleBuild).not.toContain('rm -rf "$HERE/vendor" "$HERE/models"');
    expect(titleBuild).toContain(
      '"$HERE/models/"{city,cars,roads,suburb,train,industrial,castle,minidungeon,monsters,fx}',
    );
  });
});
