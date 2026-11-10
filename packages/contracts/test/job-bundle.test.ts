import { describe, expect, it } from 'vitest';

import { JobBundle } from '../src/job-bundle.js';

const base = {
  v: 1,
  jobId: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  gameId: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  repo: 'everdred-games/gm-g_01J',
  kind: 'scope',
  skillPackVersion: '1.2.0',
  skillPackUrl: 'http://127.0.0.1:8443/internal/skills/1.2.0.tgz',
  gameContext: {
    title: 'Castle',
    family: 'Weavers',
    pov: 'side',
    genre: 'platformer',
    multiplayer: false,
    allowAiGeneratedAssets: true,
    paidApisDuringGameplay: false,
    branch: 'main',
    lockfilePath: 'assets.lock.json',
  },
} as const;

const attachment = {
  kind: 'text',
  name: 'level-ideas.md',
  blob: 'a_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e20',
  bytes: 412,
  message_id: 'm_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e11',
  path: '.gm/inbox/attachments/a_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e20-level-ideas.md',
} as const;

describe('job bundle attachments', () => {
  it('lists an image and a markdown file the creator attached', () => {
    const image = {
      ...attachment,
      kind: 'image',
      name: 'castle.png',
      blob: 'a_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e21',
      path: '.gm/inbox/attachments/a_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e21-castle.webp',
    };
    expect(JobBundle.parse({ ...base, attachments: [attachment, image] }).attachments).toHaveLength(2);
  });

  // The hook writes each file to `path` before the sandbox starts, so a path outside the inbox would let a bundle place
  // files anywhere in the game repository.
  it.each([
    '../secrets.md',
    '.gm/inbox/attachments/..',
    '.gm/inbox/attachments/../../AGENTS.md',
    'src/main.ts',
    '.gm/inbox/attachments/a/b.md',
  ])('refuses the path %s', (path) => {
    expect(JobBundle.safeParse({ ...base, attachments: [{ ...attachment, path }] }).success).toBe(false);
  });
});
