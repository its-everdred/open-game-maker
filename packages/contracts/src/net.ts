import { z } from 'zod';

import { ClientMessageSchema, InputFrameSchema, LIMITS_V2, RoomStateSchema, ServerMessageSchema } from './room.js';

/*
 * Net protocol v2 (`docs/plans/netcode-platform.md` §4.4/§7/§9.2/§9.3). One contract family: the authority modes a
 * manifest may declare, the wire messages of a per-seat match, the seat/start records the room hands each client,
 * and the room's v2 control messages. `InputFrameSchema` is room.ts's, imported rather than copied: the frame the
 * SDK emits is the frame the room validates, and a copy is a drift source (the copy rule in `bridge.ts` is about
 * keeping engine packages free of room code, which does not apply inside this package).
 *
 * Binary payloads travel as base64 strings (`netData`), the form the bridge and the SDK codec already use, so the
 * emitted JSON schemas validate the wire form directly.
 */

const id = z.string().min(1);
const eventId = z.string().min(1).max(64);
const int = z.number().int();
const nonNegativeInt = int.nonnegative();
const seatIndex = nonNegativeInt.max(LIMITS_V2.maxPlayersCeiling - 1);
const teamIndex = nonNegativeInt.max(7);
const uint32 = nonNegativeInt.max(4_294_967_295);
const epochId = id;
const tick = nonNegativeInt;

/** A base64 payload of at most `bytes`; the wire is JSON, so the cap is the encoded character count. */
const netData = (bytes: number) => z.string().max(Math.ceil(bytes / 3) * 4);

export const AUTHORITY_MODES = ['per-seat', 'host', 'rollback'] as const;
export type AuthorityMode = (typeof AUTHORITY_MODES)[number];
export const authorityModeSchema = z.enum(AUTHORITY_MODES);

/** Absent means `'host'`, which keeps every build written before v2 on today's code path. */
export const netManifestSchema = z.strictObject({
  authority: authorityModeSchema.optional(),
  maxSeats: z.number().int().min(1).max(LIMITS_V2.maxPlayersCeiling),
  inputDelayTicks: z.number().int().min(2).max(8).optional(),
  seatStateHz: z.number().int().min(1).max(30).optional(),
  spectators: z.enum(['off', 'on']).optional(),
  forfeit: z.enum(['continue', 'skip', 'surrender']).optional(),
});
export type NetManifest = z.infer<typeof netManifestSchema>;

export const TeamPolicySchema = z.enum(['none', 'alternate']);
export type TeamPolicy = z.infer<typeof TeamPolicySchema>;

export const ChecksumScopeSchema = z.enum(['shared', 'seat']);
export const RecoveryScopeSchema = z.enum(['shared', 'seat', 'events']);
export const EventTargetSchema = z.enum(['all', 'seat', 'team']);
export const SeatEventSchema = z.enum(['net.seat.online', 'net.seat.offline', 'net.seat.forfeit']);

/**
 * One row of the room's seat table, and the seat record `net.start`/`net.seats` carry. `userId: ''` marks an
 * unassigned row in the room's own table; a seat handed to a client always names its user.
 */
export const netSeatSchema = z.strictObject({
  seat: seatIndex,
  userId: z.string().max(64),
  name: z.string().max(40),
  team: teamIndex,
  connected: z.boolean(),
  ready: z.boolean(),
  forfeited: z.boolean(),
  spectator: z.boolean(),
});
export type NetSeat = z.infer<typeof netSeatSchema>;

export type NetTime = { serverMs: number; tick: number; offsetMs: number; rttMs: number; jitterMs: number };

/** Client → room → peers: the sender's frames for the last `redundancy` ticks. */
export const netInputsPayloadSchema = z.strictObject({
  epoch: epochId,
  seat: seatIndex,
  firstTick: tick,
  frames: z.array(InputFrameSchema).min(1).max(LIMITS_V2.inputFramesPerMessage),
});
export type NetInputsPayload = z.infer<typeof netInputsPayloadSchema>;

/** A seat's owned-state slice, or a filtered copy addressed to one recipient. */
export const netStatePayloadSchema = z.strictObject({
  epoch: epochId,
  seat: seatIndex,
  seq: tick,
  tick,
  to: seatIndex.optional(),
  data: netData(LIMITS_V2.stateBytes),
});
export type NetStatePayload = z.infer<typeof netStatePayloadSchema>;

/** A routed event: the room reads the header and never the payload. */
export const netEventPayloadSchema = z.strictObject({
  epoch: epochId,
  id: eventId,
  seq: nonNegativeInt,
  from: seatIndex,
  target: EventTargetSchema,
  to: seatIndex.optional(),
  team: teamIndex.optional(),
  round: nonNegativeInt.optional(),
  data: netData(LIMITS_V2.eventBytes),
});
export type NetEventPayload = z.infer<typeof netEventPayloadSchema>;

