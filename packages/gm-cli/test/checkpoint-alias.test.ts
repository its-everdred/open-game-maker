import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

const JOB_ID = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';

function workspace(): string {
  const root = tempDir('gm-checkpoint-alias-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

// `gm checkpoint` became `gm command` (#571). Agents and skills written before the rename keep working for one release,
// and every run tells them the new name so they move over; help shows only the new name.
describe('gm checkpoint alias', () => {
  it('still requests a Command and names the new command', async () => {
    const root = workspace();
    const result = await gm(
      ['checkpoint', 'open', '--job', JOB_ID, '--question', 'Which look?', '--option', 'a=A', '--option', 'b=B'],
      { cwd: root },
    );
    expect(result.code).toBe(0);
    expect(result.err).toEqual(['gm checkpoint open is now gm command request']);
    const line = JSON.parse(readFileSync(join(root, '.gm', 'outbox', 'command.jsonl'), 'utf8').trim()) as {
      type: string;
    };
    expect(line.type).toBe('command.request');
  });

  it('still waits for the answer and names the new command', async () => {
    const root = workspace();
    const inbox = join(root, '.gm', 'inbox', 'commands');
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, 'cp_demo.json'), JSON.stringify({ status: 'answered', option_id: 'b' }));
    expect(await gm(['checkpoint', 'wait', 'cp_demo', '--timeout', '1'], { cwd: root })).toEqual({
      code: 0,
      out: ['b'],
      err: ['gm checkpoint wait is now gm command wait'],
    });
  });

  it('is left out of help', async () => {
    const help = (await gm(['help'])).out.join('\n');
    expect(help).toContain('command request');
    expect(help).not.toContain('checkpoint');
  });
});
