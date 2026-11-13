import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OgmHost } from '../../app/testHook';
import { GameMenuProvider, useGameMenu } from '../../app/GameMenu';

type MockFrameState = {
  bridgeState: 'connecting' | 'ready' | 'error';
  dropped: number;
  manifest?: unknown;
  error?: string;
  errorCode?: string;
  load?: { phase: 'boot' | 'ready' | 'stream'; loaded: number; total: number; done: boolean };
};

type MockMountOptions = {
  onSaveWrite?(payload: { saveSchemaVersion: number; data: unknown }): void;
  onState?(state: MockFrameState): void;
  onLoadDone?(measurement: { ms: number; fetchedBytes: number; cachedBytes: number }): void;
  onLoadStalled?(measurement: { ms: number; fetchedBytes: number; cachedBytes: number }): void;
};

const editorApi = vi.hoisted(() => ({
  NO_BUILD_ID: 'build_00000000000000000000000000',
  acquireLease: vi.fn(),
  getDesignSnapshot: vi.fn(),
  getGame: vi.fn(),
  getFallbackPalette: vi.fn(),
  getEditorPreviews: vi.fn(),
  getEditorStage: vi.fn(),
  getPreviewDesign: vi.fn(),
  getScenerySource: vi.fn(),
  getOptionalPublished: vi.fn(),
  getOptionalReapply: vi.fn(),
  getOptionalSaves: vi.fn(),
  getSave: vi.fn(),
  heartbeatLease: vi.fn(),
  listJobs: vi.fn(),
  openTransactionStream: vi.fn(),
  postTransaction: vi.fn(),
  postAnalyticsEvent: vi.fn(),
  putSave: vi.fn(),
  releaseLease: vi.fn(),
  submitReapply: vi.fn(),
}));

const host = vi.hoisted(() => {
  const controller = {
    applyDesign: vi.fn(),
    camera: vi.fn(),
    dispose: vi.fn(),
    onEvent: vi.fn(() => vi.fn()),
    onPicked: vi.fn(() => vi.fn()),
    onSaveLoadError: vi.fn(() => vi.fn()),
    onSaveWrite: vi.fn((callback: (save: unknown) => void) => {
      void callback;
      return vi.fn();
    }),
    onScreen: vi.fn(() => vi.fn()),
    pick: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    select: vi.fn(),
    sendRoomMessage: vi.fn(),
    setMode: vi.fn(),
    setSettings: vi.fn(),
    validatePlacement: vi.fn().mockResolvedValue({ ok: true }),
    state: vi.fn(() => ({ bridgeState: 'connecting' as const, dropped: 0 })),
  };
  return {
    controller,
    mountGameFrame: vi.fn((options?: MockMountOptions) => {
      void options;
      return controller;
    }),
  };
});

vi.mock('../../features/editor/api', () => editorApi);
const branchList = vi.hoisted(() => ({ value: undefined as Array<{ id: string; name: string }> | undefined }));
vi.mock('../games/useBranches', () => ({ useBranches: () => ({ data: branchList.value }) }));
vi.mock('../../features/editor/frame', () => host);
const preview = vi.hoisted(() => ({ mountSceneryPreview: vi.fn() }));
vi.mock('../../features/editor/scenery-preview', () => preview);
const fallbackAdmission = vi.hoisted(() => ({ admitJob: vi.fn() }));
vi.mock('../../features/scope-chat/admit', () => fallbackAdmission);

import { useDock } from '../../features/build-chat/dock';
import { GameScreen } from './GameScreen';

function GameMenuProbe() {
  const { controls, open, setOpen } = useGameMenu();
  return (
    <aside data-testid="game-menu-probe">
      {controls?.button ? <span data-testid="menu-theme">{JSON.stringify(controls.button)}</span> : null}
      <button type="button" aria-label="Menu" onClick={() => setOpen(!open)} />
      {open && controls ? (
        <div role="group" aria-label="Menu">
          {controls.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              aria-label={action.label}
              disabled={action.disabled}
              onClick={action.onSelect}
            />
          ))}
          {controls.extras}
        </div>
      ) : null}
    </aside>
  );
}

