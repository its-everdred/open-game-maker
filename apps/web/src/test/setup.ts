import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';

import { installFakeAudio } from './audio-mock';

installFakeAudio();

// Some web suites run in Node rather than jsdom.
const authClient = typeof window === 'undefined' ? null : (await import('../lib/api/auth')).authClient;

afterEach(async () => {
  if (!authClient) return;
  cleanup();
  // Nanostores delays session cleanup after the last unsubscribe.
  await vi.waitFor(
    () => expect((authClient.$store.atoms.session as unknown as { active?: boolean }).active).toBeFalsy(),
    { timeout: 3_000 },
  );
});
