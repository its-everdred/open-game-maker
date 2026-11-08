import { z } from 'zod';

import { Id } from './api.js';
import { ChatAttachmentKind, MAX_IMAGE_ATTACHMENT_BYTES } from './chat.js';
import { EnergyView } from './energy.js';
import { JobKind } from './jobs.js';

// A file the creator attached to the job's chat (#222). The after_create hook downloads `blob` (an attachment id served
// at /internal/jobs/by-ticket/:ticket/attachments/:id) to `path`, inside `.gm/inbox/attachments/`.
export const JobBundleAttachment = z
  .object({
    kind: ChatAttachmentKind,
    name: z.string().min(1).max(200),
    blob: Id,
    bytes: z.number().int().positive().max(MAX_IMAGE_ATTACHMENT_BYTES),
    message_id: Id,
    path: z.string().regex(/^\.gm\/inbox\/attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/),
  })
  .strict();

// T02 §4 after_create contract: what a game repo's hook writes to `.gm/context/bundle.json` (OGM-036).
// Never tokens, keys, cookies, email addresses or the creator's name.
export const JobBundle = z
  .object({
    v: z.literal(1),
    jobId: z.string().min(1),
    gameId: z.string().min(1),
    repo: z.string().min(1),
    kind: JobKind,
    scope_session_id: Id.optional(),
    skillPackVersion: z.string().min(1),
    // Loopback URL of the pack tarball, fetched with the same hook bearer.
    skillPackUrl: z.string().url(),
    gameContext: z
      .object({
        title: z.string(),
        family: z.string(),
        pov: z.string(),
        genre: z.string(),
        multiplayer: z.boolean(),
        branch: z.literal('main'),
        lockfilePath: z.literal('assets.lock.json'),
      })
      .strict(),
    // Private bucket key; gm-repair fetches it through `gm`.
    diagnostics: z
      .object({ reportId: z.string().min(1), bundleKey: z.string().min(1) })
      .strict()
      .optional(),
    attachments: z.array(JobBundleAttachment).optional(),
    // The instance's Energy and the creator's preference when the job started (#598); `gm energy` reads it.
    energy: EnergyView.optional(),
  })
  .strict();

export type JobBundleAttachment = z.infer<typeof JobBundleAttachment>;
export type JobBundle = z.infer<typeof JobBundle>;
