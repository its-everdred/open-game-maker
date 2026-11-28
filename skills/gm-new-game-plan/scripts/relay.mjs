import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers';

export function plannerRelay(ticket, slug) {
  if (!/^[1-9]\d{0,15}$/.test(ticket ?? '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? ''))
    throw new Error('invalid planner ticket or game slug');
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const { token } = JSON.parse(readFileSync(join(root, '.gm/context/preview.json'), 'utf8'));
  const dir = join(root, '.gm/preview');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return async (kind, payload = {}) => {
    const name = randomUUID();
    const request = join(dir, `${name}.json`);
    const response = join(dir, `${name}.response`);
    try {
      writeFileSync(`${request}.tmp`, JSON.stringify({ state: 'pending', token, ticket, slug, sha, branch: 'main', kind, ...payload }), { mode: 0o600, flag: 'wx' });
      renameSync(`${request}.tmp`, request);
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        let result;
        try { result = JSON.parse(readFileSync(response, 'utf8')); } catch { continue; }
        if (result.state === 'failed') throw new Error(result.error || 'host refused planner request');
        if (result.state === 'done') return result.result;
      }
      throw new Error('host planner request timed out');
    } finally {
      rmSync(`${request}.tmp`, { force: true });
      rmSync(request, { force: true });
      rmSync(response, { force: true });
    }
  };
}
