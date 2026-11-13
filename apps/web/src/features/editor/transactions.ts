import {
  poseSchema,
  type DesignDoc,
  type EditorCommand,
  type Entity,
  type Patch,
  type Pose,
} from '@ogm/contracts/browser';
import { apply, makeTransaction, toPointer, validatePatches } from '@ogm/design-log/browser';

import type { TransactionBody } from './api';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type EditorIntent = {
  label: string;
  commands: EditorCommand[];
  patches: Patch[];
  inverse: Patch[];
  doc: DesignDoc;
};

export type TransactionContext = {
  baseRev: number;
  leaseToken: number;
  baseBuildId: string;
  sessionId: string;
};

export class InvalidEditorIntentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEditorIntentError';
  }
}

export function createIntent(doc: DesignDoc, commands: readonly EditorCommand[], label: string): EditorIntent {
  if (commands.some((command) => command.op === 'invoke')) {
    throw new InvalidEditorIntentError('invoke commands require an explicit entity intent');
  }
  const draft = makeTransaction(doc, commands);
  validateIntentPatches(draft.patches, draft.inverse);
  return {
    label,
    commands: [...commands],
    patches: draft.patches,
    inverse: draft.inverse,
    doc: draft.doc,
  };
}

export function createEntityIntent(doc: DesignDoc, entity: Entity, label: string): EditorIntent {
  if (doc.entities[entity.id] !== undefined) {
    throw new InvalidEditorIntentError(`entity ${entity.id} already exists`);
  }
  const command: EditorCommand = {
    op: 'invoke',
    command: 'entity.create',
    args: {
      entityId: entity.id,
      parent: entity.level,
      prefab: entity.prefab,
      props: entity.props,
    },
  };
  const patches: Patch[] = [{ op: 'add', path: ['entities', entity.id], value: entity }];
  const inverse: Patch[] = [{ op: 'remove', path: ['entities', entity.id] }];
  validateIntentPatches(patches, inverse);
  return { label, commands: [command], patches, inverse, doc: apply(doc, patches) };
}

/** A copied scenery entity needs a new scene item ID, derived from its new entity ID. */
export function copyEntity(source: Entity, id: string): Entity {
  const entity: Entity = { ...structuredClone(source), id, origin: 'creator' };
  if (entity.prefab.startsWith('scenery:')) delete entity.props.sceneryItemId;
  return entity;
}

/** Change lighting through a normal global override so build reapply retains it. */
export function sceneryLightIntent(doc: DesignDoc, lighting: 'warm-forest' | 'night' | 'cave'): EditorIntent {
  if (!('scenery.settings' in doc.globals)) throw new InvalidEditorIntentError('scenery settings are unavailable');
  return createIntent(
    doc,
    [{ op: 'set', control: 'scenery.lighting', targets: 'global', value: lighting }],
    'Changed scenery light',
  );
}

export function deleteEntityIntent(doc: DesignDoc, entityId: string, label: string): EditorIntent {
  const entity = doc.entities[entityId];
  if (entity === undefined) throw new InvalidEditorIntentError(`entity ${entityId} does not exist`);
  const command: EditorCommand = {
    op: 'invoke',
    command: 'entity.delete',
    args: { entityId },
    targets: [entityId],
  };
  const patches: Patch[] = [{ op: 'remove', path: ['entities', entityId] }];
  const inverse: Patch[] = [{ op: 'add', path: ['entities', entityId], value: entity }];
  validateIntentPatches(patches, inverse);
  return { label, commands: [command], patches, inverse, doc: apply(doc, patches) };
}

export function updateEntityPoseIntent(doc: DesignDoc, entityId: string, pose: Pose, label: string): EditorIntent {
  const entity = doc.entities[entityId];
  if (entity === undefined) throw new InvalidEditorIntentError(`entity ${entityId} does not exist`);
  const previous = entity.props.pose;
  const command: EditorCommand = {
    op: 'invoke',
    command: 'entity.transform',
    args: { entityId, pose },
    targets: [entityId],
  };
  const path = ['entities', entityId, 'props', 'pose'];
  const patches: Patch[] = [{ op: previous === undefined ? 'add' : 'replace', path, value: pose }];
  const inverse: Patch[] =
    previous === undefined ? [{ op: 'remove', path }] : [{ op: 'replace', path, value: previous }];
  validateIntentPatches(patches, inverse);
  return { label, commands: [command], patches, inverse, doc: apply(doc, patches) };
}

export function updateSceneryTransformIntent(
  doc: DesignDoc,
  entityId: string,
  pose: Pose,
  scale: [number, number, number],
  label: string,
): EditorIntent {
  const entity = doc.entities[entityId];
  if (!entity?.prefab.startsWith('scenery:') || scale.some((part) => !Number.isFinite(part) || part <= 0)) {
    throw new InvalidEditorIntentError('invalid scenery transform');
  }
  const intent = updateEntityPoseIntent(doc, entityId, pose, label);
  const previous = entity.props.scale;
  const path = ['entities', entityId, 'props', 'scale'];
  const patch: Patch = { op: previous === undefined ? 'add' : 'replace', path, value: scale };
  const inverse: Patch = previous === undefined ? { op: 'remove', path } : { op: 'replace', path, value: previous };
  const commands: EditorCommand[] = [
    { op: 'invoke', command: 'entity.transform', args: { entityId, pose, scale }, targets: [entityId] },
  ];
  const patches = [...intent.patches, patch];
  const inverses = [inverse, ...intent.inverse];
  validateIntentPatches(patches, inverses);
  return { label, commands, patches, inverse: inverses, doc: apply(doc, patches) };
}

