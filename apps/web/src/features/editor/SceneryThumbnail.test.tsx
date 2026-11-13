import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renderModel = vi.hoisted(() => vi.fn());
vi.mock('./scenery-thumbnail-renderer', () => ({ renderSceneryThumbnail: renderModel }));
import { SceneryThumbnail } from './SceneryThumbnail';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('SceneryThumbnail', () => {
  it('waits until the item enters the viewport before loading its model', async () => {
    let notify!: IntersectionObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    renderModel.mockResolvedValue('data:image/png;base64,YQ==');
    render(<SceneryThumbnail url="/locked/tree.glb" />);
    expect(renderModel).not.toHaveBeenCalled();
    notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await waitFor(() => expect(renderModel).toHaveBeenCalledOnce());
    expect(disconnect).toHaveBeenCalled();
  });
  it('renders the locked model thumbnail when the palette item is visible', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    renderModel.mockResolvedValue('data:image/png;base64,YQ==');
    render(<SceneryThumbnail url="/locked/tree.glb" />);
    await waitFor(() => expect(screen.getByRole('presentation')).toHaveAttribute('src', 'data:image/png;base64,YQ=='));
    expect(renderModel).toHaveBeenCalledWith('/locked/tree.glb');
  });
});
