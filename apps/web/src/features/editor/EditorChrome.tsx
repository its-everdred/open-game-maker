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
import './editor.css';

type EditorChromeProps = {
  gameId: string;
  manifest: GameManifest;
  session: EditorSessionState;
  onCommand(command: EditorCommand): void;
  onTool(tool: string): void;
  onUndo(): void;
  onRedo(): void;
  onDelete(entityId: string): void;
  onDuplicate(entityId: string): void;
  onInstanceCount(change: InstanceCountChange): Promise<PlacementResult>;
  onCanvasChange?(value: { prefab?: string; snap: SnapPrefs }): void;
};

export function EditorChrome({
  gameId,
  manifest,
  session,
  onCommand,
  onTool,
  onUndo,
  onRedo,
  onDelete,
  onDuplicate,
  onInstanceCount,
  onCanvasChange,
}: EditorChromeProps) {
  const [category, setCategory] = useState(manifest.palette.categories[0]?.id ?? '');
  const [pickedPrefab, setPickedPrefab] = useState<string>();
  const [snap, setSnap] = useState<SnapPrefs>(() => loadSnapPrefs(gameId, manifest.grid?.size ?? 1));
  const [toolsTarget, setToolsTarget] = useState<HTMLElement | null>(null);
  const controls = useMemo(() => manifestControls(manifest), [manifest]);
  const activeCategory = manifest.palette.categories.find((candidate) => candidate.id === category);
  const picked = manifest.palette.items.find((item) => item.prefab === pickedPrefab);
  // Layout, not passive: the canvas must hold the pick in the same commit the palette shows it, or a quick tap
  // after picking lands as a select and places nothing (#297).
  useLayoutEffect(() => onCanvasChange?.({ prefab: pickedPrefab, snap }), [onCanvasChange, pickedPrefab, snap]);
  useLayoutEffect(() => setToolsTarget(document.getElementById('studio-editor-tools')), []);
  const updateSnap = (next: SnapPrefs) => {
    setSnap(next);
    saveSnapPrefs(gameId, next);
  };

  const tools = <Tools
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
  />;
  return (
    <div className="editor-chrome">
      <Rail
        categories={manifest.palette.categories}
        items={manifest.palette.items}
        active={category}
        onChange={setCategory}
      />
      {activeCategory?.kind === 'items' ? (
        <Palette
          palette={manifest.palette}
          category={category}
          title={activeCategory.label}
          showTabs={false}
          onCategory={setCategory}
          onPick={(prefab) => {
            setPickedPrefab(prefab);
            onTool('place');
          }}
        />
      ) : null}
      <div className="editor-inspector-stack">
        {toolsTarget ? createPortal(tools, toolsTarget) : tools}
        <Inspector
          doc={session.doc}
          selectedIds={session.selection}
          controls={controls}
          onCommand={onCommand}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onInstanceCount={onInstanceCount}
        />
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
    return parsed.success ? [parsed.data] : [];
  });
}
