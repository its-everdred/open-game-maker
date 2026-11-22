import type { ComposerErrorDetail } from '@aiur/conversation';
import { apiFetch, ApiError } from '../../lib/api/client';

export type ComposerFailure = { code: string; message: string; text: string };

/** An Error with a stable code the composer can name to the creator and report. */
export function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code) return code;
  if (error instanceof ApiError) return `api_${error.status}`;
  return error instanceof Error ? error.name : 'unknown';
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  /* Only the cause's name: a WebSocket URL error message can carry the voice token. */
  const name = error instanceof Error ? (error.cause as { name?: unknown } | undefined)?.name : undefined;
  const cause = typeof name === 'string' ? ` (cause ${name})` : '';
  return message + cause;
}

const MIC_BLOCKED =
  'Microphone blocked. In Safari tap aA, Website Settings, Microphone, Allow; or Settings, Apps, Safari, Microphone.';
const UNAVAILABLE = new Set([
  'voice_unavailable',
  'unsupported',
  'token_error',
  'unauthorized',
  'api_403',
  'api_404',
  'api_503',
]);

function creatorText(action: ComposerErrorDetail['action'], code: string): string {
  if (code === 'mic_denied') return MIC_BLOCKED;
  if (code === 'starting') return 'Still starting. Try again in a moment.';
  if (action === 'send') return 'Message not sent.';
  if (action === 'upload') return 'Attachment not added.';
  if (UNAVAILABLE.has(code)) return 'Voice unavailable.';
  return 'Voice could not start.';
}

export function describeComposerError({ action, error }: ComposerErrorDetail): ComposerFailure {
  const code = errorCode(error);
  return { code, message: errorMessage(error), text: `${creatorText(action, code)} (${action}: ${code})` };
}

/** Best effort: the report must never surface a second error to the creator. */
export function reportComposerError(
  action: ComposerErrorDetail['action'],
  failure: ComposerFailure,
  targetKind?: string,
) {
  void apiFetch('/voice/client-error', {
    method: 'POST',
    json: {
      action,
      code: failure.code.slice(0, 64),
      message: failure.message.slice(0, 500),
      ...(targetKind ? { target_kind: targetKind } : {}),
    },
  }).catch(() => {});
}
