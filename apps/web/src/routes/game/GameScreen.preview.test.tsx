import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('GameScreen previews', () => {
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
  it('edits a side-branch preview locally without admitting a job or saving a transaction', async () => {
    branchList.value = [{ id: 'b_side', name: 'side' }];
    editorApi.getDesignSnapshot.mockResolvedValue({
      rev: 0,
      buildId: editorApi.NO_BUILD_ID,
      doc: { schemaVersion: 1, globals: {}, entities: {} },
    });
    editorApi.getEditorPreviews.mockResolvedValue({
      previews: [
        { ticket: '12', branchId: 'b_side', buildId: 'preview-1', accessId: 'pv-1', createdAt: '2026-11-13T00:00:00Z' },
      ],
    });
    renderGame('/g/game?v=b_side&mode=edit');
    await waitFor(() => expect(host.mountGameFrame).toHaveBeenCalledWith(expect.objectContaining({ buildId: 'pv-1' })));
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
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Skeleton' }), { pointerId: 1 });
    const canvas = screen.getByLabelText('Editor canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 25, clientY: 50 });
    await waitFor(() => expect(host.controller.validatePlacement).toHaveBeenCalled());
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 25, clientY: 50 });
    await waitFor(() =>
      expect(host.controller.applyDesign).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ entities: expect.objectContaining({}) }),
        expect.arrayContaining([expect.objectContaining({ path: expect.arrayContaining(['entities']) })]),
      ),
    );
    expect(editorApi.postTransaction).not.toHaveBeenCalled();
    expect(fallbackAdmission.admitJob).not.toHaveBeenCalled();
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
});