export const netChecksumPayloadSchema = z.strictObject({
  epoch: epochId,
  scope: ChecksumScopeSchema,
  tick,
  sum: uint32,
});
export type NetChecksumPayload = z.infer<typeof netChecksumPayloadSchema>;

export const netRecoveryRequestPayloadSchema = z.strictObject({
  epoch: epochId,
  scope: RecoveryScopeSchema,
  tick,
  seat: seatIndex.optional(),
});
export type NetRecoveryRequestPayload = z.infer<typeof netRecoveryRequestPayloadSchema>;

/** An answer from the arbiter. `to` addresses a filtered `seat`-scope answer to the seat that asked. */
export const netRecoveryPayloadSchema = z.strictObject({
  epoch: epochId,
  scope: RecoveryScopeSchema,
  tick,
  seat: seatIndex.optional(),
  to: seatIndex.optional(),
  snapshot: netData(LIMITS_V2.recoveryBytes).optional(),
  events: netData(LIMITS_V2.recoveryBytes).optional(),
});
export type NetRecoveryPayload = z.infer<typeof netRecoveryPayloadSchema>;

export const netSignalPayloadSchema = z.strictObject({
  epoch: epochId,
  to: seatIndex,
  data: netData(LIMITS_V2.signalBytes),
});
export type NetSignalPayload = z.infer<typeof netSignalPayloadSchema>;

/** The room's `net.start`: the epoch, the authority mode, tick 0's server time and every seat. */
export const netStartSchema = z.strictObject({
  epoch: epochId,
  mode: authorityModeSchema,
  startAt: nonNegativeInt,
  seed: uint32,
  primarySeat: seatIndex,
  seats: z.array(netSeatSchema).min(1).max(LIMITS_V2.maxPlayersCeiling),
  /** Present only in the per-seat copy of `net.start`. */
  privateSeed: uint32.optional(),
});
export type NetStart = z.infer<typeof netStartSchema>;

/** `welcome.you`; `seat` is `null` and `playerIndex` `-1` for a spectator. */
export const NetWelcomeYouSchema = z.strictObject({
  userId: id,
  seat: seatIndex.nullable(),
  playerIndex: int,
  sessionId: id,
  spectator: z.boolean(),
  team: teamIndex,
});
export type NetWelcomeYou = z.infer<typeof NetWelcomeYouSchema>;

/**
 * A v2 `welcome.state`. `RoomStateSchema` is `.strict()` and is what the web validates `welcome.state` with, so a
 * v2 room needs its own shape or the client drops the welcome silently (#497 §3.10 trap 2).
 */
export const RoomStateV2Schema = RoomStateSchema.extend({
  seats: z.array(netSeatSchema).max(LIMITS_V2.maxPlayersCeiling),
  spectators: z.array(id),
  epoch: z.string(),
  startAt: nonNegativeInt,
  pausedAt: nonNegativeInt,
  primarySeat: seatIndex,
  seed: uint32,
  rulesetHash: z.string().max(64),
  matchPausedBy: z.string().optional(),
  matchPauseName: z.string().optional(),
  matchResumeAt: nonNegativeInt.optional(),
}).strict();
export type RoomStateV2 = z.infer<typeof RoomStateV2Schema>;

const netStartMessageSchema = netStartSchema.extend({ t: z.literal('net.start') });

/** Client → room, protocol 2. */
export const NetClientMessageSchema = z.discriminatedUnion('t', [
  netInputsPayloadSchema.extend({ t: z.literal('net.inputs') }),
  netStatePayloadSchema.extend({ t: z.literal('net.state') }),
  netEventPayloadSchema.extend({ t: z.literal('net.event') }),
  netChecksumPayloadSchema.extend({ t: z.literal('net.checksum') }),
  netRecoveryRequestPayloadSchema.extend({ t: z.literal('net.recovery.request') }),
  netRecoveryPayloadSchema.extend({ t: z.literal('net.recovery') }),
  netSignalPayloadSchema.extend({ t: z.literal('net.signal') }),
  z.strictObject({ t: z.literal('net.ready'), ready: z.boolean() }),
  z.strictObject({ t: z.literal('net.start.request'), force: z.boolean().optional() }),
  z.strictObject({ t: z.literal('net.end.request'), epoch: epochId }),
  z.strictObject({ t: z.literal('net.seat.request'), seat: seatIndex }),
  z.strictObject({ t: z.literal('match.pause.request') }),
  z.strictObject({ t: z.literal('match.resume.request') }),
  z.strictObject({ t: z.literal('net.pause.ack'), epoch: epochId, tick }),
  z.strictObject({ t: z.literal('net.pause.late'), epoch: epochId, tick }),
  z.strictObject({ t: z.literal('net.pause.position'), epoch: epochId, tick }),
]);
export type NetClientMessage = z.infer<typeof NetClientMessageSchema>;

