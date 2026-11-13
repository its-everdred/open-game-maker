import { isDeepStrictEqual } from 'node:util';

import {
  controlDeclSchema,
  type ControlDecl,
  type DesignDoc,
  type EntityOverride,
  type GameManifest,
  type OverrideEntry,
  type OverrideKey,
  type Patch,
  type ReapplyReport,
  type WorkingSet,
} from '@ogm/contracts';

import { validateValue } from './validate.js';

export type ReapplyBuild = { buildId: string; baseDoc: DesignDoc; manifest: GameManifest };
export type ReapplyInput = {
  from: ReapplyBuild;
  to: ReapplyBuild;
  workingSet: WorkingSet;
  targetControls: readonly string[];
};
export type ReapplyResult = {
  report: ReapplyReport;
  rebased: WorkingSet;
  switchPatches: Patch[];
  switchInverse: Patch[];
};

function controlsFrom(manifest: GameManifest): Map<string, ControlDecl> {
  const controls = (manifest as Record<string, unknown>).controls;
  const parsed = controlDeclSchema.array().safeParse(controls ?? []);
  if (!parsed.success) throw parsed.error;
  return new Map(parsed.data.map((control) => [control.id, control]));
}

function baseValue(doc: DesignDoc, controlId: string, targetId: OverrideEntry['targetId']): unknown {
  return targetId === 'global' ? doc.globals[controlId] : doc.entities[targetId]?.props[controlId];
}

function allowedValue(control: ControlDecl, value: unknown): unknown {
  switch (control.widget.kind) {
    case 'slider':
      if (typeof value !== 'number' || !Number.isFinite(value)) return control.default;
      return Math.min(control.widget.max, Math.max(control.widget.min, value));
    case 'count':
      if (typeof value !== 'number' || !Number.isFinite(value)) return control.default;
      return Math.min(control.widget.max, Math.max(control.widget.min, Math.round(value)));
    default:
      return control.default;
  }
}

function propertyPath(targetId: OverrideEntry['targetId'], controlId: string): Patch['path'] {
  return targetId === 'global' ? ['globals', controlId] : ['entities', targetId, 'props', controlId];
}

function appendSetPatch(patches: Patch[], inverse: Patch[], doc: DesignDoc, entry: OverrideEntry): void {
  const current = baseValue(doc, entry.controlId, entry.targetId);
  const path = propertyPath(entry.targetId, entry.controlId);
  patches.push({ op: current === undefined ? 'add' : 'replace', path, value: entry.value });
  inverse.unshift(
    current === undefined ? { op: 'remove', path } : { op: 'replace', path, value: structuredClone(current) },
  );
  if (entry.targetId === 'global') doc.globals[entry.controlId] = structuredClone(entry.value);
  else doc.entities[entry.targetId]!.props[entry.controlId] = structuredClone(entry.value);
}

function drop(report: ReapplyReport, entry: OverrideEntry, reason: ReapplyReport['dropped'][number]['reason']): void {
  report.dropped.push({ key: entry.key, reason });
}

function cleanEntry(entry: OverrideEntry, changes: Partial<OverrideEntry>): OverrideEntry {
  const result = { ...entry, ...changes };
  if (!Object.hasOwn(changes, 'reason')) delete result.reason;
  return result;
}

