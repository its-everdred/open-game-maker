import { describe, expect, it } from 'vitest';

import { actionFrameSchema, rigInputMappingSchema, viewIdSchema } from '../src/input.js';
import { loadJson } from './helpers.js';
import { emittedValidator } from './json-schema.js';

const inputJson = emittedValidator('input.v1');
const frame = () => loadJson<Record<string, unknown>>('fixtures/input.v1.json');

describe('input contract', () => {
  it('accepts the golden frame with a stick, a button and an axis', () => {
    expect(actionFrameSchema.parse(frame()).actions).toEqual({ move: { x: 0.3, y: -1 }, jump: true, throttle: 0.5 });
    expect(inputJson(frame())).toBe(true);
  });

  it('rejects a ninth player (rooms cap at 8)', () => {
    const doc = { ...frame(), playerIndex: 8 };
    expect(actionFrameSchema.safeParse(doc).error?.issues[0]?.path).toEqual(['playerIndex']);
    expect(inputJson(doc)).toBe(false);
  });

  it('rejects more than 32 actions in one frame', () => {
    const actions = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`a${i}`, true]));
    expect(actionFrameSchema.safeParse({ ...frame(), actions }).success).toBe(false);
    delete actions.a32;
    expect(actionFrameSchema.safeParse({ ...frame(), actions }).success).toBe(true);
  });

  it('validates optional pointer button mappings', () => {
    const mapping = { keyboard: {}, touch: 'stick', gamepad: {}, pointerLock: false };
    expect(rigInputMappingSchema.safeParse({ ...mapping, pointer: { buttons: { '0': 'attack' } } }).success).toBe(true);
    expect(rigInputMappingSchema.safeParse({ ...mapping, pointer: { buttons: { '0': 1 } } }).success).toBe(false);
    expect(rigInputMappingSchema.safeParse(mapping).success).toBe(true);
  });

  it('rejects unknown sources and views', () => {
    expect(actionFrameSchema.safeParse({ ...frame(), source: 'voice' }).success).toBe(false);
    expect(viewIdSchema.options).toEqual(['iso', 'topdown', 'side', 'follow', 'fps', 'orbit', 'fixed']);
  });
});
