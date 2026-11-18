import { z } from 'zod';

// aiur's ticket detail (aiur-team/aiur#8043, `GET /api/v1/tickets/:identifier/detail`): what a ticket did, for open and
// closed tickets alike. Only the fields a host shows are required; everything else aiur adds passes through.

const PrSchema = z
  .object({
    number: z.number().int(),
    url: z.string(),
    state: z.string(),
    draft: z.boolean().optional(),
    merged_at: z.string().nullish(),
    ci: z.object({ state: z.string() }).loose().nullish(),
  })
  .loose();

export const TicketDetailMediaSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    mime: z.string().nullish(),
    round: z.number().int().nullish(),
    caption: z.string().nullish(),
    url: z.string(),
  })
  .loose();

const TimelineEntrySchema = z
  .object({
    at: z.string(),
    kind: z.string(),
    round: z.number().int().nullish(),
    label: z.string().nullish(),
    detail: z.record(z.string(), z.unknown()).nullish(),
  })
  .loose();

export const TicketDetailSchema = z
  .object({
    identifier: z.string(),
    title: z.string(),
    url: z.string().nullish(),
    state: z.string(),
    status: z.string(),
    phase: z.string().nullish(),
    summary: z.object({ text: z.string() }).loose().nullish(),
    pr: PrSchema.nullish(),
    media: z.array(TicketDetailMediaSchema).default([]),
    timeline: z.array(TimelineEntrySchema).default([]),
    live: z.object({ running: z.boolean(), activity: z.string().nullish() }).loose().nullish(),
  })
  .loose();

export type TicketDetail = z.output<typeof TicketDetailSchema>;
export type TicketDetailMedia = z.output<typeof TicketDetailMediaSchema>;
