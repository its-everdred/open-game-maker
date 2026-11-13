import type { StoreApi } from 'zustand/vanilla';

import type { Entity, GameManifest, PlacementResult, Pose } from '@ogm/contracts/browser';

import { entityPose } from './canvas';
import type { GameFrameController } from './frame';
import type { EditorSessionState } from './session';
import { createEntityIntent, createStableId, deleteEntityIntent } from './transactions';

export type InstanceCountChange = {
  direction: -1 | 1;
  prefab: string;
  targetIds: readonly string[];
};

export async function changeInstanceCount(
  change: InstanceCountChange,
  manifest: GameManifest,
  frame: GameFrameController,
  session: StoreApi<EditorSessionState>,
  validationTimeoutMs = 3_000,
): Promise<PlacementResult> {
  const state = session.getState();
  if (state.readOnly) return { ok: false, reason: 'Editing is read only.' };

  if (change.direction === -1) {
    const entity = lastTarget(state.doc.entities, change.targetIds);
    if (entity === undefined) return { ok: false, reason: 'There is no instance to remove.' };
    await state.submit(deleteEntityIntent(state.doc, entity.id, `Removed ${change.prefab}`));
    return { ok: true };
  }

  const anchor = lastTarget(state.doc.entities, change.targetIds);
  const pose = adjacentPose(anchor, manifest.grid?.size ?? 1);
  const result = await frame.validatePlacement(change.prefab, pose, validationTimeoutMs);
  if (!result.ok) return result;

  const entity: Entity = {
    id: createStableId('e_'),
    prefab: change.prefab,
    level: anchor?.level ?? manifest.view,
    origin: 'creator',
    props: { pose },
  };
  await session.getState().submit(createEntityIntent(session.getState().doc, entity, `Added ${change.prefab}`));
  return { ok: true };
}

function adjacentPose(anchor: Entity | undefined, step: number): Pose {
  const pose = entityPose(anchor?.props);
  return { ...pose, position: [pose.position[0] + step, pose.position[1], pose.position[2]] };
}

function lastTarget(entities: Record<string, Entity>, targetIds: readonly string[]): Entity | undefined {
  return [...targetIds]
    .reverse()
    .map((id) => entities[id])
    .find((entity) => entity !== undefined);
}
