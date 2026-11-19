import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';

import { authClient } from '../lib/api/auth';
import { installFakeAudio } from './audio-mock';

installFakeAudio();

afterEach(async () => {
  cleanup();
  // Nanostores delays session cleanup after the last unsubscribe.
  await vi.waitFor(
    () => expect((authClient.$store.atoms.session as unknown as { active?: boolean }).active).toBeFalsy(),
    { timeout: 3_000 },
  );
});
