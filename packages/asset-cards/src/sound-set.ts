import { z } from 'zod';

// A sound-set card groups independently licensed recordings; it cannot be
// represented as one asset card without losing their individual rights.
const Audition = z.looseObject({ status: z.string().min(1) });
const Variation = z.looseObject({
  id: z.string().min(1),
  pack_id: z.string().min(1),
  pack_title: z.string().min(1),
  pack_version: z.string().min(1),
  source_path: z.string().min(1),
  collection_card: z.string().nullable(),
  license: z.string().min(1),
  rights_uses: z.array(z.string()),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  audio: z.looseObject({
    channels: z.number().int().positive(),
    codec: z.string().min(1),
    duration_seconds: z.number().positive(),
    sample_rate: z.number().int().positive(),
  }),
  audition: Audition,
});

export const SoundSetCardSchema = z
  .looseObject({
    schema: z.literal('ogm.sound-set-card/1.0'),
    id: z.string().min(1),
    set_id: z.string().min(1),
    category_id: z.string().min(1),
    title: z.string().min(1),
    intent: z.string().min(1),
    variation_count: z.number().int().positive(),
    preview: z.looseObject({
      path: z.string().min(1),
      order: z.array(z.string().min(1)),
      excerpt_seconds: z.number().positive(),
      gap_seconds: z.number().nonnegative(),
      audition: Audition,
    }),
    variations: z.array(Variation).min(1),
    provenance: z.record(z.string(), z.unknown()),
  })
  .refine(
    (card) => card.variation_count === card.variations.length && card.preview.order.length === card.variations.length,
    {
      message: 'variation count and preview order must match variations',
    },
  );
export type SoundSetCard = z.infer<typeof SoundSetCardSchema>;
