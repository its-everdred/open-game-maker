import { useEffect, useMemo, useRef, useState } from 'react';
import type { SceneDoc } from '@ogm/contracts/browser';

import { Icon } from '../../../components/Icon';
import { pushToast } from '../../../lib/notify/slice';
import { getEditorScene, saveEditorScene, type EditorScene } from '../api';
import {
  cellKey,
  duplicate,
  erase,
  historyOf,
  move,
  paint,
  record,
  redo,
  rotate,
  tileAt,
  undo,
  type Cell,
  type History,
  type TileRef,
} from './edit';
import { MapCanvas, type MapPointer, type PressResult } from './MapCanvas';
import { assetLabels, packFor, type Sprites } from './pack';
import './map-editor.css';

type Tool = 'select' | 'paint' | 'erase';
type Draft = { rev: number; saved: SceneDoc; history: History; sprites: Sprites };

/**
 * Unsaved work per scene, kept while the page lives: Play leaves edit mode and unmounts the editor, and coming back
 * must find the edits where they were (edit → play → edit, as in the Goblin Cellar proof of concept).
 */
const drafts = new Map<string, Draft>();

const layerName = (id: string) => {
  const words = id.replace(/-(\d+)$/, ' $1');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The map maker (#1209, Kevin's direction A): the scene drawn as the game draws it, undo/redo and save on top, the
 * selected piece's actions above it, and a bottom tray with the tools over the pieces to paint.
 */
export function MapEditor({
  gameId,
  scene,
  onOpen,
}: {
  gameId: string;
  scene: string;
  /** Whether a scene document opened, so the page can keep the game's own overlays out of the way. */
  onOpen?(open: boolean): void;
}) {
  const key = `${gameId}/${scene}`;
  const [draft, setDraftState] = useState<Draft | undefined>(() => drafts.get(key));
  const [failed, setFailed] = useState(false);
  const setDraft = (next: Draft) => {
    drafts.set(key, next);
    setDraftState(next);
  };

  useEffect(() => {
    let current = true;
    const kept = drafts.get(key);
    setDraftState(kept);
    setFailed(false);
    void getEditorScene(gameId, scene)
      .then((opened: EditorScene) => {
        if (!current) return;
        const held = drafts.get(key);
        /* Unsaved edits stay; otherwise the head (perhaps an agent's newer revision) is what opens. */
        if (held && held.history.present !== held.saved) {
          setDraft({ ...held, sprites: opened.sprites });
          return;
        }
        setDraft({ rev: opened.rev, saved: opened.doc, history: historyOf(opened.doc), sprites: opened.sprites });
      })
      .catch(() => current && !kept && setFailed(true));
    return () => {
      current = false;
    };
    /* reopen only when the scene changes */
  }, [key]);

  const open = draft !== undefined && !failed;
  useEffect(() => {
    onOpen?.(open);
    return () => onOpen?.(false);
  }, [open, onOpen]);

  /* A scenario chip names no scene document: nothing opens, and the game stays in view. */
  if (!draft || failed) return null;
  return <MapEditorReady key={key} gameId={gameId} scene={scene} draft={draft} setDraft={setDraft} />;
}

function MapEditorReady({
  gameId,
  scene,
  draft,
  setDraft,
}: {
  gameId: string;
  scene: string;
  draft: Draft;
  setDraft(next: Draft): void;
}) {
  const doc = draft.history.present;
  const pack = useMemo(() => packFor(doc, draft.sprites), [doc.packAdapter, draft.sprites]);
  const [tool, setTool] = useState<Tool>('select');
  const [group, setGroup] = useState<string>(pack?.groups[0] ?? '');
  const [armed, setArmed] = useState<string>();
  const [selected, setSelected] = useState<TileRef>();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [layersOpen, setLayersOpen] = useState(false);
  const [hover, setHover] = useState<Cell>();
  const [saving, setSaving] = useState(false);
  /** A stroke or drag in progress: the document it started from, and where a dragged piece would land. */
  const stroke = useRef<{ start: SceneDoc; doc: SceneDoc; last?: string; dragging?: TileRef; to?: Cell }>(undefined);
  const [dragTo, setDragTo] = useState<Cell>();
  const [strokeDoc, setStrokeDoc] = useState<SceneDoc>();
  const tray = useRef<HTMLDivElement>(null);
  const [trayHeight, setTrayHeight] = useState(0);

  useEffect(() => {
    const element = tray.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setTrayHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const items = useMemo(() => {
    if (!pack) return {};
    const byGroup: Record<string, string[]> = {};
    for (const asset of Object.keys(draft.sprites).sort()) (byGroup[pack.layerFor(asset)] ??= []).push(asset);
    return byGroup;
  }, [pack, draft.sprites]);

  const labels = useMemo(() => assetLabels(Object.keys(draft.sprites)), [draft.sprites]);

  if (!pack) return null;
  const adapter = pack.adapter;
  const shown = strokeDoc ?? doc;
  const view: SceneDoc = {
    ...shown,
    layers: Object.fromEntries(
      Object.entries(shown.layers).map(([id, layer]) => [id, hidden.has(id) ? { ...layer, visible: false } : layer]),
    ),
  };
  const dirty = doc !== draft.saved;
  const commit = (next: SceneDoc) => setDraft({ ...draft, history: record(draft.history, next) });
  const paintLayer = (asset: string) => {
    const base = pack.layerFor(asset);
    return doc.layers[base]?.kind === 'tiles' ? base : undefined;
  };
  const selectedTile = selected ? tileAt(doc, selected) : undefined;

  function onPress(at: MapPointer): PressResult {
    if (tool === 'select') {
      if (!at.pick) {
        setSelected(undefined);
        return 'pan';
      }
      setSelected(at.pick);
      stroke.current = { start: doc, doc, dragging: at.pick };
      return 'drag';
    }
    if (!at.cell) return 'pan';
    stroke.current = { start: doc, doc };
    applyStroke(at);
    return 'drag';
  }

  function applyStroke(at: MapPointer) {
    const current = stroke.current;
    if (!current || !at.cell) return;
    if (current.dragging) {
      current.to = at.cell;
      setDragTo(cellKey(at.cell) === current.dragging.cell ? undefined : at.cell);
      return;
    }
    const cellId = cellKey(at.cell);
    if (current.last === cellId) return;
    current.last = cellId;
    if (tool === 'paint' && armed) {
      const layer = paintLayer(armed);
      if (layer) current.doc = paint(current.doc, adapter, layer, at.cell, armed);
    } else if (tool === 'erase' && at.pick) {
      current.doc = erase(current.doc, adapter, at.pick);
    }
    setStrokeDoc(current.doc);
  }

  function onRelease(at: MapPointer) {
    const current = stroke.current;
    stroke.current = undefined;
    setStrokeDoc(undefined);
    setDragTo(undefined);
    if (!current) return;
    if (current.dragging) {
      const to = at.cell ?? current.to;
      if (!to || cellKey(to) === current.dragging.cell) return;
      const next = move(doc, adapter, current.dragging, to);
      if (next !== doc) {
        commit(next);
        setSelected({ layer: current.dragging.layer, cell: cellKey(to) });
      }
      return;
    }
    if (current.doc !== current.start) commit(current.doc);
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const result = await saveEditorScene(gameId, scene, { baseRev: draft.rev, doc, label: 'Map maker' });
      /* Edits made while the save was out are newer than this render's draft: start from the kept one. */
      const latest = drafts.get(`${gameId}/${scene}`) ?? draft;
      if (latest.history.present === doc) {
        /* The head comes back with Kevin's units locked (and any agent work merged around them). */
        setDraft({
          ...latest,
          rev: result.rev,
          saved: result.doc,
          history: { ...latest.history, present: result.doc },
        });
      } else {
        /* Keep the newer edits on screen and unsaved; the next save sends them on top of this revision. */
        setDraft({ ...latest, rev: result.rev, saved: result.doc });
      }
    } catch {
      pushToast('Not saved');
    } finally {
      setSaving(false);
    }
  }

  const tools: { id: Tool | 'layers'; label: string; icon: string }[] = [
    { id: 'select', label: 'Select and move', icon: 'pointer' },
    { id: 'paint', label: 'Paint', icon: 'brush' },
    { id: 'erase', label: 'Erase', icon: 'eraser' },
    { id: 'layers', label: 'Layers', icon: 'layers' },
  ];
  const ghost =
    tool === 'select' && dragTo && selectedTile
      ? { asset: selectedTile.asset, facing: selectedTile.facing ?? 'E', cell: dragTo }
      : tool === 'paint' && armed && hover && !stroke.current
        ? { asset: armed, facing: adapter.facings(armed)[0] ?? 'E', cell: hover }
        : undefined;

  return (
    <div className="map-editor" style={{ ['--map-tray' as string]: `${trayHeight}px` }}>
      <MapCanvas
        doc={view}
        pack={pack}
        sprites={draft.sprites}
        {...(selected && selectedTile ? { selected } : {})}
        {...(ghost ? { ghost } : {})}
        {...(hover && tool !== 'select' ? { hover } : {})}
        inset={{ top: 72, bottom: trayHeight + 16 }}
        onPress={onPress}
        onDrag={applyStroke}
        onRelease={onRelease}
        onCancel={() => {
          /* Two fingers mean looking around: the stroke or drag they interrupted leaves the map as it was. */
          stroke.current = undefined;
          setStrokeDoc(undefined);
          setDragTo(undefined);
        }}
        onHover={(at) => setHover(at?.cell)}
      >
        {tool === 'select' && selected && selectedTile && !dragTo ? (
          <div className="map-selection" role="toolbar" aria-label="Selected piece">
            <button
              type="button"
              aria-label="Turn"
              disabled={adapter.facings(selectedTile.asset).length < 2}
              onClick={() => commit(rotate(doc, adapter, selected))}
            >
              <Icon name="rotate" />
            </button>
            <button
              type="button"
              aria-label="Copy"
              onClick={() => {
                const copied = duplicate(doc, adapter, selected);
                if (copied.ref) {
                  commit(copied.doc);
                  setSelected(copied.ref);
                }
              }}
            >
              <Icon name="copy" />
            </button>
            <button
              type="button"
              aria-label="Delete"
              onClick={() => {
                commit(erase(doc, adapter, selected));
                setSelected(undefined);
              }}
            >
              <Icon name="trash" />
            </button>
          </div>
        ) : null}
      </MapCanvas>

      <div className="map-topbar">
        <div className="map-pill">
          <button
            type="button"
            aria-label="Undo"
            disabled={draft.history.past.length === 0}
            onClick={() => setDraft({ ...draft, history: undo(draft.history) })}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            aria-label="Redo"
            disabled={draft.history.future.length === 0}
            onClick={() => setDraft({ ...draft, history: redo(draft.history) })}
          >
            <Icon name="redo" />
          </button>
        </div>
        <div className="map-pill">
          <button
            className="map-save"
            type="button"
            aria-label={dirty ? 'Save' : 'Saved'}
            aria-busy={saving}
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            <Icon name="check" />
          </button>
        </div>
      </div>

      <div className="map-tray" ref={tray}>
        <div className="map-pill map-tools" role="toolbar" aria-label="Tools">
          {tools.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-label={entry.label}
              aria-pressed={entry.id === 'layers' ? layersOpen : tool === entry.id}
              onClick={() => {
                if (entry.id === 'layers') setLayersOpen((open) => !open);
                else {
                  setTool(entry.id);
                  if (entry.id !== 'select') setSelected(undefined);
                }
              }}
            >
              <Icon name={entry.icon} />
            </button>
          ))}
        </div>
        {layersOpen ? (
          <ul className="map-layers" aria-label="Layers">
            {Object.entries(doc.layers)
              .filter(([, layer]) => layer.kind === 'tiles')
              .sort(([, a], [, b]) => b.order - a.order)
              .map(([id]) => (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={!hidden.has(id)}
                    onClick={() =>
                      setHidden((current) => {
                        const next = new Set(current);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  >
                    <Icon name={hidden.has(id) ? 'eyeOff' : 'eye'} />
                    {layerName(id)}
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <>
            <div className="map-groups" role="tablist" aria-label="Kinds">
              {pack.groups
                .filter((id) => items[id]?.length)
                .map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={group === id}
                    aria-label={layerName(id)}
                    onClick={() => setGroup(id)}
                  >
                    <Thumb sprites={draft.sprites} asset={items[id]![0]!} />
                  </button>
                ))}
            </div>
            <div className="map-items" role="listbox" aria-label="Pieces">
              {(items[group] ?? []).map((asset) => (
                <button
                  key={asset}
                  type="button"
                  role="option"
                  aria-selected={armed === asset}
                  aria-label={labels.get(asset)}
                  title={labels.get(asset)}
                  onClick={() => {
                    setArmed(asset);
                    setTool('paint');
                    setSelected(undefined);
                  }}
                >
                  <Thumb sprites={draft.sprites} asset={asset} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Thumb({ sprites, asset }: { sprites: Sprites; asset: string }) {
  const facings = sprites[asset]?.facings;
  const url = facings?.E ?? (facings ? Object.values(facings)[0] : undefined);
  return url ? <img src={url} alt="" loading="lazy" draggable={false} /> : null;
}