function renderGame(entry = '/g/game') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <GameMenuProvider>
          <GameMenuProbe />
          <Routes>
            <Route path="/g/:gameId" element={<GameScreen />} />
            <Route path="/all" element={<h1>Games destination</h1>} />
          </Routes>
        </GameMenuProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function readyPlayFrame(playMenuButton?: { colour: string; icon: 'pause' | 'menu' }) {
  await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalled());
  act(() => {
    host.mountGameFrame.mock.calls.at(-1)?.[0]?.onState?.({
      bridgeState: 'ready',
      dropped: 0,
      manifest: {
        id: 'cellar',
        sdk: '^1',
        title: 'Goblin Cellar',
        playMenuButton,
        inputs: { actions: {} },
        presentation: { orientation: 'any', minLogical: { w: 320, h: 180 }, fit: 'responsive' },
        view: 'main',
        dimension: '2d',
        capabilities: [],
        palette: { categories: [], items: [] },
        tools: [],
        gizmos: {},
        saves: false,
        overrides: { aliases: {}, retired: [] },
      },
    });
  });
  await waitFor(() => expect(host.controller.setSettings).toHaveBeenCalled());
}

beforeEach(() => {
  branchList.value = undefined;
  preview.mountSceneryPreview.mockReturnValue(host.controller);
  useDock.getState().reset();
  editorApi.getGame.mockResolvedValue({ id: 'game', title: 'Goblin Cellar' });
  editorApi.getFallbackPalette.mockResolvedValue({ mode: 'request', palette: { categories: [], items: [] } });
  editorApi.getEditorPreviews.mockResolvedValue({ previews: [] });
  editorApi.getEditorStage.mockResolvedValue({ stage: null });
  editorApi.getScenerySource.mockRejectedValue(new Error('unavailable'));
  editorApi.getPreviewDesign.mockResolvedValue({ rev: 0, doc: { schemaVersion: 1, globals: {}, entities: {} } });
  fallbackAdmission.admitJob.mockResolvedValue({ kind: 'accepted', jobId: 'job' });
  editorApi.getOptionalPublished.mockResolvedValue({ available: false });
  editorApi.listJobs.mockResolvedValue({ jobs: [] });
  editorApi.getDesignSnapshot.mockResolvedValue({
    rev: 4,
    buildId: 'build',
    doc: { schemaVersion: 1, globals: {}, entities: {} },
  });
  editorApi.acquireLease.mockResolvedValue({
    ok: true,
    lease: { token: 3, expiresAt: '2026-11-02T03:00:00.000Z' },
  });
  editorApi.heartbeatLease.mockResolvedValue({
    ok: true,
    lease: { token: 3, expiresAt: '2026-11-02T03:01:00.000Z' },
  });
  editorApi.releaseLease.mockResolvedValue({
    ok: true,
    lease: { token: 3, expiresAt: '2026-11-02T03:01:00.000Z' },
  });
  editorApi.postTransaction.mockResolvedValue({ ok: true, rev: 5 });
  editorApi.postAnalyticsEvent.mockResolvedValue({ accepted: 1, rejected: [] });
  editorApi.openTransactionStream.mockReturnValue({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    close: vi.fn(),
  });
  host.controller.state.mockReturnValue({ bridgeState: 'connecting', dropped: 0 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.__ogmHost;
});

describe('GameScreen', () => {
  it('offers an icon-only play control and keeps editor navigation in the menu', async () => {
    const { container } = renderGame('/g/game?mode=edit');
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalled());
    expect(container.querySelector('.play-bar')).not.toBeInTheDocument();
    const play = screen.getByRole('button', { name: 'Play' });
    expect(play.closest('[data-focus-zone]')).toHaveAttribute('data-focus-zone', 'editor-bar');
    expect(play.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Games' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ask for a change' })).toBeVisible();
    fireEvent.click(play);
    await waitFor(() => expect(container.querySelector('.game-screen.is-playing')).toBeVisible());
  });
  it('advances from an approved concept to a populated scenery diorama', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getEditorStage.mockResolvedValue({ stage: { kind: 'image', url: 'https://example.test/concept.webp' } });
    editorApi.getScenerySource.mockResolvedValue({
      scene: {
        version: 1,
        items: [
          {
            id: 'tree',
            assetId: 't3:fixture/tree',
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            layer: 'mid',
          },
        ],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      },
      assets: [],
    });
    renderGame('/g/game?mode=edit');
    await waitFor(() => expect(preview.mountSceneryPreview).toHaveBeenCalled());
  });
  it('shows a newer replacement concept instead of an older diorama', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getEditorStage.mockResolvedValue({
      stage: { kind: 'image', url: 'https://example.test/new.webp', at: '2026-11-13T12:00:00Z' },
    });
    editorApi.getScenerySource.mockResolvedValue({
      updatedAt: '2026-11-12T12:00:00Z',
      scene: {
        version: 1,
        items: [
          {
            id: 'tree',
            assetId: 't3:fixture/tree',
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            layer: 'mid',
          },
        ],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      },
      assets: [],
    });
    const view = renderGame('/g/game?mode=edit');
    await waitFor(() =>
      expect(view.container.querySelector('img[src="https://example.test/new.webp"]')).not.toBeNull(),
    );
    expect(preview.mountSceneryPreview).not.toHaveBeenCalled();
  });
  it('refreshes the scenery when it arrives while the concept is already open', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getEditorStage.mockResolvedValue({ stage: { kind: 'image', url: 'https://example.test/concept.webp' } });
    const scene = {
      version: 1,
      items: [],
      terrain: [],
      lighting: 'warm-forest',
      camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
    };
    editorApi.getScenerySource.mockResolvedValueOnce({ scene, assets: [] }).mockResolvedValue({
      scene: {
        ...scene,
        items: [
          {
            id: 'tree',
            assetId: 't3:fixture/tree',
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            layer: 'mid',
          },
        ],
      },
      assets: [],
    });
    const view = renderGame('/g/game?mode=edit');
    await waitFor(() =>
      expect(view.container.querySelector('img[src="https://example.test/concept.webp"]')).not.toBeNull(),
    );
    await waitFor(() => expect(preview.mountSceneryPreview).toHaveBeenCalled(), { timeout: 8_000 });
  }, 15_000);
  it('shows a concept and sends a scope placement as a request before any build', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getEditorStage.mockResolvedValue({ stage: { kind: 'image', url: 'https://example.test/concept.webp' } });
    editorApi.getFallbackPalette.mockResolvedValue({
      mode: 'request',
      palette: {
        categories: [{ id: 'scenery', label: 'Scenery', kind: 'items' }],
        items: [{ prefab: 'scope:0', label: 'Forest trees', category: 'scenery' }],
      },
    });
    const view = renderGame('/g/game?mode=edit');
    await waitFor(() =>
      expect(view.container.querySelector('img[src="https://example.test/concept.webp"]')).not.toBeNull(),
    );
    const image = view.container.querySelector('img[src="https://example.test/concept.webp"]')!;
    Object.defineProperties(image, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 100 } as DOMRect);
    await waitFor(() => expect(editorApi.getFallbackPalette).toHaveBeenCalled());
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Forest trees' }, { timeout: 5_000 }), {
      pointerId: 1,
    });
    const canvas = await screen.findByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 25, clientY: 50, pointerId: 2 });
    fireEvent.pointerUp(canvas, { clientX: 25, clientY: 50, pointerId: 2 });
    await waitFor(() => expect(fallbackAdmission.admitJob).toHaveBeenCalledOnce());
    expect(editorApi.postTransaction).not.toHaveBeenCalled();
  });
  it('uses an unmerged playable preview when no released build exists', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getEditorPreviews.mockResolvedValue({
      previews: [
        { ticket: '12', branchId: 'main', buildId: 'preview-1', accessId: 'pv-1', createdAt: '2026-11-13T00:00:00Z' },
      ],
    });
    renderGame('/g/game?mode=edit');
    await waitFor(() =>
      expect(host.mountGameFrame).toHaveBeenCalledWith(expect.objectContaining({ buildId: 'pv-1', preview: true })),
    );
    expect(editorApi.getPreviewDesign).toHaveBeenCalledWith('game', '12', 'preview-1');
    expect(preview.mountSceneryPreview).not.toHaveBeenCalled();
    act(() =>
      host.mountGameFrame.mock.calls.at(-1)?.[0]?.onState?.({
        bridgeState: 'ready',
        dropped: 0,
        manifest: {
          id: 'game',
          capabilities: [],
          palette: {
            categories: [{ id: 'actors', label: 'Actors', kind: 'items' }],
            items: [{ prefab: 'skeleton', label: 'Skeleton', category: 'actors' }],
          },
          tools: ['place'],
          gizmos: {},
          presentation: { minLogical: { w: 100, h: 100 } },
          dimension: '2d',
          view: 'main',
          saves: false,
        },
      }),
    );
    const item = await screen.findByRole('button', { name: 'Skeleton' });
    fireEvent.pointerDown(item, { pointerId: 1 });
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 25, clientY: 50, pointerId: 2 });
    fireEvent.pointerUp(canvas, { clientX: 25, clientY: 50, pointerId: 2 });
    await waitFor(() => expect(fallbackAdmission.admitJob).toHaveBeenCalledOnce());
    expect(editorApi.postTransaction).not.toHaveBeenCalled();
  });
  it('does not show a preview belonging to a different branch', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getEditorPreviews.mockResolvedValue({
      previews: [
        { ticket: '12', branchId: 'other', buildId: 'preview-1', accessId: 'pv-1', createdAt: '2026-11-13T00:00:00Z' },
      ],
    });
    editorApi.getEditorStage.mockResolvedValue({ stage: { kind: 'image', url: 'https://example.test/concept.webp' } });
    const view = renderGame('/g/game?mode=edit');
    await waitFor(() =>
      expect(view.container.querySelector('img[src="https://example.test/concept.webp"]')).not.toBeNull(),
    );
    expect(host.mountGameFrame).not.toHaveBeenCalled();
    expect(editorApi.getPreviewDesign).not.toHaveBeenCalled();
  });
  it('requests branch-scoped scenery for an unbuilt side branch', async () => {
    branchList.value = [
      { id: 'b_main', name: 'main' },
      { id: 'b_side', name: 'side' },
    ];
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getEditorStage.mockResolvedValue({ stage: { kind: 'image', url: 'https://example.test/concept.webp' } });
    const view = renderGame('/g/game?v=b_side&mode=edit');
    await waitFor(() =>
      expect(view.container.querySelector('img[src="https://example.test/concept.webp"]')).not.toBeNull(),
    );
    await waitFor(() => expect(editorApi.getScenerySource).toHaveBeenCalledWith('game', 'b_side'));
    expect(preview.mountSceneryPreview).not.toHaveBeenCalled();
  });
  it.each(['t3:fixture/tree', 'scope:0'])(
    'submits fallback item %s as a build request without a design transaction',
    async (prefab) => {
      editorApi.getFallbackPalette.mockResolvedValue({
        mode: 'request',
        palette: {
          categories: [{ id: 'scenery', label: 'Scenery', kind: 'items' }],
          items: [{ prefab, label: 'Tree', category: 'scenery' }],
        },
      });
      renderGame('/g/game?mode=edit');
      await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalled());
      act(() =>
        host.mountGameFrame.mock.calls.at(-1)?.[0]?.onState?.({
          bridgeState: 'ready',
          dropped: 0,
          manifest: {
            id: 'game',
            capabilities: [],
            palette: { categories: [], items: [] },
            tools: [],
            gizmos: {},
            presentation: { minLogical: { w: 100, h: 100 } },
            dimension: '2d',
            view: 'main',
            saves: false,
          },
        }),
      );
      await waitFor(() => expect(editorApi.getFallbackPalette).toHaveBeenCalled());
      const item = await screen.findByRole('button', { name: 'Tree' });
      fireEvent.pointerDown(item, { pointerId: 1 });
      const canvas = await screen.findByLabelText('Editor canvas');
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      } as DOMRect);
      fireEvent.pointerDown(canvas, { clientX: 25, clientY: 50, pointerId: 2 });
      fireEvent.pointerUp(canvas, { clientX: 25, clientY: 50, pointerId: 2 });
      await waitFor(() => expect(fallbackAdmission.admitJob).toHaveBeenCalledOnce());
      expect(fallbackAdmission.admitJob.mock.calls[0]?.[0].plan.summary).toContain(prefab);
      expect(editorApi.postTransaction).not.toHaveBeenCalled();
    },
  );
  it('loads matching scenery thumbnail sources without restarting a running build', async () => {
    let finish!: (value: unknown) => void;
    editorApi.getScenerySource.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderGame('/g/game?mode=edit');
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalledOnce());
    act(() =>
      host.mountGameFrame.mock.calls.at(-1)?.[0]?.onState?.({
        bridgeState: 'ready',
        dropped: 0,
        manifest: {
          capabilities: ['scenery'],
          palette: { categories: [], items: [] },
          tools: [],
          gizmos: {},
          presentation: { minLogical: { w: 640, h: 360 } },
          dimension: '3d',
          view: 'fixed',
        },
      }),
    );
    await waitFor(() => expect(editorApi.getScenerySource).toHaveBeenCalledOnce());
    await act(async () =>
      finish({
        scene: {
          version: 1,
          items: [],
          terrain: [],
          lighting: 'warm-forest',
          camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
        },
        assets: [],
      }),
    );
    expect(host.mountGameFrame).toHaveBeenCalledOnce();
  });
  it('opens no-build scenery without saving a design transaction', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getScenerySource.mockResolvedValue({
      scene: {
        version: 1,
        items: [],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      },
      assets: [],
    });
    renderGame('/g/game?mode=edit');
    await waitFor(() => expect(preview.mountSceneryPreview).toHaveBeenCalled());
    await act(async () => {});
    expect(editorApi.acquireLease).not.toHaveBeenCalled();
    expect(editorApi.postTransaction).not.toHaveBeenCalled();
    expect(host.mountGameFrame).not.toHaveBeenCalled();
  });

  it('requests a scenery placement before a playable build', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getScenerySource.mockResolvedValue({
      scene: {
        version: 1,
        items: [],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      },
      assets: [],
    });
    renderGame('/g/game?mode=edit');
    await waitFor(() => expect(preview.mountSceneryPreview).toHaveBeenCalled());
    act(() =>
      preview.mountSceneryPreview.mock.calls.at(-1)?.[3]({
        bridgeState: 'ready',
        dropped: 0,
        manifest: {
          capabilities: ['scenery'],
          palette: {
            categories: [{ id: 'trees', label: 'Trees', kind: 'items' }],
            items: [{ prefab: 'scenery:t3:fixture/tree', label: 'Tree', category: 'trees' }],
          },
          tools: ['place'],
          gizmos: {},
          presentation: { minLogical: { w: 100, h: 100 } },
          dimension: '3d',
          view: 'fixed',
        },
      }),
    );
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Tree' }), { pointerId: 1 });
    const canvas = await screen.findByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 50, clientY: 50 });
    await waitFor(() => expect(fallbackAdmission.admitJob).toHaveBeenCalledOnce());
    expect(editorApi.postTransaction).not.toHaveBeenCalled();
  });
  it('keeps a long terrain request within the builder field limit', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getScenerySource.mockResolvedValue({
      scene: {
        version: 1,
        items: [],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      },
      assets: [],
    });
    renderGame('/g/game?mode=edit');
    await waitFor(() => expect(preview.mountSceneryPreview).toHaveBeenCalled());
    act(() =>
      preview.mountSceneryPreview.mock.calls.at(-1)?.[3]({
        bridgeState: 'ready',
        dropped: 0,
        manifest: {
          capabilities: ['scenery'],
          palette: {
            categories: [{ id: 'terrain', label: 'Terrain', kind: 'items' }],
            items: [{ prefab: 'scenery-band:path', label: 'Path', category: 'terrain' }],
          },
          tools: ['place'],
          gizmos: {},
          presentation: { minLogical: { w: 100, h: 100 } },
          dimension: '3d',
          view: 'fixed',
        },
      }),
    );
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Path' }), { pointerId: 1 });
    const canvas = await screen.findByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 0, clientY: 0 });
    for (let i = 1; i < 256; i++) fireEvent.pointerMove(canvas, { pointerId: 2, clientX: i / 3, clientY: i / 4 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 100, clientY: 100 });
    await waitFor(() => expect(fallbackAdmission.admitJob).toHaveBeenCalledOnce());
    const request = fallbackAdmission.admitJob.mock.calls[0]![0];
    expect(request.plan.scope.included[0].length).toBeLessThanOrEqual(4000);
    expect(request.plan.tickets[0].acceptanceCriteria[0].length).toBeLessThanOrEqual(4000);
    expect(JSON.stringify(request.plan)).toContain('[1,1]');
  });

  it('requests a lighting change before a playable build', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getScenerySource.mockResolvedValue({
      scene: {
        version: 1,
        items: [],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      },
      assets: [],
    });
    renderGame('/g/game?mode=edit');
    await waitFor(() => expect(preview.mountSceneryPreview).toHaveBeenCalled());
    act(() =>
      preview.mountSceneryPreview.mock.calls.at(-1)?.[3]({
        bridgeState: 'ready',
        dropped: 0,
        manifest: {
          capabilities: ['scenery'],
          palette: { categories: [{ id: 'light', label: 'Light', kind: 'panel' }], items: [] },
          tools: [],
          gizmos: {},
          presentation: { minLogical: { w: 100, h: 100 } },
          dimension: '3d',
          view: 'fixed',
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cave' }));
    await waitFor(() => expect(fallbackAdmission.admitJob).toHaveBeenCalledOnce());
    expect(fallbackAdmission.admitJob.mock.calls[0]?.[0].plan.summary).toContain('lighting to cave');
    expect(editorApi.postTransaction).not.toHaveBeenCalled();
  });

  it('does not open a transaction stream for a no-build scene', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getScenerySource.mockResolvedValue({
      scene: {
        version: 1,
        items: [],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      },
      assets: [],
    });
    renderGame('/g/game?mode=edit');
    await waitFor(() => expect(preview.mountSceneryPreview).toHaveBeenCalled());
    await waitFor(() => expect(host.controller.applyDesign).toHaveBeenCalled());
    expect(editorApi.openTransactionStream).not.toHaveBeenCalled();
  });

  it('keeps the game menu available while editing scenery', async () => {
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getScenerySource.mockResolvedValue({
      scene: {
        version: 1,
        items: [],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      },
      assets: [],
    });
    renderGame('/g/game?mode=edit');
    await waitFor(() => expect(preview.mountSceneryPreview).toHaveBeenCalled());
    act(() =>
      preview.mountSceneryPreview.mock.calls.at(-1)?.[3]({
        bridgeState: 'ready',
        dropped: 0,
        manifest: {
          capabilities: ['scenery'],
          palette: { categories: [], items: [] },
          tools: [],
          gizmos: {},
          presentation: { minLogical: { w: 640, h: 360 } },
          dimension: '3d',
          view: 'fixed',
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await waitFor(() =>
      expect(within(screen.getByRole('group', { name: 'Menu' })).getByRole('button', { name: 'Games' })).toBeVisible(),
    );
  });
  it('passes the ready manifest button theme to the play menu', async () => {
    renderGame();
    await readyPlayFrame({ colour: '#e02020', icon: 'pause' });
    await waitFor(() => expect(screen.getByTestId('menu-theme')).toHaveTextContent('"colour":"#e02020"'));
    expect(screen.getByTestId('menu-theme')).toHaveTextContent('"icon":"pause"');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.queryByTestId('menu-theme')).not.toBeInTheDocument());
  });
  it('defaults to a full-screen play view with the host actions only inside the menu', async () => {
    const { container } = renderGame();

    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalled());
    expect(container.querySelector('.game-screen.is-playing')).toBeVisible();
    expect(container.querySelector('.play-bar')).not.toBeInTheDocument();
    expect(screen.queryByText('Goblin Cellar')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Games' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByRole('button', { name: 'Games' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ask for a change' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeVisible();
    await waitFor(() =>
      expect(host.mountGameFrame).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: 'game',
          buildId: 'build',
          mode: 'play',
          gamesOrigin: 'http://127.0.0.1:10000',
        }),
      ),
    );
  }, 10_000);

  it('shares mode in the query and acquires an edit lease', async () => {
    const { container } = renderGame();
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    await waitFor(() => expect(editorApi.acquireLease).toHaveBeenCalledWith('game', 'main', expect.any(String)));
    expect(host.controller.setMode).toHaveBeenCalledWith('edit');
    expect(container.querySelector('.game-screen.is-editing')).toBeVisible();
    expect(container.querySelector('.play-bar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  it('asks for a change in the build chat for this game and branch', async () => {
    renderGame();
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Ask for a change' }));

    expect(useDock.getState()).toMatchObject({
      view: 'chat',
      draft: { gameId: 'game', branchId: 'main', title: 'Goblin Cellar' },
    });
  });

  it('asks for the change on main when the editor opened the main branch by its id', async () => {
    // Admission only accepts the literal 'main'; the games screen opens branches by id.
    branchList.value = [
      { id: 'b_main', name: 'main' },
      { id: 'b_side', name: 'side' },
    ];
    renderGame('/g/game?v=b_main');
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Ask for a change' }));

    expect(useDock.getState().draft).toMatchObject({ gameId: 'game', branchId: 'main' });
  });

  it('detects a finished main build when the editor opened main by id', async () => {
    branchList.value = [{ id: 'b_main', name: 'main' }];
    editorApi.getDesignSnapshot
      .mockResolvedValueOnce({
        rev: 0,
        buildId: editorApi.NO_BUILD_ID,
        doc: { schemaVersion: 1, globals: {}, entities: {} },
      })
      .mockResolvedValue({ rev: 0, buildId: 'new-build', doc: { schemaVersion: 1, globals: {}, entities: {} } });
    editorApi.listJobs.mockResolvedValue({
      jobs: [{ id: 'job', branchId: 'main', state: 'done', updatedAt: '2026-11-13T00:00:00Z' }],
    });
    editorApi.getOptionalReapply.mockResolvedValue({ available: false });
    renderGame('/g/game?v=b_main');
    await waitFor(() =>
      expect(host.mountGameFrame).toHaveBeenCalledWith(expect.objectContaining({ buildId: 'new-build' })),
    );
  });

  it('reports a denied edit lease as read only', async () => {
    editorApi.acquireLease.mockResolvedValue({ ok: false, kind: 'lease-lost', holder: 'other-session' });

    renderGame('/g/game?mode=edit');

    expect(await screen.findByText('Read only')).toBeVisible();
  });

  it('marks and mounts the current release as published', async () => {
    editorApi.getOptionalPublished.mockResolvedValue({
      available: true,
      modified: true,
      etag: '"release"',
      value: { buildId: 'build' },
    });

    renderGame('/g/game?mode=edit');

    await waitFor(() =>
      expect(host.mountGameFrame).toHaveBeenLastCalledWith(expect.objectContaining({ build: 'published' })),
    );
  });

  it('disposes the frame before returning to Games', async () => {
    renderGame();
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Games' }));

    expect(await screen.findByRole('heading', { name: 'Games destination' })).toBeVisible();
    expect(host.controller.dispose).toHaveBeenCalled();
  });

  it('does not start the load layer before a build is available', async () => {
    editorApi.getDesignSnapshot.mockImplementation(() => new Promise(() => undefined));

    renderGame();
    await waitFor(() => expect(editorApi.getGame).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });

    expect(screen.queryByRole('progressbar', { name: 'Loading' })).not.toBeInTheDocument();
    expect(host.mountGameFrame).not.toHaveBeenCalled();
  });

  it('posts the terminal load measurement through OGM-014 analytics', async () => {
    renderGame();
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalled());
    const options = host.mountGameFrame.mock.calls.at(-1)?.[0];

    act(() => {
      options?.onLoadDone?.({ ms: 420, fetchedBytes: 1024, cachedBytes: 2048 });
    });

    await waitFor(() =>
      expect(editorApi.postAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: 'game',
          meta: expect.objectContaining({ system: 'game-load', command: 'partial', result: 'ok' }),
        }),
      ),
    );
  });

  it('shows Try again for a stalled load and remounts the frame', async () => {
    renderGame();
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalledTimes(1));
    const options = host.mountGameFrame.mock.calls.at(-1)?.[0];

    act(() => {
      options?.onLoadStalled?.({ ms: 20_000, fetchedBytes: 1024, cachedBytes: 1024 });
      options?.onState?.({
        bridgeState: 'error',
        dropped: 0,
        error: 'load-stalled',
        errorCode: 'load-stalled',
        load: { phase: 'ready', loaded: 20, total: 100, done: false },
      });
    });

    await waitFor(() =>
      expect(editorApi.postAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: 'game',
          meta: expect.objectContaining({ system: 'game-load', command: 'partial', result: 'fail' }),
        }),
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalledTimes(2));
  });

  it('pauses a solo game while the menu is open and resumes it when the menu closes', async () => {
    renderGame();
    await readyPlayFrame();

    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    await waitFor(() => expect(host.controller.pause).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog', { name: 'Paused' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(host.controller.resume).toHaveBeenCalledOnce());
    expect(screen.queryByRole('group', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('opens the menu without pausing a room game', async () => {
    renderGame('/g/game?room=room-1&test');
    await readyPlayFrame();

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByRole('group', { name: 'Menu' })).toBeVisible();
    expect(host.controller.pause).not.toHaveBeenCalled();
  });

  it('exposes live game state directly under the test hook', async () => {
    const baseHost: OgmHost = {
      version: 1,
      route: () => '/g/game',
      navigate: vi.fn(),
      register: vi.fn(),
      get: vi.fn(),
      snapshot: () => ({ route: '/g/game', registered: [] }),
    };
    window.__ogmHost = baseHost;
    renderGame('/g/game?test');

    await waitFor(() =>
      expect((window.__ogmHost as OgmHost & { game?: { headRev: number; mode: string } }).game).toMatchObject({
        headRev: 4,
        mode: 'play',
      }),
    );
  });

  it('does not let a room watcher ask for a change', async () => {
    window.__ogmHost = {
      version: 1,
      route: () => '/g/game',
      navigate: vi.fn(),
      register: vi.fn(),
      get: vi.fn(),
      snapshot: () => ({ route: '/g/game', registered: [] }),
    };
    renderGame('/g/game?test');
    const room = await waitFor(() => {
      const current = (window.__ogmHost as OgmHost & { room?: { fake: { emit(message: unknown): void } } }).room;
      expect(current).toBeDefined();
      return current!;
    });
    room.fake.emit({
      t: 'welcome',
      you: { userId: 'watcher', playerIndex: 1, sessionId: 'watcher-session' },
      state: {
        protocol: 1,
        pin: { gameId: 'game', branchId: 'main', buildId: 'build' },
        ownerId: 'owner',
        editorSessionId: 'owner-session',
        phase: 'playing',
        phaseAt: 1_000,
        playRev: 5,
        lastRev: 5,
        maxPlayers: 4,
        members: {},
        presence: { selection: [], privateMode: false },
      },
    });
    await waitFor(() => expect((window.__ogmHost as OgmHost & { game?: { mode: string } }).game?.mode).toBe('play'));

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    const ask = screen.getByRole('button', { name: 'Ask for a change' });
    expect(ask).toBeDisabled();
    fireEvent.click(ask);

    expect(useDock.getState().draft).toBeUndefined();
  }, 10_000);

  it('drives watcher revisions and modes through the fake room hook', async () => {
    const baseHost: OgmHost = {
      version: 1,
      route: () => '/g/game',
      navigate: vi.fn(),
      register: vi.fn(),
      get: vi.fn(),
      snapshot: () => ({ route: '/g/game', registered: [] }),
    };
    window.__ogmHost = baseHost;
    renderGame('/g/game?test');
    type FakeRoom = {
      fake: {
        emit(message: unknown): void;
        setState(state: object): void;
      };
    };
    const room = await waitFor(() => {
      const current = (window.__ogmHost as OgmHost & { room?: FakeRoom }).room;
      expect(current).toBeDefined();
      return current!;
    });

    room.fake.emit({
      t: 'welcome',
      you: { userId: 'watcher', playerIndex: 1, sessionId: 'watcher-session' },
      state: {
        protocol: 1,
        pin: { gameId: 'game', branchId: 'main', buildId: 'build' },
        ownerId: 'owner',
        editorSessionId: 'owner-session',
        phase: 'editing',
        phaseAt: 1_000,
        playRev: 5,
        lastRev: 5,
        maxPlayers: 4,
        members: {},
        presence: { selection: [], privateMode: false },
      },
    });
    room.fake.emit({
      t: 'design.tx',
      tx: { branchId: 'main', rev: 8, baseRev: 7, actor: 'owner', kind: 'manual', patches: [] },
    });
    await waitFor(() => expect(host.controller.camera).toHaveBeenCalledWith('follow'));
    room.fake.setState({ phase: 'playing', phaseAt: 2_000 });

    await waitFor(() =>
      expect((window.__ogmHost as OgmHost & { game?: { headRev: number; mode: string } }).game).toMatchObject({
        headRev: 8,
        mode: 'play',
      }),
    );
    expect(editorApi.acquireLease).not.toHaveBeenCalled();

    act(() => {
      host.mountGameFrame.mock.calls.at(-1)?.[0]?.onSaveWrite?.({ saveSchemaVersion: 1, data: {} });
      room.fake.emit({ t: 'ended', reason: 'host-left' });
    });
    expect(await screen.findByText(/Last autosave/)).toBeVisible();
  });

  it('renders manifest palette controls only in edit mode', async () => {
    host.mountGameFrame.mockImplementationOnce((options) => {
      queueMicrotask(() =>
        options?.onState?.({
          bridgeState: 'ready',
          dropped: 0,
          manifest: {
            id: 'cellar',
            sdk: '^1',
            title: 'Goblin Cellar',
            inputs: { actions: {} },
            presentation: { orientation: 'any', minLogical: { w: 320, h: 180 }, fit: 'responsive' },
            view: 'main',
            dimension: '2d',
            capabilities: [],
            palette: {
              categories: [{ id: 'actors', label: 'Actors', kind: 'items' }],
              items: [{ prefab: 'skeleton', label: 'Skeleton', category: 'actors' }],
            },
            tools: ['select', 'place'],
            gizmos: {},
            playLabel: 'Enter crypt',
            saves: false,
            overrides: { aliases: {}, retired: [] },
          },
        }),
      );
      return host.controller;
    });

    renderGame('/g/game?mode=edit');

    expect(await screen.findByRole('button', { name: 'Skeleton' }, { timeout: 5_000 })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Play' })).toBeVisible();
  }, 10_000);

  // The API files each save under the branch and build that wrote it; the player knows them only here.
  it('saves under the branch and build of the adopted snapshot', async () => {
    editorApi.getOptionalSaves.mockResolvedValue({ available: true, value: { slots: [] } });
    editorApi.putSave.mockResolvedValue({ revision: 1 });
    host.mountGameFrame.mockImplementationOnce((options) => {
      queueMicrotask(() =>
        options?.onState?.({
          bridgeState: 'ready',
          dropped: 0,
          manifest: {
            id: 'cellar',
            sdk: '^1',
            title: 'Goblin Cellar',
            inputs: { actions: {} },
            presentation: { orientation: 'any', minLogical: { w: 320, h: 180 }, fit: 'responsive' },
            view: 'main',
            dimension: '2d',
            capabilities: [],
            tools: [],
            gizmos: {},
            saves: true,
            saveSchema: 1,
            migratesFrom: 0,
            overrides: { aliases: {}, retired: [] },
          },
        }),
      );
      return host.controller;
    });
    renderGame();

    await waitFor(() => expect(host.controller.onSaveWrite).toHaveBeenCalled());
    await waitFor(() =>
      expect(editorApi.getOptionalSaves).toHaveBeenCalledWith('game', { schema: 1, migratesFrom: 0 }),
    );
    const save = { saveSchemaVersion: 1, data: { room: 'crypt' } };
    host.controller.onSaveWrite.mock.calls.at(-1)![0](save);

    await waitFor(() =>
      expect(editorApi.putSave).toHaveBeenCalledWith('game', 'auto', save, undefined, {
        branch: 'main',
        buildId: 'build',
      }),
    );
  });
});
