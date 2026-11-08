import type { Decision } from '@ogm/aiur-client';

import type { StoredCheckpoint } from '../build-chat/store.js';
import { isForCreator } from '../checkpoints/correlate.js';

// Kevin (2026-11-08): the creator sees player-facing decisions only. Engineering and operations Commands go to the
// Executor and never reach a creator view (the menu count, the decision list, the review deck, a game's inbox). Aiur
// has no audience field yet, so a decision counts as the creator's only when `isForCreator` finds the creator marker
// (`gm decide` writes it) or a gm checkpoint marker; a decision without either is hidden from creator views.
export function creatorAudience(decision: Decision): 'creator' | undefined {
  return isForCreator(decision) ? 'creator' : undefined;
}

// A builder's checkpoint (`checkpoint.open`) is a question the build asks the player, so it is the creator's by
// construction; aiur's id is correlated onto it later, so its checkpoint id differs from its decision id. A decision
// mirrored from the job's ticket keeps aiur's decision id as its checkpoint id and needs the creator audience.
export function isCreatorCheckpoint(checkpoint: StoredCheckpoint): boolean {
  if (checkpoint.checkpoint_id !== checkpoint.decision_id) return true;
  return checkpoint.audience === 'creator';
}
