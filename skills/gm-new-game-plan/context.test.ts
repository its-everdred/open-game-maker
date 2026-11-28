import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('planner context relay', () => {
  it('retrieves context and attachments without network and keeps them private', async () => {
    const root = mkdtempSync(join(tmpdir(), 'planner-context-'));
    try {
      execFileSync('git', ['-C', root, 'init', '-q']);
      execFileSync('git', [
        '-C',
        root,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '--allow-empty',
        '-qm',
        'fixture',
      ]);
      mkdirSync(join(root, '.gm/context'), { recursive: true });
      mkdirSync(join(root, '.gm/preview'));
      mkdirSync(join(root, 'scratch'));
      writeFileSync(join(root, '.gm/context/preview.json'), JSON.stringify({ token: 'fixture-token' }));
      const script = fileURLToPath(new URL('./scripts/context.mjs', import.meta.url));
      const child = spawn(process.execPath, [script, '12', 'castle-game'], {
        cwd: root,
        env: { ...process.env, TMPDIR: join(root, 'scratch') },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let stderr = '';
      child.stdout.on('data', (part) => {
        output += String(part);
      });
      child.stderr.on('data', (part) => {
        stderr += String(part);
      });
      const completed = new Promise<number | null>((resolve) => child.on('close', resolve));
      const directory = join(root, '.gm/preview');
      const seen = new Set<string>();
      const deadline = Date.now() + 30_000;
      while (seen.size < 2 && Date.now() < deadline) {
        for (const name of readdirSync(directory).filter((item) => item.endsWith('.json') && !seen.has(item))) {
          const request = JSON.parse(readFileSync(join(directory, name), 'utf8')) as {
            kind: string;
            attachment?: string;
          };
          seen.add(name);
          const result =
            request.kind === 'new-game-context'
              ? { request: 'j_1', attachments: [{ id: 'a_1', messageId: 'm_1' }] }
              : { id: request.attachment, data: Buffer.from('private attachment').toString('base64') };
          writeFileSync(
            join(directory, name.replace(/\.json$/, '.response')),
            JSON.stringify({ state: 'done', result }),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(await completed, stderr).toBe(0);
      const contextPath = output.trim();
      const context = JSON.parse(readFileSync(contextPath, 'utf8')) as {
        attachments: { localPath: string; messageId: string }[];
      };
      expect(context.attachments[0]?.messageId).toBe('m_1');
      expect(readFileSync(context.attachments[0]!.localPath, 'utf8')).toBe('private attachment');
      expect(statSync(contextPath).mode & 0o777).toBe(0o600);
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
