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
import { createIntent, sceneryLightIntent } from './transactions';
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
  onSelection?(ids: string[]): void;
  onCanvasChange?(value: { prefab?: string; snap: SnapPrefs }): void;
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
  onSelection,
  onCanvasChange,
}: EditorChromeProps) {
  const [category, setCategory] = useState(manifest.palette.categories[0]?.id ?? '');
  const [pickedPrefab, setPickedPrefab] = useState<string>();
  const [snap, setSnap] = useState<SnapPrefs>(() => loadSnapPrefs(gameId, manifest.grid?.size ?? 1));
  const [toolsTarget, setToolsTarget] = useState<HTMLElement | null>(null);
  const controls = useMemo(() => manifestControls(manifest), [manifest]);
  const palette = useMemo(() => {
    if (!session.doc.globals['scenery.backdrop'] || !sceneryAssets) return manifest.palette;
    const images = sceneryAssets.filter((asset) => /\.(png|jpe?g|webp)(?:\?|$)/i.test(asset.url));
    const categories = [...manifest.palette.categories];
    if (!categories.some((candidate) => candidate.id === 'backdrops'))
      categories.push({ id: 'backdrops', label: 'Backdrops', kind: 'items' });
    const items = [...manifest.palette.items];
    for (const asset of images) {
      const prefab = `scenery-backdrop:${asset.id}`;
      if (!items.some((item) => item.prefab === prefab))
        items.push({
          prefab,
          label: asset.id.split('/').at(-1) ?? asset.id,
          category: 'backdrops',
          thumbnail: asset.url,
        });
    }
    return { categories, items };
  }, [manifest.palette, sceneryAssets, session.doc.globals]);
  const activeCategory = palette.categories.find((candidate) => candidate.id === category);
  const picked = palette.items.find((item) => item.prefab === pickedPrefab);
  // Layout, not passive: the canvas must hold the pick in the same commit the palette shows it, or a quick tap
  // after picking lands as a select and places nothing (#297).
  useLayoutEffect(() => onCanvasChange?.({ prefab: pickedPrefab, snap }), [onCanvasChange, pickedPrefab, snap]);
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
      onSelect={(ids) => {
        session.setSelection(ids);
        onSelection?.(ids);
      }}
    />
  );
  return (
    <div className="editor-chrome">
      <Rail categories={palette.categories} items={palette.items} active={category} onChange={setCategory} />
      {activeCategory?.kind === 'items' ? (
        <Palette
          palette={palette}
          category={category}
          title={activeCategory.label}
          showTabs={false}
          sceneryAssets={sceneryAssets}
          onCategory={setCategory}
          onPick={(prefab) => {
            if (prefab.startsWith('scenery-backdrop:')) {
              const settings =
                session.doc.globals['scenery.backdrop'] ??
                (session.doc.globals['scenery.settings'] as { backdrop?: unknown } | undefined)?.backdrop;
              if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
              void session.submit(
                createIntent(
                  session.doc,
                  [
                    {
                      op: 'set',
                      control: 'scenery.backdrop',
                      targets: 'global',
                      value: {
                        ...settings,
                        assetId: prefab.slice('scenery-backdrop:'.length),
                      },
                    },
                  ],
                  'Changed backdrop',
                ),
              );
              return;
            }
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
              disabled={session.readOnly}
              onClick={() => void session.submit(sceneryLightIntent(session.doc, preset))}
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
    return parsed.success && !['scenery.lighting', 'scenery.terrain', 'scenery.backdrop'].includes(parsed.data.id)
      ? [parsed.data]
      : [];
  });
}
