import { z } from 'zod';

import { loadPhaseSchema, tierSchema } from './assets.js';
import { gameManifestSchema, poseSchema, targetRefSchema } from './game.js';
import { actionFrameSchema, insetsSchema, MAX_PLAYERS } from './input.js';
import {
  authorityModeSchema,
  netChecksumPayloadSchema,
  netInputsPayloadSchema,
  netRecoveryPayloadSchema,
  netRecoveryRequestPayloadSchema,
  netSeatSchema,
  netStartSchema,
  netStatePayloadSchema,
} from './net.js';

/** Wire-protocol major; separate from the npm version. */
export const SDK_PROTOCOL = 1;
/** Host-side caps the OGM-021 bridge enforces; saves are routed separately. */
export const BRIDGE_MAX_BYTES = 262_144;
export const BRIDGE_MAX_MSGS_PER_S = 120;
/** A 64 KiB snapshot or event, base64-encoded (the wire is a JSON string). */
export const NET_DATA_MAX_CHARS = Math.ceil(65_536 / 3) * 4;

export type Envelope<T extends string, P> = { v: 1; id: string; t: T; payload: P; replyTo?: string };

const messageId = z.string().min(1).max(64);

/**
 * One bridge message. The envelope is strict; payload objects are loose so clients ignore
 * unknown fields. `replyTo` names the `id` of an earlier message (`test.*` → `test.result`);
 * that ordering is checked by the bridge runtime, not here.
 */
export function envelope<T extends string, P extends z.ZodType>(t: T, payload: P) {
  return z.strictObject({
    v: z.literal(1),
    id: messageId,
    t: z.literal(t),
    payload,
    replyTo: messageId.optional(),
  });
}

/** T08 §4 patch (Immer / RFC 6902 subset). OGM-040 re-exports this rather than redefining it. */
export const patchSchema = z.looseObject({
  op: z.enum(['replace', 'add', 'remove']),
  path: z.array(z.union([z.string(), z.number().int().min(0)])),
  value: z.unknown().optional(),
});
export type Patch = z.infer<typeof patchSchema>;

/*
 * Copied from T07 §4.1, owned by OGM-050 (`room.ts`). Copy, never import, so engine packages
 * stay free of room code; `test/bridge.test.ts` asserts the emitted shapes stay equal.
 * Strict, so a `text` key fails.
 */
export const inputFrameSchema = z.strictObject({
  seq: z.number().int().min(0),
  tick: z.number().int().min(0),
  axes: z.array(z.number()).max(8),
  buttons: z.number().int().min(0),
});
export type InputFrame = z.infer<typeof inputFrameSchema>;

export const phaseSchema = z.enum(['editing', 'migrating', 'playing', 'pausedForHost', 'ended']);
export type Phase = z.infer<typeof phaseSchema>;

const empty = z.looseObject({});
const netData = z.string().max(NET_DATA_MAX_CHARS);
const netSnapshot = z.looseObject({ seq: z.number().int().min(0), tick: z.number().int().min(0), data: netData });
const netEvent = z.looseObject({ seq: z.number().int().min(0), data: netData });
const save = z.looseObject({ saveSchemaVersion: z.number().int().min(0), data: z.unknown() });
const playMode = z.enum(['play', 'edit']);
const testMs = z.looseObject({ ms: z.number().min(0) });
const cameraCommand = z.looseObject({ mode: z.enum(['follow', 'free']), target: z.string().min(1).optional() });
const placementResult = z.discriminatedUnion('ok', [
  z.looseObject({ ok: z.literal(true) }),
  z.looseObject({ ok: z.literal(false), reason: z.string().max(200) }),
]);

