import type { CreateJobRequest } from '@ogm/contracts/browser';

import { editJobRequest } from '../../build-chat/edit';
import type { Hd2dDoc } from './controls';

/** A job's summary holds at most this much; a cut document would not parse, so it is refused whole. */
const SUMMARY_MAX = 4000;

/**
 * Kevin's Save: the game's agent writes the document he tuned over the scene's own HD-2D document, exactly, so the
 * next build plays what he saw. Like the editor's light presets, it goes to the agent until scene documents are saved
 * by the editor itself (#1209).
 */
export function hd2dSaveRequest(
  target: { gameId: string; branchId: string },
  edit: { scene?: string; doc: Hd2dDoc },
  idempotencyKey: string,
): CreateJobRequest {
  const where = edit.scene ? `the ${JSON.stringify(edit.scene)} scene` : 'the scene the editor shows';
  const text = `Keep the lighting I set in the editor for ${where}: replace its HD-2D scene document with exactly this one, then rebuild. ${JSON.stringify(edit.doc)}`;
  if (text.length > SUMMARY_MAX) throw new RangeError('the lighting is too large to send');
  return editJobRequest(target, text, 'now', idempotencyKey);
}
