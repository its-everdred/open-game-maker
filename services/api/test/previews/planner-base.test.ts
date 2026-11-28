import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { plannerBaseVerifier } from '../../src/previews/planner-base.js';

it('accepts only the clean pushed planner checkpoint containing a valid inventory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogm-planner-base-'));
  try {
    execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'aiur/42']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Fixture']);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'fixture@example.test']);
    mkdirSync(join(dir, 'games/castle/docs'), { recursive: true });
    writeFileSync(join(dir, 'games/castle/docs/decisions.json'), '[]\n');
    execFileSync('git', ['-C', dir, 'add', 'games/castle/docs/decisions.json']);
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'inventory']);
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    let retained = false;
    let inventory = '[]\n';
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith('/git/refs') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ ref: `refs/heads/ogm/planner-checkpoints/${sha}`, sha });
        retained = true;
        return new Response('{}', { status: 201 });
      }
      if (value.includes('ogm%2Fplanner-checkpoints%2F') && !retained) return new Response('', { status: 404 });
      const body = value.includes('/git/ref/')
        ? { object: { sha } }
        : value.includes('/compare/')
          ? { status: 'ahead' }
          : {
              type: 'file',
              encoding: 'base64',
              size: Buffer.byteLength(inventory),
              content: Buffer.from(inventory).toString('base64'),
            };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const verify = plannerBaseVerifier('fixture-token', fetcher as typeof fetch);
    expect(await verify('owner/game', dir, 'castle', { branch: 'aiur/42', sha }, [])).toBe(true);
    expect(retained).toBe(true);
    expect(await verify('owner/game', dir, 'castle', { branch: 'aiur/42', sha }, ['missing'])).toBe(false);
    const question = {
      id: 'D-01',
      area: 'World',
      question: 'Which world?',
      why: 'Choose',
      options: [
        { label: 'A', media_needed: 'image' },
        { label: 'B', media_needed: 'image' },
      ],
      recommendation: 'A: preferred',
      sources: [],
      ticket: null,
      status: 'open',
      answer: null,
      answered_at: null,
    };
    inventory = JSON.stringify([question, { ...question, id: 'D-02', area: 'world', question: 'WHICH WORLD?' }]);
    expect(await verify('owner/game', dir, 'castle', { branch: 'aiur/42', sha }, [])).toBe(false);
    inventory = '[]\n';
    expect(await verify('owner/game', dir, 'castle', { branch: 'aiur/other', sha }, [])).toBe(false);
    mkdirSync(join(dir, 'games/castle/design'), { recursive: true });
    writeFileSync(join(dir, 'games/castle/design/decisions.json'), '[]\n');
    expect(await verify('owner/game', dir, 'castle', { branch: 'aiur/42', sha }, [])).toBe(false);
    rmSync(join(dir, 'games/castle/design/decisions.json'));
    writeFileSync(join(dir, 'games/castle/docs/decisions.json'), '[{}]\n');
    expect(await verify('owner/game', dir, 'castle', { branch: 'aiur/42', sha }, [])).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