export const hostToGameSchema = z
  .discriminatedUnion('t', [
    envelope(
      'hello',
      z.looseObject({
        protocol: z.number().int().min(1),
        capabilities: z.array(z.string()),
        mode: z.enum(['play', 'edit', 'test']),
        build: z.enum(['draft', 'test', 'published']),
        playerIndex: z
          .number()
          .int()
          .min(0)
          .max(MAX_PLAYERS - 1),
        tier: tierSchema.optional(),
      }),
    ),
    envelope('lifecycle.pause', empty),
    envelope('lifecycle.resume', empty),
    envelope('lifecycle.dispose', empty),
    envelope('mode.set', z.looseObject({ mode: playMode })),
    /** Host-validated effective design; the host checks the sender's role before forwarding. */
    envelope(
      'design.apply',
      z.looseObject({ rev: z.number().int().min(0), doc: z.unknown(), patches: z.array(patchSchema) }),
    ),
    envelope('editor.select', z.looseObject({ ids: z.array(z.string()) })),
    /** Normalized 0..1 of the frame. */
    envelope('editor.pick', z.looseObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })),
    /** Ask the game to project a normalized frame point onto its editable surface. */
    envelope('editor.project', z.looseObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })),
    envelope('editor.validatePlacement', z.looseObject({ prefab: z.string(), pose: poseSchema })),
    /**
     * Presence, not design state: any role may send it. `follow` tracks `target` (an entity id; the game's
     * default player when absent); `free` is the editor pan/zoom. Edit mode only; play mode keeps the play rig.
     */
    envelope('editor.camera', cameraCommand),
    /** Host pad + touch overlay. */
    envelope('input.frame', actionFrameSchema),
    envelope(
      'viewport',
      z.looseObject({
        w: z.number().min(0),
        h: z.number().min(0),
        dpr: z.number().positive(),
        orientation: z.enum(['landscape', 'portrait']),
        safe: insetsSchema,
      }),
    ),
    envelope(
      'settings',
      z.looseObject({
        mute: z.boolean(),
        volume: z.number().min(0).max(1),
        textScale: z.number().positive(),
        reduceMotion: z.boolean(),
      }),
    ),
    envelope('save.restore', save),
    envelope(
      'net.players',
      z.looseObject({
        local: z.number().int().min(0),
        players: z
          .array(
            z.looseObject({
              playerIndex: z
                .number()
                .int()
                .min(0)
                .max(MAX_PLAYERS - 1),
              name: z.string().max(80),
              connected: z.boolean(),
            }),
          )
          .max(MAX_PLAYERS),
      }),
    ),
    envelope('net.role', z.looseObject({ role: z.enum(['host', 'peer']) })),
    /** Host only: peers' inputs. */
    envelope(
      'net.input',
      z.looseObject({
        f: inputFrameSchema.extend({
          playerIndex: z
            .number()
            .int()
            .min(0)
            .max(MAX_PLAYERS - 1),
        }),
      }),
    ),
    /** Peers only. */
    envelope('net.snapshot', netSnapshot),
    envelope('net.event', netEvent),
    /*
     * Netcode v2 (N2 adds the names so both sides type-check; `bridge-forwarding.ts` keeps its v1 cases and drops
     * these until N3 wires room routing).
     */
    envelope('net.mode', z.looseObject({ mode: authorityModeSchema })),
    envelope('net.seats', z.looseObject({ seats: z.array(netSeatSchema).max(MAX_PLAYERS) })),
    envelope(
      'net.primary',
      z.looseObject({
        seat: z
          .number()
          .int()
          .min(0)
          .max(MAX_PLAYERS - 1),
      }),
    ),
    envelope('net.start', netStartSchema),
    envelope('net.start.cancel', z.looseObject({ epoch: z.string().min(1).max(64) })),
    envelope('net.tick', z.looseObject({ tick: z.number().int().min(0), serverMs: z.number() })),
    envelope('net.pause', empty),
    envelope('net.resume', empty),
    envelope('net.state', netStatePayloadSchema),
    envelope('net.inputs', netInputsPayloadSchema),
    envelope('net.checksum', netChecksumPayloadSchema),
    envelope('net.recovery', netRecoveryPayloadSchema),
    envelope('net.seat', netSeatSchema),
    envelope('net.transport', z.looseObject({ transport: z.enum(['ws-relay', 'webrtc-mesh', 'webrtc-star']) })),
    envelope('phase', z.looseObject({ phase: phaseSchema })),
    /** `test.*` requests carry an `id` that the matching `test.result` names in `replyTo`. */
    envelope('test.advanceTime', testMs),
    envelope('test.renderAt', testMs),
    envelope('test.renderGameToText', empty),
    envelope('test.renderInfo', empty),
    envelope('test.hitTest', z.looseObject({ nx: z.number(), ny: z.number() })),
    envelope('test.setSeed', z.looseObject({ seed: z.number().int() })),
    envelope('test.seed', empty),
    envelope('test.inject', actionFrameSchema),
    envelope('test.probes', empty),
    envelope('test.events', z.looseObject({ since: z.number().min(0) })),
  ])
  .meta({ id: 'HostToGame' });
