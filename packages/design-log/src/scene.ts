import {
  SceneDocSchema,
  type SceneAuthor,
  type SceneChange,
  type SceneConflict,
  type SceneDoc,
  type SceneHead,
  type SceneRevision,
  type SceneSource,
} from '@ogm/contracts';

import { canonical } from './canonical.js';
import { sha256Canonical } from './hash.js';

type Units = Map<string, unknown>;

export class InvalidSceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSceneError';
  }
}

/** The base predates a revision the log cannot replay past (a migration), or the log is missing revisions. */
export class SceneBaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneBaseUnavailableError';
  }
}

export function isAgent(author: string): boolean {
  return author.startsWith('agent:');
}

export function emptyScene(game: string, scene: string, packAdapter: string): SceneDoc {
  return { schemaVersion: 1, game, scene, packAdapter, layers: {}, objects: {}, hd2d: {} };
}

/** Split a scene into the units that merge and lock on their own. */
export function sceneUnits(doc: SceneDoc): Units {
  const units: Units = new Map([['meta', { packAdapter: doc.packAdapter }]]);
  for (const [id, layer] of Object.entries(doc.layers)) {
    const { tiles, ...settings } = layer;
    units.set(`layer:${id}`, settings);
    for (const [cell, tile] of Object.entries(tiles ?? {})) units.set(`tile:${id}:${cell}`, tile);
  }
  for (const [id, object] of Object.entries(doc.objects)) units.set(`object:${id}`, object);
  for (const [section, entry] of Object.entries(doc.hd2d)) units.set(`hd2d:${section}`, entry);
  return units;
}

function fromUnits(head: SceneDoc, units: Units): SceneDoc {
  const doc: Record<string, unknown> = { schemaVersion: head.schemaVersion, game: head.game, scene: head.scene };
  const layers: Record<string, Record<string, unknown>> = {};
  const tiles: [string, string, unknown][] = [];
  const objects: Record<string, unknown> = {};
  const hd2d: Record<string, unknown> = {};
  for (const [unit, value] of units) {
    const [kind, id, cell] = unit.split(':') as [string, string, string];
    if (kind === 'meta') Object.assign(doc, value);
    else if (kind === 'layer') {
      const layer: Record<string, unknown> = { ...(value as object) };
      if (layer.kind === 'tiles') layer.tiles = {};
      layers[id] = layer;
    } else if (kind === 'tile') tiles.push([id, cell, value]);
    else if (kind === 'object') objects[id] = value;
    else hd2d[id] = value;
  }
  for (const [layerId, cell, tile] of tiles) {
    const layerTiles = layers[layerId]?.tiles as Record<string, unknown> | undefined;
    if (layerTiles === undefined) throw new InvalidSceneError(`tile ${cell} has no tiles layer ${layerId}`);
    layerTiles[cell] = tile;
  }
  const parsed = SceneDocSchema.safeParse({ ...doc, layers, objects, hd2d });
  if (!parsed.success) throw new InvalidSceneError(parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}

function unlocked(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('lockedBy' in value)) return value;
  const rest = { ...(value as Record<string, unknown>) };
  delete rest.lockedBy;
  return rest;
}

function locked(value: unknown, lock: boolean): unknown {
  if (value === undefined || typeof value !== 'object' || value === null) return value;
  return lock ? { ...(value as object), lockedBy: 'creator' } : unlocked(value);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left ?? null) === canonical(right ?? null);
}

function isLocked(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { lockedBy?: unknown }).lockedBy === 'creator';
}

/** Rebuild the document as it was at `rev` by undoing later revisions from the head. */
export function sceneAt(head: SceneHead, log: readonly SceneRevision[], rev: number): SceneDoc {
  if (rev === head.rev) return head.doc;
  if (rev < 0 || rev > head.rev) throw new SceneBaseUnavailableError(`revision ${rev} is outside 0..${head.rev}`);
  const units = sceneUnits(head.doc);
  for (let at = head.rev; at > rev; at -= 1) {
    const revision = log.find((candidate) => candidate.rev === at);
    if (revision === undefined) throw new SceneBaseUnavailableError(`revision ${at} is missing from the log`);
    if (revision.source === 'migration') {
      throw new SceneBaseUnavailableError(`revision ${at} migrated the scene; pull it again`);
    }
    for (const change of revision.changes) {
      if (change.before === undefined) units.delete(change.unit);
      else units.set(change.unit, change.before);
    }
  }
  return fromUnits(head.doc, units);
}

function containers(unit: string, ...values: unknown[]): string[] {
  const [kind, id] = unit.split(':') as [string, string];
  if (kind === 'tile') return [`layer:${id}`];
  if (kind !== 'object') return [];
  return values.flatMap((value) => {
    const layer = (value as { layer?: unknown } | undefined)?.layer;
    return typeof layer === 'string' ? [`layer:${layer}`] : [];
  });
}

export type CommitSceneInput = {
  head: SceneHead;
  log: readonly SceneRevision[];
  /** The writer's whole document, edited from the document at `baseRev`. */
  doc: SceneDoc;
  baseRev: number;
  author: SceneAuthor;
  source: SceneSource;
  label: string;
  now: Date;
};

export type CommitSceneResult =
  | { ok: true; head: SceneHead; revision: SceneRevision | null; rebased: boolean }
  | { ok: false; conflicts: SceneConflict[] };

