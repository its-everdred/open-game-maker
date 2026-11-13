import type {
  DesignDoc,
  EditorCommand,
  EntityOverride,
  OverrideEntry,
  OverrideKey,
  Transaction,
  WorkingSet,
} from '@ogm/contracts';

export type ReduceInput = {
  gameId: string;
  branchId: string;
  buildId: string;
  baseDoc: DesignDoc;
  baseDocs?: Readonly<Record<string, DesignDoc>>;
  txs: readonly Transaction[];
};

export class InvalidEntityCommandError extends Error {
  constructor(command: string) {
    super(`invalid ${command} arguments`);
    this.name = 'InvalidEntityCommandError';
  }
}

export class InvalidLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLogError';
  }
}

function baseValue(doc: DesignDoc, control: string, target: string | 'global'): unknown {
  return target === 'global' ? doc.globals[control] : doc.entities[target]?.props[control];
}

function targets(command: Extract<EditorCommand, { op: 'set' | 'reset' }>): readonly (string | 'global')[] {
  return command.targets === 'global' ? ['global'] : command.targets;
}

function recordOverride(
  entries: Record<OverrideKey, OverrideEntry>,
  baseDoc: DesignDoc,
  tx: Transaction,
  command: Extract<EditorCommand, { op: 'set' | 'reset' }>,
): void {
  for (const target of targets(command)) {
    const key = `${command.control}@${target}` as OverrideKey;
    if (command.op === 'reset') {
      delete entries[key];
      continue;
    }
    entries[key] = {
      key,
      controlId: command.control,
      targetId: target,
      value: command.value,
      baseValueAtEdit: baseValue(baseDoc, command.control, target),
      txId: tx.id,
      rev: tx.rev,
      status: 'carried',
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function clearRecord(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) delete record[key];
}

function recordEntityOverride(
  entityOps: Record<string, EntityOverride>,
  baseDoc: DesignDoc,
  tx: Transaction,
  command: Extract<EditorCommand, { op: 'invoke' }>,
): void {
  if (command.command === 'entity.create') {
    const args = asRecord(command.args);
    const props = asRecord(args?.props);
    if (
      args === undefined ||
      typeof args.entityId !== 'string' ||
      typeof args.parent !== 'string' ||
      typeof args.prefab !== 'string' ||
      props === undefined
    ) {
      throw new InvalidEntityCommandError(command.command);
    }
    entityOps[args.entityId] = {
      kind: 'create',
      entityId: args.entityId,
      parent: args.parent,
      prefab: args.prefab,
      props,
      txId: tx.id,
    };
  } else if (command.command === 'entity.delete') {
    const args = asRecord(command.args);
    const entityIds =
      typeof args?.entityId === 'string' ? [args.entityId] : command.targets === undefined ? [] : command.targets;
    if (entityIds.length === 0) throw new InvalidEntityCommandError(command.command);
    for (const entityId of entityIds) {
      entityOps[entityId] = { kind: 'delete', entityId, txId: tx.id };
    }
  } else if (command.command === 'entity.transform') {
    const args = asRecord(command.args);
    if (typeof args?.entityId !== 'string' || asRecord(args.pose) === undefined) return;
    let previous = entityOps[args.entityId];
    const baseEntity = baseDoc.entities[args.entityId];
    if (!previous && baseEntity?.prefab.startsWith('scenery:')) {
      previous = {
        kind: 'create',
        entityId: baseEntity.id,
        parent: baseEntity.level,
        prefab: baseEntity.prefab,
        props: baseEntity.props,
        txId: tx.id,
      };
    }
    if (previous?.kind === 'create') {
      entityOps[args.entityId] = {
        ...previous,
        props: { ...previous.props, pose: args.pose, ...(Array.isArray(args.scale) ? { scale: args.scale } : {}) },
        txId: tx.id,
      };
    }
  }
}

// Undo transactions contain inverse patches rather than commands. Fold scenery
// changes into the same working set so a later build does not resurrect them.
function recordSceneryUndo(entityOps: Record<string, EntityOverride>, tx: Transaction): void {
  for (const patch of tx.patches) {
    const [root, id, field, property] = patch.path;
    if (root !== 'entities' || typeof id !== 'string') continue;
    const previous = entityOps[id];
    if (
      patch.path.length === 2 &&
      patch.op === 'remove' &&
      previous?.kind === 'create' &&
      previous.prefab.startsWith('scenery:')
    ) {
      entityOps[id] = { kind: 'delete', entityId: id, txId: tx.id };
    } else if (patch.path.length === 2 && patch.op === 'add') {
      const entity = asRecord(patch.value);
      const props = asRecord(entity?.props);
      if (
        typeof entity?.prefab === 'string' &&
        entity.prefab.startsWith('scenery:') &&
        typeof entity.level === 'string' &&
        props
      ) {
        entityOps[id] = {
          kind: 'create',
          entityId: id,
          parent: entity.level,
          prefab: entity.prefab,
          props,
          txId: tx.id,
        };
      }
    } else if (
      field === 'props' &&
      (property === 'pose' || property === 'scale') &&
      patch.path.length === 4 &&
      previous?.kind === 'create' &&
      previous.prefab.startsWith('scenery:')
    ) {
      const props = { ...previous.props };
      if (patch.op === 'remove') delete props[property];
      else props[property] = patch.value;
      entityOps[id] = { ...previous, props, txId: tx.id };
    }
  }
}

export function reduce(input: ReduceInput): WorkingSet {
  const entries = {} as Record<OverrideKey, OverrideEntry>;
  const entityOps: Record<string, EntityOverride> = {};
  const txs = [...input.txs].sort((left, right) => left.rev - right.rev);
  let previousRevision: number | undefined;

  for (const tx of txs) {
    if (tx.gameId !== input.gameId || tx.branchId !== input.branchId) {
      throw new InvalidLogError(`transaction ${tx.id} does not belong to ${input.gameId}/${input.branchId}`);
    }
    if (tx.rev === previousRevision) throw new InvalidLogError(`duplicate revision ${tx.rev}`);
    previousRevision = tx.rev;
    const transactionBase = input.baseDocs?.[tx.baseBuildId] ?? input.baseDoc;
    if (tx.commands.length === 0) {
      recordSceneryUndo(entityOps, tx);
      for (const patch of tx.patches) {
        if (
          patch.path.length !== 2 ||
          patch.path[0] !== 'globals' ||
          !['scenery.lighting', 'scenery.terrain', 'scenery.backdrop'].includes(String(patch.path[1]))
        )
          continue;
        const control = patch.path[1] as string;
        const command: Extract<EditorCommand, { op: 'set' | 'reset' }> =
          patch.op === 'remove'
            ? { op: 'reset', control, targets: 'global' }
            : { op: 'set', control, targets: 'global', value: patch.value };
        recordOverride(entries, transactionBase, tx, command);
      }
    }
    for (const command of tx.commands) {
      if (command.op === 'invoke') {
        if (command.command === 'build.switch') {
          clearRecord(entries);
          clearRecord(entityOps);
        } else {
          recordEntityOverride(entityOps, transactionBase, tx, command);
        }
      } else {
        recordOverride(entries, transactionBase, tx, command);
      }
    }
  }

  return {
    gameId: input.gameId,
    branchId: input.branchId,
    buildId: input.buildId,
    headRev: txs.at(-1)?.rev ?? 0,
    entries,
    entityOps,
  };
}
