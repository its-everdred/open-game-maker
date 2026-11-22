import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RoundMedia } from './RoundMedia';

// The creator judges cost and provenance at a glance, so each image or clip says how it was made.
it('shows how each still and clip was made under it', () => {
  render(
    <RoundMedia
      media={[
        { kind: 'still', url: '/target.png', role: 'target', meta: { kind: 'pack original', cost_usd: null } },
        { kind: 'clip', url: '/clip.mp4', meta: { kind: 'in-game capture', tool: 'playwright' } },
        { kind: 'audio', url: '/sound.mp3' },
      ]}
    />,
  );
  expect(screen.getByText('pack original · free')).toBeVisible();
  expect(screen.getByText('in-game capture · playwright')).toBeVisible();
});