/**
 * Apply a writer's edits on the current head. A creator's edits always apply and lock what they touch; an agent's
 * edit to anything the creator locked, or to a unit another writer changed after the agent's base, refuses the whole
 * push with the conflicts.
 */
export function commitScene(input: CommitSceneInput): CommitSceneResult {
  const { head, log, author } = input;
  if (input.doc.game !== head.doc.game || input.doc.scene !== head.doc.scene) {
    throw new InvalidSceneError(
      `document is ${input.doc.game}/${input.doc.scene}, not ${head.doc.game}/${head.doc.scene}`,
    );
  }
  const agent = isAgent(author);
  const base = sceneUnits(sceneAt(head, log, input.baseRev));
  const mine = sceneUnits(input.doc);
  const current = sceneUnits(head.doc);

  const lastChange = new Map<string, SceneRevision>();
  for (const revision of [...log].sort((left, right) => left.rev - right.rev)) {
    if (revision.rev > head.rev) continue;
    for (const change of revision.changes) lastChange.set(change.unit, revision);
  }

  const next: Units = new Map(current);
  const conflicts: SceneConflict[] = [];
  for (const unit of new Set([...base.keys(), ...mine.keys()])) {
    const value = mine.get(unit);
    const edited = !same(unlocked(base.get(unit)), unlocked(value));
    if (!agent) {
      if (edited) {
        if (value === undefined) next.delete(unit);
        // `meta` is document fields, not a unit that can carry a lock.
        else next.set(unit, unit === 'meta' ? value : locked(value, true));
      } else if (
        unit !== 'meta' &&
        value !== undefined &&
        current.has(unit) &&
        isLocked(value) !== isLocked(base.get(unit))
      ) {
        // Locking or unlocking without another change: the creator hands a unit back to the agents, or claims it.
        next.set(unit, locked(current.get(unit), isLocked(value)));
      }
      continue;
    }
    if (!edited) continue;
    const theirs = current.get(unit);
    // Already what the agent wants (both deleted it, or both made the same change): nothing to write or refuse.
    if ((theirs === undefined) === (value === undefined) && same(unlocked(theirs), unlocked(value))) continue;
    const by = lastChange.get(unit);
    const creatorDeleted = theirs === undefined && by !== undefined && !isAgent(by.author);
    const lockedHere =
      isLocked(theirs) ||
      creatorDeleted ||
      containers(unit, theirs, value).some((container) => isLocked(current.get(container)));
    const changedSinceBase = by !== undefined && by.rev > input.baseRev && !same(unlocked(theirs), unlocked(value));
    if (lockedHere || changedSinceBase) {
      conflicts.push({
        unit,
        reason: lockedHere ? 'creator_locked' : 'changed_since_base',
        ...(theirs === undefined ? {} : { theirs }),
        ...(value === undefined ? {} : { mine: value }),
        ...(by === undefined ? {} : { by: by.author }),
      });
      continue;
    }
    if (value === undefined) next.delete(unit);
    else next.set(unit, unlocked(value));
  }
  // A tile or object whose layer is gone (one writer deleted the layer while another added to it): a creator's delete
  // takes its contents with it; an agent's add into, or delete of, a layer it no longer shares is refused.
  for (const [unit, value] of [...next]) {
    const [layer] = containers(unit, value);
    if (layer === undefined || next.has(layer)) continue;
    if (!agent) {
      next.delete(unit);
      continue;
    }
    // Either the agent added `unit` to a layer someone else deleted, or deleted a layer someone else added `unit` to.
    const added = mine.has(layer);
    const by = lastChange.get(added ? layer : unit);
    const theirs = current.get(unit);
    conflicts.push({
      unit,
      reason: (by !== undefined && !isAgent(by.author)) || isLocked(value) ? 'creator_locked' : 'changed_since_base',
      ...(theirs === undefined ? {} : { theirs }),
      ...(added ? { mine: value } : {}),
      ...(by === undefined ? {} : { by: by.author }),
    });
  }
  if (conflicts.length > 0) return { ok: false, conflicts };

  const doc = fromUnits(head.doc, next);
  const changes: SceneChange[] = [];
  for (const unit of new Set([...current.keys(), ...next.keys()])) {
    const before = current.get(unit);
    const after = next.get(unit);
    if (same(before, after) && (before === undefined) === (after === undefined)) continue;
    changes.push({ unit, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) });
  }
  const rebased = input.baseRev < head.rev;
  if (changes.length === 0) return { ok: true, head, revision: null, rebased };
  const revision: SceneRevision = {
    rev: head.rev + 1,
    parentRev: head.rev,
    baseRev: input.baseRev,
    author,
    source: input.source,
    label: input.label,
    createdAt: input.now.toISOString(),
    changes,
    docHash: sha256Canonical(doc),
  };
  return { ok: true, head: { rev: revision.rev, doc }, revision, rebased };
}

/** One readable line per conflict, for the agent's terminal. */
export function describeConflict(conflict: SceneConflict): string {
  const who = conflict.by ?? 'another writer';
  const action = conflict.mine === undefined ? 'delete' : conflict.theirs === undefined ? 'add' : 'change';
  return conflict.reason === 'creator_locked'
    ? `${conflict.unit}: ${who} owns this; your ${action} was refused (theirs: ${canonical(conflict.theirs ?? null)})`
    : `${conflict.unit}: ${who} changed this after your base; pull and redo your ${action} (theirs: ${canonical(conflict.theirs ?? null)})`;
}
