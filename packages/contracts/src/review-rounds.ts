import { z } from 'zod';
import { SLOT_IDS, VIEWPORT_IDS } from './image-slots.js';
import { scenarioNameSchema } from './game.js';
import { MediaMeta } from './media-meta.js';

const Key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u);
const Ticket = z.string().regex(/^[1-9]\d{0,15}$/u);
const ReviewTicket = z.union([Ticket, z.literal('publish')]);

export const FidelityPhase = z.enum(['mock', 'prototype', 'build', 'polish']);
export const ReviewEffort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export const fidelityEffort = { mock: 'low', prototype: 'medium', build: 'xhigh', polish: 'high' } as const;
export function phaseEffort(phase: { id: string; effort?: z.infer<typeof ReviewEffort> }, index: number) {
  const parsed = FidelityPhase.safeParse(phase.id);
  return (
    phase.effort ??
    (parsed.success ? fidelityEffort[parsed.data] : ((['low', 'medium', 'xhigh', 'high'] as const)[index] ?? 'high'))
  );
}

// Definitions live with a game; runtime round state belongs to the API database.
export const ReviewTrack = z
  .object({
    id: Key,
    category: z.enum(['art', 'gameplay', 'sound']),
    phases: z
      .array(
        z
          .object({
            id: Key,
            ticket: Ticket.optional(),
            template: z.string().min(1),
            effort: ReviewEffort.optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((track, ctx) => {
    if (new Set(track.phases.map((phase) => phase.id)).size !== track.phases.length)
      ctx.addIssue({ code: 'custom', message: 'phase ids must be unique', path: ['phases'] });
    const order = FidelityPhase.options;
    const rungs = track.phases.map((phase, index) => {
      const named = order.indexOf(phase.id as (typeof order)[number]);
      return named < 0 ? index : named;
    });
    const legacy = track.phases.every((phase) => !order.includes(phase.id as (typeof order)[number]));
    if (!legacy && rungs.some((value, i) => value >= order.length || (i > 0 && value <= rungs[i - 1]!)))
      ctx.addIssue({ code: 'custom', message: 'fidelity phases must be ordered', path: ['phases'] });
  });
export type ReviewTrack = z.infer<typeof ReviewTrack>;

export const ReviewMedia = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('still'),
      ref: z.string().min(1).max(512),
      role: z.literal('target').optional(),
      viewport: z.enum(VIEWPORT_IDS).optional(),
      slot: z.enum(SLOT_IDS).optional(),
      meta: MediaMeta.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip'),
      ref: z.string().min(1).max(512),
      hasAudio: z.boolean(),
      meta: MediaMeta.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('build'),
      ref: z.string().min(1).max(512),
      /** The scenario the review plays (`GameModule.scenarios`): the card embeds the build started there (#1281). */
      scenario: scenarioNameSchema.optional(),
      meta: MediaMeta.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('audio'), ref: z.string().min(1).max(512), meta: MediaMeta.optional() }).strict(),
]);

export const ReviewSubmission = z
  .object({
    id: z.uuid(),
    track: Key,
    phase: Key,
    category: z.enum(['art', 'gameplay', 'sound']),
    ticket: ReviewTicket,
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
    prNumber: z.number().int().positive().optional(),
    media: z.array(ReviewMedia).min(1).max(16),
    question: z.string().trim().min(1).optional(),
    works: z.array(z.string().trim().min(1).max(240)).max(32).optional(),
    limitations: z.array(z.string().trim().min(1).max(240)).max(32).optional(),
    decisionIds: z.array(Key).max(6).optional(),
    sourceTickets: z.array(Ticket).min(1).max(20).optional(),
    clipStatus: z.enum(['captured', 'unchecked']).optional(),
  })
  .strict()
  .superRefine((round, ctx) => {
    for (const field of ['works', 'limitations', 'decisionIds', 'sourceTickets'] as const) {
      const values = round[field];
      if (values && new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', message: `${field} must be unique`, path: [field] });
    }
    if (round.ticket === 'publish' && round.track !== 'prototype-publish')
      ctx.addIssue({
        code: 'custom',
        message: 'publish ticket is reserved for published prototype rounds',
        path: ['ticket'],
      });
    if (round.track === 'prototype-publish' && round.sourceTickets?.length && round.ticket !== round.sourceTickets[0])
      ctx.addIssue({ code: 'custom', message: 'ticket must be the first source ticket', path: ['ticket'] });
    if (round.media.filter((media) => media.kind === 'still' && media.role === 'target').length > 1)
      ctx.addIssue({ code: 'custom', message: 'only one concept target is allowed', path: ['media'] });
    if (
      round.category === 'art' &&
      !round.media.some((media) => (media.kind === 'still' && media.role !== 'target') || media.kind === 'clip')
    )
      ctx.addIssue({ code: 'custom', message: 'art requires a still or capture clip', path: ['media'] });
    if (
      round.category === 'sound' &&
      !round.media.some(
        (media) => (round.phase === 'mock' && media.kind === 'audio') || (media.kind === 'clip' && media.hasAudio),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message:
          round.phase === 'mock'
            ? 'sound mock requires audio or a capture clip'
            : 'sound requires a capture clip with audio',
        path: ['media'],
      });
    if (round.category === 'gameplay') {
      if (
        !round.media.some(
          (media) =>
            media.kind === 'build' ||
            (round.phase === 'mock' && ((media.kind === 'still' && media.role !== 'target') || media.kind === 'clip')),
        )
      )
        ctx.addIssue({ code: 'custom', message: 'gameplay requires a preview build', path: ['media'] });
      if (!round.question)
        ctx.addIssue({ code: 'custom', message: 'gameplay requires a design question', path: ['question'] });
    }
  });
export type ReviewSubmission = z.infer<typeof ReviewSubmission>;
