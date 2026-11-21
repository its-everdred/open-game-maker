import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MediaMeta } from './MediaMeta';

describe('MediaMeta', () => {
  it('renders generated image provenance and free pack originals', () => {
    const { rerender } = render(
      <MediaMeta
        meta={{
          kind: 'image generation',
          model: 'gpt-image-1',
          cost_usd: 0.04,
          skill: 'gm-image-mock',
          tool: 'route_media',
          created_at: '2026-11-21T10:02:00Z',
          ai_generated: true,
        }}
      />,
    );
    expect(
      screen.getByText('image generation · gpt-image-1 · $0.04 · gm-image-mock · route_media · 10:02 · AI'),
    ).toBeTruthy();
    rerender(<MediaMeta meta={{ kind: 'pack original', cost_usd: null }} />);
    expect(screen.getByText('pack original · free')).toBeTruthy();
  });
});