export function reapply(input: ReapplyInput): ReapplyResult {
  const controls = controlsFrom(input.to.manifest);
  const aliases = input.to.manifest.overrides.aliases;
  const retired = new Set(input.to.manifest.overrides.retired);
  const migrate = new Set(input.to.manifest.overrides.migrate ?? []);
  const targetControls = new Set(input.targetControls);
  const levels = new Set(Object.values(input.to.baseDoc.entities).map((entity) => entity.level));
  const rebasedEntityOps: Record<string, EntityOverride> = {};

  for (const [entityId, operation] of Object.entries(input.workingSet.entityOps).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (operation.kind === 'create') {
      if (levels.has(operation.parent)) rebasedEntityOps[entityId] = structuredClone(operation);
    } else if (input.to.baseDoc.entities[entityId] !== undefined) {
      rebasedEntityOps[entityId] = structuredClone(operation);
    }
  }

  const report: ReapplyReport = {
    gameId: input.workingSet.gameId,
    branchId: input.workingSet.branchId,
    fromBuildId: input.from.buildId,
    toBuildId: input.to.buildId,
    carried: [],
    renamed: [],
    needsChoice: [],
    conflicts: [],
    dropped: [],
  };
  const rebasedEntries = {} as Record<OverrideKey, OverrideEntry>;

  for (const original of Object.values(input.workingSet.entries).sort((left, right) =>
    left.key.localeCompare(right.key),
  )) {
    const aliasedControl = aliases[original.controlId];
    const controlId = aliasedControl ?? original.controlId;
    const key = `${controlId}@${original.targetId}` as OverrideKey;
    const entry = cleanEntry(original, { key, controlId });
    const wasRenamed = aliasedControl !== undefined;

    if (wasRenamed) report.renamed.push({ from: original.key, to: key });
    if (targetControls.has(original.controlId) || targetControls.has(controlId)) {
      drop(report, entry, 'superseded_by_job');
      continue;
    }
    const targetExists =
      entry.targetId === 'global' ||
      rebasedEntityOps[entry.targetId]?.kind === 'create' ||
      (input.to.baseDoc.entities[entry.targetId] !== undefined && rebasedEntityOps[entry.targetId]?.kind !== 'delete');
    if (!targetExists) {
      drop(report, entry, 'target_removed');
      continue;
    }
    const control = controls.get(controlId);
    if (control === undefined || retired.has(original.controlId) || retired.has(controlId)) {
      drop(report, entry, 'control_removed');
      continue;
    }

    const builder = baseValue(input.to.baseDoc, controlId, entry.targetId);
    if (migrate.has(original.controlId) || migrate.has(controlId)) {
      report.needsChoice.push({ key, mine: entry.value, allowed: control.default });
      rebasedEntries[key] = cleanEntry(entry, {
        baseValueAtEdit: builder,
        status: 'needs_choice',
        reason: 'migration_failed',
      });
      continue;
    }
    if (!validateValue(control, entry.value).ok) {
      report.needsChoice.push({ key, mine: entry.value, allowed: allowedValue(control, entry.value) });
      rebasedEntries[key] = cleanEntry(entry, {
        baseValueAtEdit: builder,
        status: 'needs_choice',
        reason: 'value_invalid',
      });
      continue;
    }

    if (isDeepStrictEqual(builder, original.baseValueAtEdit) || isDeepStrictEqual(builder, entry.value)) {
      if (!wasRenamed) report.carried.push(key);
      rebasedEntries[key] = cleanEntry(entry, { baseValueAtEdit: builder, status: wasRenamed ? 'renamed' : 'carried' });
      continue;
    }

    report.conflicts.push({ key, mine: entry.value, builder });
    rebasedEntries[key] = cleanEntry(entry, {
      baseValueAtEdit: builder,
      status: 'conflict',
      reason: 'builder_changed',
    });
  }

  report.carried.sort();
  report.renamed.sort((left, right) => left.from.localeCompare(right.from));
  report.needsChoice.sort((left, right) => left.key.localeCompare(right.key));
  report.conflicts.sort((left, right) => left.key.localeCompare(right.key));
  report.dropped.sort((left, right) => left.key.localeCompare(right.key));

  const patches: Patch[] = [];
  const inverse: Patch[] = [];
  const nextDoc = structuredClone(input.to.baseDoc);
  for (const operation of Object.values(rebasedEntityOps).filter(
    (candidate): candidate is Extract<EntityOverride, { kind: 'create' }> => candidate.kind === 'create',
  )) {
    const entity = {
      id: operation.entityId,
      prefab: operation.prefab,
      level: operation.parent,
      origin: 'creator' as const,
      props: structuredClone(operation.props),
    };
    const path: Patch['path'] = ['entities', operation.entityId];
    const previous = nextDoc.entities[operation.entityId];
    patches.push({ op: previous === undefined ? 'add' : 'replace', path, value: entity });
    inverse.unshift(
      previous === undefined ? { op: 'remove', path } : { op: 'replace', path, value: structuredClone(previous) },
    );
    nextDoc.entities[operation.entityId] = entity;
  }
  for (const operation of Object.values(rebasedEntityOps).filter(
    (candidate): candidate is Extract<EntityOverride, { kind: 'delete' }> => candidate.kind === 'delete',
  )) {
    const previous = nextDoc.entities[operation.entityId];
    if (previous === undefined) continue;
    const path: Patch['path'] = ['entities', operation.entityId];
    patches.push({ op: 'remove', path });
    inverse.unshift({ op: 'add', path, value: structuredClone(previous) });
    delete nextDoc.entities[operation.entityId];
  }
  for (const entry of Object.values(rebasedEntries).sort((left, right) => left.key.localeCompare(right.key))) {
    if (entry.status !== 'needs_choice') appendSetPatch(patches, inverse, nextDoc, entry);
  }

  return {
    report,
    rebased: {
      ...input.workingSet,
      buildId: input.to.buildId,
      entries: rebasedEntries,
      entityOps: rebasedEntityOps,
    },
    switchPatches: patches,
    switchInverse: inverse,
  };
}
