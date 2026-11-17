import {
  RoomServerMessageSchema,
  RoomStateSchema,
  type RoomServerMessage,
  type RoomState,
  type ServerMessage,
} from '@ogm/contracts/browser';

/*
 * A protocol-2 room's `welcome.state` carries the seat table, the epoch and the ruleset pin on top of the
 * v1 editor state (#497 §3.10). `RoomStateSchema` is `.strict()`, so the v1 web client would drop that
 * welcome silently and sit in `connecting` until its 10 s timeout.
 *
 * Until the protocol-2 web client exists (N5) this module keeps the editor working against a v2 room: it
 * projects the v1-shaped part of a v2 document and ignores the v2-only messages, which no v1 screen reads.
 */

const V2_ONLY_KEYS = [
  'seats',
  'spectators',
  'epoch',
  'startAt',
  'pausedAt',
  'primarySeat',
  'seed',
  'rulesetHash',
  'matchPausedBy',
  'matchPauseName',
  'matchResumeAt',
] as const;

/** The v1 view of a room document, whether the room runs protocol 1 or 2. */
export function roomStateV1From(raw: unknown): RoomState | undefined {
  const v1 = RoomStateSchema.safeParse(raw);
  if (v1.success) return v1.data;
  if (raw === null || typeof raw !== 'object') return undefined;
  const copy: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of V2_ONLY_KEYS) delete copy[key];
  const projected = RoomStateSchema.safeParse(copy);
  return projected.success ? projected.data : undefined;
}

/** Parses one server frame from either protocol and returns the v1 message the editor understands. */
export function serverMessageV1(raw: unknown): ServerMessage | undefined {
  const parsed = RoomServerMessageSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return projectServerMessage(parsed.data);
}

export function projectServerMessage(message: RoomServerMessage): ServerMessage | undefined {
  if (!message.t.startsWith('net.')) {
    if (message.t !== 'welcome') return message as ServerMessage;
    const state = roomStateV1From(message.state);
    if (state === undefined) return undefined;
    const { userId, playerIndex, sessionId } = message.you;
    return { t: 'welcome', you: { userId, playerIndex: Math.max(0, playerIndex), sessionId }, state };
  }
  /* The relayed v2 families are N5's surface; the v1 editor screens read none of them. */
  return undefined;
}
