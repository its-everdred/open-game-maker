import { describe, expect, it, vi } from 'vitest';

import { mountStagePreview } from './stage-preview';

describe('stage preview', () => {
  it('shows a visual stage and disposes it', () => {
    const container = document.createElement('div');
    const onState = vi.fn();
    const controller = mountStagePreview(
      container,
      { kind: 'image', url: 'https://example.test/concept.webp' },
      onState,
    );
    expect(container.querySelector('img')?.src).toBe('https://example.test/concept.webp');
    expect(onState).toHaveBeenCalledWith(
      expect.objectContaining({
        bridgeState: 'ready',
        manifest: expect.objectContaining({ palette: { categories: [], items: [] } }),
      }),
    );
    controller.dispose();
    expect(container.children).toHaveLength(0);
  });
  it('plays a rendered clip with its poster', () => {
    const container = document.createElement('div');
    const controller = mountStagePreview(
      container,
      { kind: 'clip', url: 'https://example.test/clip.mp4', poster: 'https://example.test/poster.webp' },
      vi.fn(),
    );
    const video = container.querySelector('video');
    expect(video?.src).toBe('https://example.test/clip.mp4');
    expect(video?.poster).toBe('https://example.test/poster.webp');
    expect(video?.loop).toBe(true);
    controller.dispose();
    expect(container.children).toHaveLength(0);
  });
});
