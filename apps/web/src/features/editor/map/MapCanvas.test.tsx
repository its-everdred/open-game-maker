// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SceneDoc } from '@ogm/contracts/browser';
import { MapCanvas } from './MapCanvas';
import type { MapPack } from './pack';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('places selected actions above the elevated sprite, not the ground cell', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const doc = { game: 'game', scene: 'scene' } as SceneDoc;
  let elevation = 0;
  const pack = {
    extent: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    cellCenter: () => ({ x: 200, y: 200 }),
    draw: () => [
      {
        unit: 'tile:decor:1,1',
        asset: 'post',
        facing: 'E',
        center: { x: 200, y: 200 - elevation },
        anchorY: 208,
        scale: 0.4,
      },
    ],
  } as unknown as MapPack;
  const canvas = () => (
    <MapCanvas
      doc={doc}
      pack={pack}
      sprites={{}}
      selected={{ layer: 'decor', cell: '1,1' }}
      inset={{ top: 0, bottom: 0 }}
      onPress={() => 'pan'}
      onDrag={() => {}}
      onRelease={() => {}}
      onCancel={() => {}}
      onHover={() => {}}
    >
      <button>Actions</button>
    </MapCanvas>
  );
  const result = render(canvas());
  const handle = screen.getByRole('button', { name: 'Actions' }).parentElement!;
  const initial = parseFloat(handle.style.top);
  elevation = 32;
  result.rerender(canvas());
  expect(parseFloat(handle.style.top)).toBeCloseTo(initial - 32 * 0.94);
});
