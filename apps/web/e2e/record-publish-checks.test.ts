import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { env } from 'node:process';
import { expect, it } from 'vitest';

it('posts app evidence to the local API with the internal credential', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-check-record-'));
  let received: { token: string | undefined; body: string } | undefined;
  let failures = 1;
  const delivered: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received = {
        token: request.headers['x-ogm-internal'] as string | undefined,
        body: Buffer.concat(chunks).toString(),
      };
      delivered.push(received.body);
      if (failures-- > 0) return response.writeHead(503).end();
      response.writeHead(request.url === '/internal/operator/app/publish-checks' ? 201 : 404).end();
    });
  });
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    const payload = {
      gitSha: 'a'.repeat(40),
      surface: 'app',
      attemptedAt: '2026-11-27T00:00:00.000Z',
      checks: [{ name: 'load-check', result: 'passed' }],
    };
    await writeFile(join(dir, 'record.json'), JSON.stringify(payload));
    await writeFile(join(dir, 'api.env'), `OGM_API_PORT=${address.port}\nOGM_INTERNAL_TOKEN=local-test-token\n`);
    const run = () =>
      new Promise<number | null>((done, reject) => {
        const child = spawn(process.execPath, [resolve('tools/record-publish-checks.mjs'), join(dir, 'record.json')], {
          env: { ...env, OGM_ENV_DIR: dir, HOME: dir, OGM_API_PORT: '', OGM_INTERNAL_TOKEN: '' },
          stdio: 'ignore',
        });
        child.on('error', reject);
        child.on('exit', done);
      });
    expect(await run()).toBe(1);
    expect(await readdir(join(dir, '.local/state/ogm/app-publish-checks'))).toHaveLength(1);
    expect(await run()).toBe(0);
    expect(await readdir(join(dir, '.local/state/ogm/app-publish-checks'))).toHaveLength(0);
    expect(delivered).toHaveLength(3);
    expect(delivered.slice(1).some((body) => JSON.parse(body).recordId === JSON.parse(delivered[0]!).recordId)).toBe(
      true,
    );
    expect(received?.token).toBe('local-test-token');
    expect(JSON.parse(received!.body)).toEqual({ ...payload, recordId: expect.any(String) });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  }
});
