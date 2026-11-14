import { z } from 'zod';

const Key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u);
const Ticket = z.string().regex(/^[1-9]\d{0,15}$/u);

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
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((track, ctx) => {
    if (new Set(track.phases.map((phase) => phase.id)).size !== track.phases.length)
      ctx.addIssue({ code: 'custom', message: 'phase ids must be unique', path: ['phases'] });
  });
export type ReviewTrack = z.infer<typeof ReviewTrack>;

export const ReviewMedia = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('still'), ref: z.string().min(1).max(512) }).strict(),
  z.object({ kind: z.literal('clip'), ref: z.string().min(1).max(512), hasAudio: z.boolean() }).strict(),
  z.object({ kind: z.literal('build'), ref: z.string().min(1).max(512) }).strict(),
  z.object({ kind: z.literal('audio'), ref: z.string().min(1).max(512) }).strict(),
]);

export const ReviewSubmission = z
  .object({
    id: z.uuid(),
    track: Key,
    phase: Key,
    category: z.enum(['art', 'gameplay', 'sound']),
    ticket: Ticket,
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
    prNumber: z.number().int().positive().optional(),
    media: z.array(ReviewMedia).min(1).max(16),
    question: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((round, ctx) => {
    if (round.category === 'art' && !round.media.some((media) => media.kind === 'still' || media.kind === 'clip'))
      ctx.addIssue({ code: 'custom', message: 'art requires a still or capture clip', path: ['media'] });
    if (round.category === 'sound' && !round.media.some((media) => media.kind === 'clip' && media.hasAudio))
      ctx.addIssue({ code: 'custom', message: 'sound requires a capture clip with audio', path: ['media'] });
    if (round.category === 'gameplay') {
      if (!round.media.some((media) => media.kind === 'build'))
        ctx.addIssue({ code: 'custom', message: 'gameplay requires a preview build', path: ['media'] });
      if (!round.question)
        ctx.addIssue({ code: 'custom', message: 'gameplay requires a design question', path: ['question'] });
    }
  });
export type ReviewSubmission = z.infer<typeof ReviewSubmission>;
