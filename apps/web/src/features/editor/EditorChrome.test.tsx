import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameManifest } from '@ogm/contracts/browser';

import { EditorChrome } from './EditorChrome';
import type { EditorSessionState } from './session';

const manifest = {
  palette: {
    categories: [{ id: 'actors', label: 'Actors', kind: 'items' }],
    items: [{ prefab: 'skeleton', label: 'Skeleton', category: 'actors', hint: 'A bony guard' }],
  },
  tools: ['select', 'place'],
} as unknown as GameManifest;

const session = {
  doc: { schemaVersion: 1, globals: {}, entities: {} },
  selection: [],
  tool: 'select',
  canUndo: false,
  canRedo: false,
} as unknown as EditorSessionState;

function Screen() {
  const [prefab, setPrefab] = useState<string>();
  return (
    <>
      <EditorChrome
        gameId="game"
        manifest={manifest}
        session={session}
        onCommand={vi.fn()}
        onTool={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onInstanceCount={vi.fn()}
        onCanvasChange={(value) => setPrefab(value.prefab)}
      />
      <output data-testid="canvas-prefab">{prefab ?? ''}</output>
    </>
  );
}

afterEach(cleanup);

describe('EditorChrome', () => {
  it('clears a selected item from the canvas when the palette changes', () => {
    const onCanvasChange = vi.fn();
    const props = {
      gameId: 'game',
      session,
      onCommand: vi.fn(),
      onTool: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      onInstanceCount: vi.fn(),
      onCanvasChange,
    };
    const view = render(<EditorChrome {...props} manifest={manifest} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Skeleton' }), { pointerId: 1 });
    expect(onCanvasChange).toHaveBeenLastCalledWith(expect.objectContaining({ prefab: 'skeleton' }));
    view.rerender(<EditorChrome {...props} manifest={{ ...manifest, palette: { categories: [], items: [] } }} />);
    expect(onCanvasChange).toHaveBeenLastCalledWith(expect.objectContaining({ prefab: undefined }));
  });
  it('selects the first category when a fallback palette arrives after the game manifest', () => {
    const empty = { ...manifest, palette: { categories: [], items: [] } };
    const props = {
      gameId: 'game',
      session,
      onCommand: vi.fn(),
      onTool: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      onInstanceCount: vi.fn(),
    };
    const view = render(<EditorChrome {...props} manifest={empty} />);
    view.rerender(<EditorChrome {...props} manifest={manifest} />);
    expect(screen.getByRole('button', { name: 'Skeleton' })).toBeVisible();
  });
  it('submits an undoable light change from the scenery tab', () => {
    const submit = vi.fn();
    const sceneryManifest = {
      ...manifest,
      capabilities: ['scenery'],
      palette: { categories: [{ id: 'light', label: 'Light', kind: 'panel' }], items: [] },
    } as GameManifest;
    const scenerySession = {
      ...session,
      doc: {
        schemaVersion: 1,
        globals: { 'scenery.settings': { lighting: 'night' }, 'scenery.lighting': 'night' },
        entities: {},
      },
      submit,
    } as unknown as EditorSessionState;
    render(
      <EditorChrome
        gameId="game"
        manifest={sceneryManifest}
        session={scenerySession}
        onCommand={vi.fn()}
        onTool={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onInstanceCount={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cave' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        patches: [expect.objectContaining({ path: ['globals', 'scenery.lighting'], value: 'cave' })],
      }),
    );
  });

  it('maps real editor controls into the prototype rail, tray, and inspector regions', () => {
    const { container } = render(<Screen />);

    expect(container.querySelector('.editor-chrome > .editor-rail')).toBeVisible();
    expect(container.querySelector('.editor-chrome > .editor-palette')).toHaveTextContent('Actors');
    expect(container.querySelector('.editor-chrome > .editor-inspector-stack .editor-tools')).toBeVisible();
    expect(container.querySelector('.editor-chrome > .editor-inspector-stack .editor-inspector')).toBeVisible();
  });

  // A creator who taps a palette item and then the canvas must place that item. If the canvas learns the pick a
  // task after the palette shows it, a quick tap lands as a select-pick and nothing is placed (#297).
  it('hands the picked prefab to the canvas in the same commit that shows the pick', async () => {
    render(<Screen />);
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      if (seen.length === 0 && screen.queryByText('A bony guard') !== null) {
        seen.push(screen.getByTestId('canvas-prefab').textContent ?? '');
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const act = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previous = act.IS_REACT_ACT_ENVIRONMENT;
    act.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      screen.getByRole('button', { name: 'Skeleton' }).click();
      await vi.waitFor(() => expect(seen).toHaveLength(1));
    } finally {
      act.IS_REACT_ACT_ENVIRONMENT = previous;
      observer.disconnect();
    }

    expect(seen).toEqual(['skeleton']);
  });
});