export function coalesceIntents(intents: readonly EditorIntent[], label: string): EditorIntent {
  if (intents.length === 0) throw new InvalidEditorIntentError('cannot coalesce an empty intent list');

  const finalPatches = new Map<string, Patch>();
  const firstInverse = new Map<string, Patch>();
  const pathOrder: string[] = [];
  for (const intent of intents) {
    for (const patch of intent.patches) {
      const pointer = toPointer(patch.path);
      if (!finalPatches.has(pointer)) pathOrder.push(pointer);
      finalPatches.set(pointer, patch);
    }
    for (const patch of intent.inverse) {
      const pointer = toPointer(patch.path);
      if (!firstInverse.has(pointer)) firstInverse.set(pointer, patch);
    }
  }

  const patches = pathOrder.map((pointer) => finalPatches.get(pointer)!);
  const inverse = [...pathOrder].reverse().map((pointer) => firstInverse.get(pointer)!);
  validateIntentPatches(patches, inverse);
  return {
    label,
    commands: intents.flatMap((intent) => intent.commands),
    patches,
    inverse,
    doc: intents.at(-1)!.doc,
  };
}

export function replayIntent(intent: EditorIntent, doc: DesignDoc): EditorIntent {
  const replayed: EditorIntent[] = [];
  let current = doc;
  for (const command of intent.commands) {
    const next = replayCommand(current, command, intent.label);
    replayed.push(next);
    current = next.doc;
  }
  return replayed.length === 1 ? replayed[0]! : coalesceIntents(replayed, intent.label);
}

export function toTransactionBody(intent: EditorIntent, context: TransactionContext): TransactionBody {
  return {
    baseRev: context.baseRev,
    leaseToken: context.leaseToken,
    kind: 'manual',
    label: intent.label,
    baseBuildId: context.baseBuildId,
    commands: intent.commands,
    patches: intent.patches,
    inverse: intent.inverse,
    sessionId: context.sessionId,
  };
}

export function createStableId(prefix = '', now = Date.now(), random?: Uint8Array): string {
  if (prefix !== '' && !/^[a-z][a-z0-9]*_$/.test(prefix)) {
    throw new TypeError('stable id prefix must be lowercase alphanumeric and end in underscore');
  }
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new RangeError('stable id timestamp must fit 48 bits');
  }
  const bytes = random ?? globalThis.crypto.getRandomValues(new Uint8Array(10));
  if (bytes.length !== 10) throw new RangeError('stable id randomness must contain 10 bytes');

  let time = now;
  const timeChars = Array<string>(10);
  for (let index = timeChars.length - 1; index >= 0; index -= 1) {
    timeChars[index] = CROCKFORD[time % 32]!;
    time = Math.floor(time / 32);
  }
  let randomValue = 0n;
  for (const byte of bytes) randomValue = (randomValue << 8n) | BigInt(byte);
  const randomChars = Array<string>(16);
  for (let index = randomChars.length - 1; index >= 0; index -= 1) {
    randomChars[index] = CROCKFORD[Number(randomValue & 31n)]!;
    randomValue >>= 5n;
  }
  return `${prefix}${timeChars.join('')}${randomChars.join('')}`;
}

function replayCommand(doc: DesignDoc, command: EditorCommand, label: string): EditorIntent {
  if (command.op !== 'invoke') return createIntent(doc, [command], label);
  const args = asRecord(command.args);
  if (command.command === 'entity.create') {
    const entityId = stringArg(args, 'entityId');
    const prefab = stringArg(args, 'prefab');
    const level = stringArg(args, 'parent');
    const props = asRecord(args?.props);
    if (props === undefined) throw new InvalidEditorIntentError('entity.create props are invalid');
    return createEntityIntent(doc, { id: entityId, prefab, level, origin: 'creator', props }, label);
  }
  if (command.command === 'entity.delete') {
    return deleteEntityIntent(doc, stringArg(args, 'entityId'), label);
  }
  if (command.command === 'entity.transform') {
    const pose = poseSchema.safeParse(args?.pose);
    if (!pose.success) throw new InvalidEditorIntentError('entity.transform pose is invalid');
    if (Array.isArray(args?.scale) && args.scale.length === 3 && args.scale.every((part) => typeof part === 'number')) {
      return updateSceneryTransformIntent(
        doc,
        stringArg(args, 'entityId'),
        pose.data,
        args.scale as [number, number, number],
        label,
      );
    }
    return updateEntityPoseIntent(doc, stringArg(args, 'entityId'), pose.data, label);
  }
  throw new InvalidEditorIntentError(`unsupported invoke command ${command.command}`);
}

function validateIntentPatches(patches: readonly Patch[], inverse: readonly Patch[]): void {
  for (const candidate of [patches, inverse]) {
    const result = validatePatches(candidate);
    if (!result.ok) throw new InvalidEditorIntentError(result.errors.map((error) => error.code).join(', '));
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArg(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  if (typeof value !== 'string') throw new InvalidEditorIntentError(`${key} is invalid`);
  return value;
}
