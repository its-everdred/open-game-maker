import { describe, expect, it } from 'vitest';
import { toJSONSchema, type z } from 'zod';

import {
  envelope,
  gameToHostSchema,
  hostToGameSchema,
  NET_DATA_MAX_CHARS,
  inputFrameSchema,
  patchSchema,
  phaseSchema,
  SDK_PROTOCOL,
} from '../src/bridge.js';
import { InputFrameSchema, PhaseSchema } from '../src/room.js';
import { loadJson } from './helpers.js';
import { emittedValidator } from './json-schema.js';

const bridgeJson = emittedValidator('bridge.v1');

function issuePaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.error!.issues.map((issue) => issue.path.join('.'));
}

describe('bridge contract', () => {
  it('carries normalized editor projection requests and world-space results', () => {
    const request = { v: 1, id: 'project-1', t: 'editor.project', payload: { x: 0.25, y: 0.75 } };
    const response = {
      v: 1,
      id: 'project-2',
      replyTo: 'project-1',
      t: 'editor.projected',
      payload: { position: [2, 0, -1] },
    };
    expect(hostToGameSchema.safeParse(request).success).toBe(true);
    expect(gameToHostSchema.safeParse(response).success).toBe(true);
    expect(bridgeJson(request)).toBe(true);
    expect(bridgeJson(response)).toBe(true);
    expect(hostToGameSchema.safeParse({ ...request, payload: { x: -1, y: 0 } }).success).toBe(false);
    expect(gameToHostSchema.safeParse({ ...response, payload: { position: [1, 2] } }).success).toBe(false);
  });
  it('pins the wire protocol to 1', () => {
    expect(SDK_PROTOCOL).toBe(1);
  });

  it.each([
    ['bridge.v1.json', hostToGameSchema],
    ['bridge-design-apply.v1.json', hostToGameSchema],
    ['bridge-net-snapshot.v1.json', hostToGameSchema],
    ['bridge-ready.v1.json', gameToHostSchema],
    ['bridge-net-snapshot.v1.json', gameToHostSchema],
  ] as const)('accepts %s in both Zod and the emitted JSON Schema', (file, schema) => {
    const doc = loadJson(`fixtures/${file}`);
    expect(schema.safeParse(doc).success).toBe(true);
    expect(bridgeJson(doc)).toBe(true);
  });

  it('carries the hello tier the host picked', () => {
    const hello = hostToGameSchema.parse(loadJson('fixtures/bridge.v1.json'));
    expect(hello.t === 'hello' && hello.payload.tier).toBe('mobile');
  });

  it('accepts load progress and completion messages from a game', () => {
    const progress = {
      v: 1,
      id: 'load-1',
      t: 'load.progress',
      payload: { phase: 'ready', loaded: 64, total: 128, cachedBytes: 32 },
    };
    const done = {
      v: 1,
      id: 'load-2',
      t: 'load.done',
      payload: {
        ms: 250,
        fetchedBytes: 96,
        cachedBytes: 32,
        fetchedFiles: 2,
        cachedFiles: 1,
        persisted: null,
        usage: 1_024,
        quota: 4_096,
      },
    };

    expect(gameToHostSchema.parse(progress)).toEqual(progress);
    expect(gameToHostSchema.parse(done)).toEqual(done);
    expect(bridgeJson(progress)).toBe(true);
    expect(bridgeJson(done)).toBe(true);
    expect(hostToGameSchema.safeParse(progress).success).toBe(false);
    expect(hostToGameSchema.safeParse(done).success).toBe(false);
  });

  it('rejects invalid load progress counters and persistence states', () => {
    const progress = {
      v: 1,
      id: 'load-1',
      t: 'load.progress',
      payload: { phase: 'ready', loaded: -1, total: 128, cachedBytes: 0 },
    };
    const done = {
      v: 1,
      id: 'load-2',
      t: 'load.done',
      payload: {
        ms: 1,
        fetchedBytes: 0,
        cachedBytes: 0,
        fetchedFiles: 0,
        cachedFiles: 0,
        persisted: 'yes',
      },
    };

    expect(issuePaths(gameToHostSchema, progress)).toEqual(['payload.loaded']);
    expect(issuePaths(gameToHostSchema, done)).toEqual(['payload.persisted']);
  });

  // T07 §4.3 replaced T04's mp.* spelling with net.*; mp.* must stay unknown in both directions.
  it.each([hostToGameSchema, gameToHostSchema])('rejects the retired mp.snapshot type at t', (schema) => {
    const doc = loadJson('fixtures/bridge-negative/unknown-t.v1.json');
    expect(issuePaths(schema, doc)).toEqual(['t']);
    expect(bridgeJson(doc)).toBe(false);
  });

  it('rejects an envelope whose v is not 1', () => {
    const doc = loadJson('fixtures/bridge-negative/wrong-v.v1.json');
    expect(issuePaths(hostToGameSchema, doc)).toEqual(['v']);
    expect(bridgeJson(doc)).toBe(false);
  });

  it('rejects a net.snapshot over the 64 KiB base64 cap at payload.data', () => {
    const doc = loadJson<{ payload: { data: string } }>('fixtures/bridge-negative/over-cap.v1.json');
    expect(doc.payload.data.length).toBeGreaterThan(NET_DATA_MAX_CHARS);
    expect(issuePaths(hostToGameSchema, doc)).toEqual(['payload.data']);
    expect(issuePaths(gameToHostSchema, doc)).toEqual(['payload.data']);
    expect(bridgeJson(doc)).toBe(false);
  });

  it('keeps direction: a game cannot send design.apply and a host cannot send ready', () => {
    expect(gameToHostSchema.safeParse(loadJson('fixtures/bridge-design-apply.v1.json')).success).toBe(false);
    expect(hostToGameSchema.safeParse(loadJson('fixtures/bridge-ready.v1.json')).success).toBe(false);
  });

  it('rejects patch ops outside the T08 subset', () => {
    const doc = loadJson<{ payload: { patches: { op: string }[] } }>('fixtures/bridge-design-apply.v1.json');
    doc.payload.patches[0]!.op = 'move';
    expect(issuePaths(hostToGameSchema, doc)).toEqual(['payload.patches.0.op']);
    expect(patchSchema.safeParse({ op: 'add', path: ['a', 1], value: 2 }).success).toBe(true);
  });

  it('is strict on the envelope and loose on payloads', () => {
    const hello = loadJson<Record<string, unknown> & { payload: Record<string, unknown> }>('fixtures/bridge.v1.json');
    expect(hostToGameSchema.safeParse({ ...hello, extra: 1 }).success).toBe(false);
    const future = { ...hello, payload: { ...hello.payload, futureField: true } };
    expect(hostToGameSchema.parse(future).payload).toHaveProperty('futureField', true);
    expect(bridgeJson(future)).toBe(true);
  });

  it('caps message ids at 64 characters', () => {
    const hello = loadJson<Record<string, unknown>>('fixtures/bridge.v1.json');
    expect(issuePaths(hostToGameSchema, { ...hello, id: 'x'.repeat(65) })).toEqual(['id']);
    expect(issuePaths(hostToGameSchema, { ...hello, id: '' })).toEqual(['id']);
    expect(issuePaths(hostToGameSchema, { ...hello, replyTo: 'x'.repeat(65) })).toEqual(['replyTo']);
  });

  it('forbids text in a relayed input frame', () => {
    const frame = { seq: 1, tick: 2, axes: [0.5], buttons: 3 };
    const message = { v: 1, id: 'n1', t: 'net.input', payload: { f: frame } };
    expect(gameToHostSchema.safeParse(message).success).toBe(true);
    // strict frame: the unrecognised `text` key is reported on the frame itself
    expect(issuePaths(gameToHostSchema, { ...message, payload: { f: { ...frame, text: 'hi' } } })).toEqual([
      'payload.f',
    ]);
    // host → game frames carry the server-stamped playerIndex
    expect(issuePaths(hostToGameSchema, message)).toEqual(['payload.f.playerIndex']);
  });

  // Watchers switch Follow/Free through this host-only command; a game must never send it back.
  it('round-trips editor.camera host → game in Zod and the emitted JSON Schema', () => {
    for (const payload of [{ mode: 'follow' }, { mode: 'follow', target: 'player_0' }, { mode: 'free' }]) {
      const message = { v: 1, id: 'c1', t: 'editor.camera', payload };
      expect(hostToGameSchema.parse(JSON.parse(JSON.stringify(message)))).toEqual(message);
      expect(bridgeJson(message)).toBe(true);
      expect(gameToHostSchema.safeParse(message).success).toBe(false);
    }
    const bad = { v: 1, id: 'c2', t: 'editor.camera', payload: { mode: 'orbit' } };
    expect(issuePaths(hostToGameSchema, bad)).toEqual(['payload.mode']);
    expect(bridgeJson(bad)).toBe(false);
    expect(issuePaths(hostToGameSchema, { ...bad, payload: { mode: 'follow', target: '' } })).toEqual([
      'payload.target',
    ]);
  });

  it('builds envelopes with a literal type', () => {
    const ping = envelope('custom.ping', patchSchema.pick({ op: true }));
    expect(ping.safeParse({ v: 1, id: 'p', t: 'custom.ping', payload: { op: 'add' } }).success).toBe(true);
    expect(ping.safeParse({ v: 1, id: 'p', t: 'custom.pong', payload: { op: 'add' } }).success).toBe(false);
  });
});

describe('copies of OGM-050 shapes', () => {
  /* the bridge copies InputFrame and Phase instead of importing room code; a drifted copy lets a frame the room rejects through the iframe */
  it.each([
    ['InputFrame', inputFrameSchema, InputFrameSchema],
    ['Phase', phaseSchema, PhaseSchema],
  ] as const)('%s matches room.ts', (_name, copy, owner) => {
    expect(toJSONSchema(copy)).toEqual(toJSONSchema(owner));
  });
});
