import { useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  controlDeclSchema,
  type ControlDecl,
  type EditorCommand,
  type GameManifest,
  type PlacementResult,
} from '@ogm/contracts/browser';

import type { EditorSessionState } from './session';
import { HintStrip } from './HintStrip';
import { Inspector } from './Inspector';
import type { InstanceCountChange } from './instanceCount';
import { Palette } from './Palette';
import { Rail } from './Rail';
import { loadSnapPrefs, saveSnapPrefs, type SnapPrefs } from './SnapPrefs';
import { Tools } from './Tools';
import { sceneryLightIntent } from './transactions';
import './editor.css';

type EditorChromeProps = {
  gameId: string;
  manifest: GameManifest;
  session: EditorSessionState;
  sceneryAssets?: readonly { id: string; sha256: string; url: string }[];
  onCommand(command: EditorCommand): void;
  onTool(tool: string): void;
  onUndo(): void;
  onRedo(): void;
  onDelete(entityId: string): void;
  onDuplicate(entityId: string): void;
  onInstanceCount(change: InstanceCountChange): Promise<PlacementResult>;
  onCanvasChange?(value: { prefab?: string; snap: SnapPrefs }): void;
  onRequestLight?(preset: 'warm-forest' | 'night' | 'cave'): void;
};

export function EditorChrome({
  gameId,
  manifest,
  session,
  sceneryAssets,
  onCommand,
  onTool,
  onUndo,
  onRedo,
  onDelete,
  onDuplicate,
  onInstanceCount,
  onCanvasChange,
  onRequestLight,
}: EditorChromeProps) {
  const [category, setCategory] = useState(manifest.palette.categories[0]?.id ?? '');
  const [pickedPrefab, setPickedPrefab] = useState<string>();
  const [snap, setSnap] = useState<SnapPrefs>(() => loadSnapPrefs(gameId, manifest.grid?.size ?? 1));
  const [toolsTarget, setToolsTarget] = useState<HTMLElement | null>(null);
  const controls = useMemo(() => manifestControls(manifest), [manifest]);
  const activeCategory =
    manifest.palette.categories.find((candidate) => candidate.id === category) ?? manifest.palette.categories[0];
  const picked = manifest.palette.items.find((item) => item.prefab === pickedPrefab);
  useLayoutEffect(() => {
    if (pickedPrefab !== undefined && picked === undefined) setPickedPrefab(undefined);
  }, [picked, pickedPrefab]);
  // Layout, not passive: the canvas must hold the pick in the same commit the palette shows it, or a quick tap
  // after picking lands as a select and places nothing (#297).
  useLayoutEffect(() => onCanvasChange?.({ prefab: picked?.prefab, snap }), [onCanvasChange, picked?.prefab, snap]);
  useLayoutEffect(() => setToolsTarget(document.getElementById('studio-editor-tools')), []);
  const updateSnap = (next: SnapPrefs) => {
    setSnap(next);
    saveSnapPrefs(gameId, next);
  };

  const tools = (
    <Tools
      tools={manifest.tools}
      active={session.tool}
      snap={snap}
      canUndo={session.canUndo}
      canRedo={session.canRedo}
      onTool={(tool) => {
        if (tool !== 'place') setPickedPrefab(undefined);
        onTool(tool);
      }}
      onSnap={updateSnap}
      onUndo={onUndo}
      onRedo={onRedo}
    />
  );
  const inspector = (
    <Inspector
      doc={session.doc}
      selectedIds={session.selection}
      controls={controls}
      onCommand={onCommand}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onInstanceCount={onInstanceCount}
    />
  );
  return (
    <div className="editor-chrome">
      <Rail
        categories={manifest.palette.categories}
        items={manifest.palette.items}
        sceneryAssets={sceneryAssets}
        active={activeCategory?.id ?? ''}
        onChange={setCategory}
      />
      {activeCategory?.kind === 'items' ? (
        <Palette
          palette={manifest.palette}
          category={activeCategory.id}
          title={activeCategory.label}
          showTabs={false}
          sceneryAssets={sceneryAssets}
          onCategory={setCategory}
          onPick={(prefab) => {
            setPickedPrefab(prefab);
            onTool('place');
          }}
        />
      ) : null}
      {activeCategory?.id === 'light' && manifest.capabilities.includes('scenery') ? (
        <div className="palette-items" aria-label="Light">
          {(
            [
              ['warm-forest', 'Warm forest'],
              ['night', 'Night'],
              ['cave', 'Cave'],
            ] as const
          ).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              disabled={session.readOnly && !onRequestLight}
              onClick={() =>
                onRequestLight ? onRequestLight(preset) : void session.submit(sceneryLightIntent(session.doc, preset))
              }
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="editor-inspector-stack">
        {toolsTarget ? (
          createPortal(
            <>
              {tools}
              {inspector}
            </>,
            toolsTarget,
          )
        ) : (
          <>
            {tools}
            {inspector}
          </>
        )}
      </div>
      <HintStrip hint={picked?.hint} />
    </div>
  );
}

function manifestControls(manifest: GameManifest): ControlDecl[] {
  const value = (manifest as GameManifest & { controls?: unknown }).controls;
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const parsed = controlDeclSchema.safeParse(candidate);
    return parsed.success && !['scenery.lighting', 'scenery.terrain'].includes(parsed.data.id) ? [parsed.data] : [];
  });
}
