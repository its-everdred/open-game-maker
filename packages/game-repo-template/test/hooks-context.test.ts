import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { renderDaemonFiles } from '../src/index.js';

/*
 * #1311: every turn of a game ticket starts with the game's related approved work in its prompt. aiur builds the prompt
 * after before_run and inlines gm-core from the workspace, so before_run must hand the ticket to `gm context --inject`;
 * a failing or missing gm must never stop the turn.
 */
function beforeRun(gm: string | null, ticket: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ogm-hook-context-'));
  if (gm !== null) {
    mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/.bin/gm'), gm);
    chmodSync(join(dir, 'node_modules/.bin/gm'), 0o755);
  }
  const hook = (parse(renderDaemonFiles().hooks) as { before_run: string }).before_run;
  const result = spawnSync('bash', ['-c', hook], {
    cwd: dir,
    env: { PATH: process.env.PATH, AIUR_HOOK_TICKET_IDENTIFIER: ticket },
    encoding: 'utf8',
  });
  return { dir, status: result.status };
}

describe('before_run related-work injection', () => {
  it('asks gm context to write the ticket’s related work into the workspace skills', () => {
    const { dir, status } = beforeRun('#!/bin/sh\nprintf "%s\\n" "$*" > called\n', '41');
    expect(status).toBe(0);
    expect(readFileSync(join(dir, 'called'), 'utf8')).toBe('context 41 --limit 5 --inject .claude/skills\n');
  });

  it('keeps the turn going when gm context fails or gm is not installed', () => {
    expect(beforeRun('#!/bin/sh\nexit 1\n', '41').status).toBe(0);
    expect(beforeRun(null, '41').status).toBe(0);
  });

  it('never passes a non-numeric ticket identifier to gm', () => {
    const { dir, status } = beforeRun('#!/bin/sh\ntouch called\n', '41; rm -rf /');
    expect(status).toBe(0);
    expect(() => readFileSync(join(dir, 'called'))).toThrow();
  });
});
