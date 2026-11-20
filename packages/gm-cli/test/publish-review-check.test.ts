import { afterEach, describe, expect, it, vi } from 'vitest';

import { command } from '../src/commands/qa/publish-review-check.js';
import { UsageError } from '../src/command.js';

describe('qa publish-review-check', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('confirms the review round for a build through the local API', async () => {
    const fetch = vi.fn(async () => new Response('{"recorded":true,"roundId":"review-1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const output: string[] = [];
    const context = {
      cwd: '/tmp',
      assetsRoot: null,
      skillsDir: null,
      config: { runtimeDir: '/tmp', verifySoftwareGl: true } as never,
      json: false,
      limit: 10,
      fields: null,
      out: (line: string) => output.push(line),
      err() {},
      emit() {},
      blobRoot: null,
      env: { OGM_INTERNAL_TOKEN: 'secret-token-for-review-test', OGM_API_PORT: '8080' },
      home: '/tmp',
    };
    await command.run(context, ['game', 'build_1'], {});

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/internal/operator/games/game/builds/build_1/prototype-review',
      expect.objectContaining({
        headers: { 'x-ogm-internal': 'secret-token-for-review-test', accept: 'application/json' },
      }),
    );
    expect(output).toEqual(['prototype review review-1 recorded for build_1']);
  });

  it('does not send the internal token to a non-loopback API host', async () => {
    await expect(
      command.run(
        {
          cwd: '/tmp',
          assetsRoot: null,
          skillsDir: null,
          config: { runtimeDir: '/tmp', verifySoftwareGl: true } as never,
          json: false,
          limit: 10,
          fields: null,
          out() {},
          err() {},
          emit() {},
          blobRoot: null,
          env: { OGM_INTERNAL_TOKEN: 'secret', OGM_API_PORT: '8080' },
          home: '/tmp',
        },
        ['game', 'build_1'],
        { api: 'https://example.com' },
      ),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it('reports pending published-build review gaps during a full reconciliation', async () => {
    const fetch = vi.fn(
      async () => new Response('{"gaps":[{"slug":"dusk-helm","buildId":"build_1"}]}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);
    const errors: string[] = [];
    await command.run(
      {
        cwd: '/tmp',
        assetsRoot: null,
        skillsDir: null,
        config: { runtimeDir: '/tmp', verifySoftwareGl: true } as never,
        json: false,
        limit: 10,
        fields: null,
        out() {},
        err: (line: string) => errors.push(line),
        emit() {},
        blobRoot: null,
        env: { OGM_INTERNAL_TOKEN: 'secret-token-for-review-test', OGM_API_PORT: '8080' },
        home: '/tmp',
      },
      [],
      { all: true },
    );

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/internal/operator/prototype-review-gaps',
      expect.anything(),
    );
    expect(errors).toEqual(['prototype review missing for dusk-helm build build_1']);
  });
});
