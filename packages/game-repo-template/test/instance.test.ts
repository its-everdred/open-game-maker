import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { renderInstanceTemplate } from '../src/index.js';

function file(path: string): string {
  const rendered = renderInstanceTemplate().files.find((entry) => entry.path === path);
  expect(rendered, path).toBeDefined();
  return rendered!.content;
}

describe('renderInstanceTemplate', () => {
  it('renders the instance monorepo workspace and documentation', () => {
    const paths = renderInstanceTemplate().files.map((entry) => entry.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml',
        '.gitignore',
        'README.md',
        'games/README.md',
        'package.json',
        'packages/README.md',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'tsconfig.base.json',
      ]),
    );

    const workspace = parse(file('pnpm-workspace.yaml')) as { packages: string[] };
    expect(workspace.packages).toEqual(['games/*', 'packages/*']);
    expect(JSON.parse(file('package.json'))).toMatchObject({
      private: true,
      gameMaker: { instance: true },
      packageManager: 'pnpm@10.33.0',
    });
  });

  it('keeps asset bytes out of git while retaining asset references', () => {
    const ignore = file('.gitignore').split('\n');
    expect(ignore).toEqual(expect.arrayContaining(['*.glb', '*.mp3', '*.png', '!**/assets.lock.json']));
    expect(file('games/README.md')).toContain('assets.lock.json');
  });

  // Review evidence a PR links must be committable, or it lives only in the worker's workspace and dies with it.
  it('lets review sheets be committed while other images stay ignored', () => {
    const root = mkdtempSync(join(tmpdir(), 'instance-ignore-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), file('.gitignore'));
    const ignored = (path: string) => {
      try {
        execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: root });
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored('games/blobs/review/208/sheet-390x844.png')).toBe(false);
    expect(ignored('games/blobs/shots/tablet/t2.png')).toBe(true);
    expect(ignored('assets-local/review/blobs/208/sheet-390x844.png')).toBe(true);
  });

  it('runs only changed workspace packages on pull requests', () => {
    const workflow = parse(file('.github/workflows/ci.yml')) as {
      jobs: { required: { steps: Array<{ run?: string }> } };
    };
    const runs = workflow.jobs.required.steps.flatMap((step) => (step.run ? [step.run] : []));
    expect(runs).toContain('pnpm install --frozen-lockfile');
    for (const command of ['typecheck', 'test', 'build']) {
      expect(runs).toContain(
        `base="${'${{ github.event.pull_request.base.sha }}'}"\nif [[ "$GITHUB_EVENT_NAME" == "pull_request" ]]; then\n  pnpm --filter "...[$base]" --if-present run ${command}\nelse\n  pnpm -r --if-present run ${command}\nfi\n`,
      );
    }
  });

  it('is deterministic', () => {
    expect(renderInstanceTemplate()).toEqual(renderInstanceTemplate());
  });
});