export type HostToGame = z.infer<typeof hostToGameSchema>;

export const gameToHostSchema = z
  .discriminatedUnion('t', [
    envelope(
      'ready',
      z.looseObject({
        protocol: z.number().int().min(1),
        manifest: gameManifestSchema,
        marks: z.array(z.tuple([z.string(), z.number()])),
      }),
    ),
    envelope(
      'load.progress',
      z.looseObject({
        phase: loadPhaseSchema,
        loaded: z.number().min(0),
        total: z.number().min(0),
        cachedBytes: z.number().min(0),
      }),
    ),
    envelope(
      'load.done',
      z.looseObject({
        ms: z.number().min(0),
        fetchedBytes: z.number().min(0),
        cachedBytes: z.number().min(0),
        fetchedFiles: z.number().int().min(0),
        cachedFiles: z.number().int().min(0),
        persisted: z.boolean().nullable(),
        usage: z.number().min(0).optional(),
        quota: z.number().min(0).optional(),
      }),
    ),
    envelope(
      'design.applied',
      z.looseObject({ rev: z.number().int().min(0), result: z.enum(['live', 'restart-scene']) }),
    ),
    envelope('editor.picked', z.looseObject({ targets: z.array(targetRefSchema) })),
    envelope('editor.projected', z.looseObject({ position: z.tuple([z.number(), z.number(), z.number()]).nullable() })),
    envelope('editor.placement', placementResult),
    envelope(
      'editor.screen',
      z.union([
        z.looseObject({ id: z.string(), x: z.number(), y: z.number() }),
        z.looseObject({ id: z.string(), offscreen: z.literal(true) }),
      ]),
    ),
    /** Host hotkeys while the iframe has focus. */
    envelope('input.rawKey', z.looseObject({ code: z.string().max(32), down: z.boolean() })),
    /** The host fills identity and slot. */
    envelope('save.write', save),
    envelope(
      'event',
      z.looseObject({ kind: z.enum(['achievement', 'analytics', 'checkpoint']), payload: z.unknown() }),
    ),
    /** iOS audio fallback. */
    envelope(
      'audio.relay',
      z.union([
        z.looseObject({ cue: z.string(), vol: z.number().min(0), rate: z.number().positive() }),
        z.looseObject({ loop: z.string(), gain: z.number().min(0) }),
      ]),
    ),
    /** Peer: its own input. */
    envelope('net.input', z.looseObject({ f: inputFrameSchema })),
    /** Host: the authoritative snapshot. */
    envelope('net.snapshot', netSnapshot),
    envelope('net.event', netEvent),
    /* Netcode v2 (see above). */
    envelope('net.inputs', netInputsPayloadSchema),
    envelope('net.state', netStatePayloadSchema),
    envelope('net.checksum', netChecksumPayloadSchema),
    envelope('net.recovery.request', netRecoveryRequestPayloadSchema),
    envelope('net.ready', z.looseObject({ ready: z.boolean(), seat: z.number().int().min(0).optional() })),
    envelope('net.start.request', empty),
    envelope('net.signal', z.looseObject({ data: z.string().max(Math.ceil(4096 / 3) * 4) })),
    envelope(
      'test.result',
      z.looseObject({ ok: z.boolean(), value: z.unknown().optional(), error: z.string().optional() }),
    ),
    envelope('error', z.looseObject({ code: z.string().min(1).max(64), message: z.string() })),
  ])
  .meta({ id: 'GameToHost' });
export type GameToHost = z.infer<typeof gameToHostSchema>;

/** Any bridge message, either direction; the JSON Schema keeps each direction under `$defs`. */
export const bridgeMessageSchema = z.union([hostToGameSchema, gameToHostSchema]);

export const bridgeSchemas = {
  'bridge.v1': bridgeMessageSchema,
} satisfies Record<'bridge.v1', z.ZodType>;
