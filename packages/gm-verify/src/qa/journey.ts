import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { viewportSchema } from '../report.js';

/**
 * A QA journey: what a player does to a hosted build, step by step, with real input (`games/<name>/qa/journeys/*.json`).
 * Points are fractions of the viewport so one journey fits phone and desktop. `{name}` in a string is a variable a
 * `read` step set earlier (room journeys also get `{clients}` and `{seat}`).
 */
const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
/** `[x, y, width, height]` in viewport fractions. */
const region = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().gt(0).max(1),
  z.number().gt(0).max(1),
]);
const ms = z.number().int().min(0).max(120_000);
const target = { text: z.string().min(1).optional(), selector: z.string().min(1).optional() };

export const expectSchema = z
  .strictObject({
    do: z.literal('expect'),
    /** Visible text the page must show (substring). */
    text: z.string().min(1).optional(),
    /** `nonblank`: the region is not one flat colour; `changed`: it differs from the moment the wait began. */
    pixels: z.enum(['nonblank', 'changed']).optional(),
    region: region.optional(),
    timeoutMs: ms.default(10_000),
    /** A question for `gm qa look`, answered by looking at this step's still. */
    look: z.string().min(1).max(300).optional(),
  })
  .refine((step) => step.text !== undefined || step.pixels !== undefined || step.look !== undefined, {
    message: 'expect needs text, pixels or look',
  });

export const stepSchema = z.union([
  z.strictObject({ do: z.literal('goto'), url: z.string().min(1) }),
  z
    .strictObject({ do: z.literal('click'), ...target })
    .refine((s) => s.text !== undefined || s.selector !== undefined, { message: 'click needs text or selector' }),
  z
    .strictObject({ do: z.literal('tap'), ...target, at: point.optional() })
    .refine((s) => s.text !== undefined || s.selector !== undefined || s.at !== undefined, {
      message: 'tap needs text, selector or at',
    }),
  z.strictObject({
    do: z.literal('press'),
    key: z.string().min(1),
    holdMs: ms.default(80),
    times: z.number().int().min(1).max(50).default(1),
  }),
  z.strictObject({
    do: z.literal('swipe'),
    from: point,
    to: point,
    ms: z.number().int().min(16).max(5_000).default(200),
  }),
  z.strictObject({ do: z.literal('wait'), ms }),
  z.strictObject({ do: z.literal('shot'), name: z.string().regex(/^[a-z0-9-]{1,40}$/) }),
  /** Saves the page URL (`url: true`) or an element's text as `{as}` for later steps and other clients. */
  z
    .strictObject({
      do: z.literal('read'),
      as: z.string().regex(/^[a-z][a-z0-9]*$/),
      selector: z.string().min(1).optional(),
      url: z.literal(true).optional(),
    })
    .refine((s) => (s.selector === undefined) !== (s.url === undefined), { message: 'read needs selector or url' }),
  expectSchema,
]);
export type Step = z.infer<typeof stepSchema>;
export type ExpectStep = z.infer<typeof expectSchema>;

export const soloJourneySchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind: z.literal('solo').default('solo'),
  viewport: viewportSchema.optional(),
  steps: z.array(stepSchema).min(1).max(200),
});

/**
 * A room journey: client 0 runs `host` and creates the room, every other client runs `join`. Then each client must
 * reach `seated` and `countdown` (the countdown within `countdownSpreadMs` of each other), client 0 runs `move.steps`
 * and every other client must see `move.expect`, and the last client drops for `dropMs` and comes back to `rejoin`.
 */
export const roomJourneySchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind: z.literal('room'),
  host: z.array(stepSchema).min(1).max(100),
  join: z.array(stepSchema).min(1).max(100),
  start: z.array(stepSchema).max(100).default([]),
  seated: expectSchema,
  countdown: expectSchema,
  countdownSpreadMs: z.number().int().min(50).max(5_000).default(500),
  move: z.strictObject({ steps: z.array(stepSchema).min(1).max(100), expect: expectSchema }),
  rejoin: expectSchema,
  dropMs: z.number().int().min(0).max(60_000).default(3_000),
});

export const journeySchema = z.union([roomJourneySchema, soloJourneySchema]);
export type SoloJourney = z.infer<typeof soloJourneySchema>;
export type RoomJourney = z.infer<typeof roomJourneySchema>;
export type Journey = z.infer<typeof journeySchema>;

export function readJourney(path: string): Journey {
  return journeySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Replaces `{name}` with its value; an unknown name is an error so a typo never types a literal `{code}`. */
export function fill(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{([a-z][a-z0-9]*)\}/g, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`no value for {${name}}; a read step must set it first`);
    return value;
  });
}

/** One line naming a step, for logs and the report. */
export function describeStep(step: Step): string {
  switch (step.do) {
    case 'goto':
      return `goto ${step.url}`;
    case 'click':
    case 'tap':
      return `${step.do} ${step.text !== undefined ? `"${step.text}"` : (step.selector ?? `at ${'at' in step ? step.at?.join(',') : ''}`)}`;
    case 'press':
      return `press ${step.key}${step.times > 1 ? ` x${step.times}` : ''}`;
    case 'swipe':
      return `swipe ${step.from.join(',')} -> ${step.to.join(',')}`;
    case 'wait':
      return `wait ${step.ms}ms`;
    case 'shot':
      return `shot ${step.name}`;
    case 'read':
      return `read ${step.url ? 'url' : step.selector} as {${step.as}}`;
    case 'expect':
      return `expect ${[step.text !== undefined ? `text "${step.text}"` : '', step.pixels ? `pixels ${step.pixels}` : '', step.look ? 'look' : ''].filter(Boolean).join(' + ')}`;
  }
}
