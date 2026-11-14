import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { expect, it } from 'vitest';
import { scanPreviewRelay } from '../../src/previews/relay.js';
import { ids, REPO, world } from '../builds/fixtures.js';

it('accepts only the granted ticket for a worker review submission', async () => {
  const { deps } = world();
  const home = mkdtempSync(join(tmpdir(), 'review-relay-'));
  try {
    const workspace = join(home, 'workspace');
    mkdirSync(join(workspace, 'games/castle-game/review/tracks'), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', workspace, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args])
        .toString()
        .trim();
    git('init', '-q');
    git('remote', 'add', 'origin', `https://github.com/${REPO}.git`);
    writeFileSync(
      join(workspace, 'games/castle-game/review/tracks/art.json'),
      JSON.stringify({ id: 'art', category: 'art', phases: [{ id: 'concept', ticket: '12', template: 'art' }] }),
    );
    git('add', 'games');
    git('commit', '-qm', 'track');
    const sha = git('rev-parse', 'HEAD');
    const [owner, repo] = REPO.split('/');
    deps.db
      .update(schema.games)
      .set({ githubOwner: owner, githubRepo: repo })
      .where(eq(schema.games.id, ids.game))
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'shared-repo-daemon',
        repo: REPO,
        checkoutPath: workspace,
        unit: 'fixture',
        envFile: '/fixture',
        port: 12345,
        status: 'running',
        createdAt: '2026-01-01T00:00:00Z',
      })
      .run();
    const hook = fileURLToPath(new URL('../../../../scripts/preview/repository-hook.ts', import.meta.url));
    const bin = join(home, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho '{"state":"open","labels":[{"name":"game:castle-game"}]}'\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    execFileSync(process.execPath, [hook, 'create'], {
      cwd: workspace,
      env: {
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        AIUR_HOOK_TICKET_IDENTIFIER: '12',
        THIS_REPOSITORY_URL: `https://github.com/${REPO}.git`,
      },
    });
    const token = (JSON.parse(readFileSync(join(workspace, '.gm/context/preview.json'), 'utf8')) as { token: string })
      .token;
    const dir = join(workspace, '.gm/preview');
    mkdirSync(dir);
    const image = readFileSync(new URL('../build-chat/fixtures/tiny.png', import.meta.url));
    const submission = {
      id: randomUUID(),
      track: 'art',
      phase: 'concept',
      category: 'art',
      ticket: '12',
      sha,
      media: [{ kind: 'still', ref: `sha256:${createHash('sha256').update(image).digest('hex')}` }],
    };
    const send = async (ticket: string, submitted = submission, media = image, extra?: Buffer) => {
      const id = randomUUID();
      writeFileSync(join(dir, `${id}.0.media`), media);
      if (extra) writeFileSync(join(dir, `${id}.1.media`), extra);
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({
          state: 'pending',
          kind: 'review',
          token,
          ticket,
          slug: 'castle-game',
          sha,
          branch: 'main',
          submission: submitted,
          attachments: [{ index: 0, mime: 'image/png' }, ...(extra ? [{ index: 1, mime: 'image/png' }] : [])],
        }),
      );
      await scanPreviewRelay(deps, home, async () => true);
      return JSON.parse(readFileSync(join(dir, `${id}.response`), 'utf8')) as { state: string; id?: string };
    };
    expect(await send('13')).toMatchObject({ state: 'failed' });
    expect(await send('12', { ...submission, ticket: '13' })).toMatchObject({ state: 'failed' });
    expect(await send('12', submission, Buffer.from('tampered'))).toMatchObject({ state: 'failed' });
    const limit = deps.config.blobPutMaxBytes;
    deps.config.blobPutMaxBytes = image.length - 1;
    expect(await send('12')).toMatchObject({ state: 'failed' });
    expect(await deps.blobStore.head(submission.media[0]!.ref as `sha256:${string}`)).toBeNull();
    deps.config.blobPutMaxBytes = limit;
    const collision = Buffer.concat([image, Buffer.from('collision')]);
    const collisionRef = (await deps.blobStore.put(collision, 'video/mp4')).hash;
    const fresh = Buffer.concat([image, Buffer.from('fresh')]);
    const freshRef = `sha256:${createHash('sha256').update(fresh).digest('hex')}` as const;
    expect(
      await send(
        '12',
        {
          ...submission,
          media: [
            { kind: 'still', ref: collisionRef },
            { kind: 'still', ref: freshRef },
          ],
        },
        collision,
        fresh,
      ),
    ).toMatchObject({ state: 'failed' });
    expect(await deps.blobStore.head(freshRef)).toBeNull();
    expect(await send('12')).toMatchObject({ state: 'done', id: submission.id });
    expect(await deps.blobStore.head(submission.media[0]!.ref as `sha256:${string}`)).not.toBeNull();
    expect(deps.db.select().from(schema.reviewRounds).all()).toHaveLength(1);
    const bad = Buffer.from('invalid image');
    const badRef = `sha256:${createHash('sha256').update(bad).digest('hex')}` as const;
    expect(
      await send('12', { ...submission, id: randomUUID(), media: [{ kind: 'still', ref: badRef }] }, bad),
    ).toMatchObject({ state: 'failed' });
    expect(await deps.blobStore.head(badRef)).toBeNull();
    const altered = Buffer.concat([image, Buffer.from('different')]);
    const alteredRef = `sha256:${createHash('sha256').update(altered).digest('hex')}` as const;
    expect(await send('12', { ...submission, media: [{ kind: 'still', ref: alteredRef }] }, altered)).toMatchObject({
      state: 'failed',
    });
    expect(await deps.blobStore.head(alteredRef)).toBeNull();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