/** Room → client, protocol 2. */
export const NetServerMessageSchema = z.discriminatedUnion('t', [
  z.strictObject({
    t: z.literal('welcome'),
    you: NetWelcomeYouSchema,
    epoch: epochId.optional(),
    state: RoomStateV2Schema,
  }),
  netStartMessageSchema,
  z.strictObject({ t: z.literal('net.start.cancel'), reason: z.enum(['seat-offline', 'not-ready']) }),
  z.strictObject({ t: z.literal('net.tick'), epoch: epochId, serverTime: nonNegativeInt, tick }),
  z.strictObject({ t: z.literal('net.primary'), epoch: epochId, seat: seatIndex }),
  z.strictObject({
    t: z.literal('net.seats'),
    epoch: z.string(),
    seats: z.array(netSeatSchema).max(LIMITS_V2.maxPlayersCeiling),
    spectators: z.array(id),
  }),
  z.strictObject({ t: z.literal('net.seat'), event: SeatEventSchema, epoch: z.string(), seat: seatIndex }),
  z.strictObject({ t: z.literal('net.pause'), epoch: epochId, tick, startAt: nonNegativeInt }),
  z.strictObject({ t: z.literal('net.pause.prepare'), epoch: epochId, tick }),
  z.strictObject({ t: z.literal('net.pause.probe'), epoch: epochId }),
  z.strictObject({
    t: z.literal('net.resume'),
    epoch: epochId,
    tick,
    startAt: nonNegativeInt,
    at: nonNegativeInt.optional(),
  }),
  z.strictObject({ t: z.literal('match.pause'), by: id, name: z.string().min(1).max(40) }),
  z.strictObject({ t: z.literal('match.resume'), at: nonNegativeInt }),
  z.strictObject({ t: z.literal('match.resumed') }),
  z.strictObject({ t: z.literal('net.epoch.end'), epoch: epochId, tick }),
  netInputsPayloadSchema.extend({ t: z.literal('net.inputs') }),
  netStatePayloadSchema.extend({ t: z.literal('net.state') }),
  netEventPayloadSchema.extend({ t: z.literal('net.event') }),
  netChecksumPayloadSchema.extend({ t: z.literal('net.checksum') }),
  netRecoveryRequestPayloadSchema.extend({ t: z.literal('net.recovery.request') }),
  netSignalPayloadSchema.extend({ t: z.literal('net.signal') }),
  netRecoveryPayloadSchema.extend({ t: z.literal('net.recovery') }),
  z.strictObject({
    t: z.literal('ended'),
    reason: z.enum(['host-left', 'owner-closed', 'idle', 'revoked', 'abandoned']),
  }),
]);
export type NetServerMessage = z.infer<typeof NetServerMessageSchema>;

/** The relayed batch the SDK packs: one array of net messages, capped. */
export const netMessageSchema = z.discriminatedUnion('t', [
  netInputsPayloadSchema.extend({ t: z.literal('net.inputs') }),
  netStatePayloadSchema.extend({ t: z.literal('net.state') }),
  netChecksumPayloadSchema.extend({ t: z.literal('net.checksum') }),
  netRecoveryRequestPayloadSchema.extend({ t: z.literal('net.recovery.request') }),
  netRecoveryPayloadSchema.extend({ t: z.literal('net.recovery') }),
]);
export type NetMessage = z.infer<typeof netMessageSchema>;

export const netMessagesSchema = z.array(netMessageSchema).max(LIMITS_V2.maxBatchMessages);

export const netSchemas = {
  'net.client-messages.v2': z.array(NetClientMessageSchema),
  'net.server-messages.v2': z.array(NetServerMessageSchema),
  'net.room-state.v2': RoomStateV2Schema,
  'net.messages.v2': netMessagesSchema,
  'net.seat.v2': netSeatSchema,
  'net.start.v2': netStartSchema,
} satisfies Record<string, z.ZodType>;

/**
 * One room serves one protocol, but the process serves both: the handler, the bridge and the web client each
 * validate with one schema over the union of the shipped v1 shapes and the v2 family.
 */
export const RoomClientMessageSchema = z.union([ClientMessageSchema, NetClientMessageSchema]);
export type RoomClientMessage = z.infer<typeof RoomClientMessageSchema>;
export const RoomServerMessageSchema = z.union([ServerMessageSchema, NetServerMessageSchema]);
export type RoomServerMessage = z.infer<typeof RoomServerMessageSchema>;
