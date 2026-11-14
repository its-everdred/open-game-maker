import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import { gm, tempDir } from './helpers.js';

it('refuses a sound review containing only an audio file', async () => {
  const root = tempDir('gm-review-post-');
  const file = join(root, 'round.json');
  writeFileSync(
    file,
    JSON.stringify({
      id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
      track: 'sound',
      phase: 'concept',
      category: 'sound',
      ticket: '42',
      sha: 'a'.repeat(40),
      media: [{ kind: 'audio', ref: 'cue.wav' }],
    }),
  );
  const result = await gm(['review', 'post', file], { cwd: root });
  expect(result.code).not.toBe(0);
  expect(result.err.join(' ')).toContain('sound requires a capture clip with audio');
});
