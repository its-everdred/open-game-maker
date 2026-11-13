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
    const previous = entityOps[args.entityId];
    if (previous?.kind === 'create') {
      entityOps[args.entityId] = { ...previous, props: { ...previous.props, pose: args.pose }, txId: tx.id };
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
    for (const command of tx.commands) {
      if (command.op === 'invoke') {
        if (command.command === 'build.switch') {
          clearRecord(entries);
          clearRecord(entityOps);
        } else {
          recordEntityOverride(entityOps, tx, command);
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
