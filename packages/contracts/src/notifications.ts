import { z } from 'zod';

import { Id, IsoTime } from './api.js';

export const NotificationKind = z.enum([
  'build.done',
  'job.started',
  'scope.agreed',
  'intake.report',
  'review.reminder',
]);
export const Notification = z.object({
  id: Id,
  userId: Id,
  kind: NotificationKind,
  title: z.string().max(120),
  body: z.string().max(400),
  url: z.string().max(400).optional(),
  data: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  createdAt: IsoTime,
  readAt: IsoTime.nullable(),
});
export const PushSubscriptionInput = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export const NotificationTrigger = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('build.done'),
    userIds: z.array(Id).min(1),
    gameId: Id,
    jobId: Id,
    buildId: z.string(),
    ok: z.boolean(),
  }),
  z.object({ kind: z.literal('job.started'), userIds: z.array(Id).min(1), gameId: Id, jobId: Id }),
  z.object({
    kind: z.literal('scope.agreed'),
    userIds: z.array(Id).min(1),
    gameId: Id,
    jobId: Id,
    sessionId: Id,
  }),
  z.object({
    kind: z.literal('intake.report'),
    userIds: z.array(Id).min(1),
    dropId: z.string(),
    status: z.enum(['imported', 'awaiting-license', 'blocked', 'duplicate']),
  }),
]);
// SSE: GET /api/v1/notifications/stream → "id: <notification id>\nevent: <kind>\ndata: <Notification JSON>"; Last-Event-ID resumes.

export type NotificationKind = z.infer<typeof NotificationKind>;
export type Notification = z.infer<typeof Notification>;
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;
export type NotificationTrigger = z.infer<typeof NotificationTrigger>;

export const notificationsSchemas = {
  'notifications.notification.v1': Notification,
  'notifications.subscription.v1': PushSubscriptionInput,
  'notifications.trigger.v1': NotificationTrigger,
} satisfies Record<string, z.ZodType>;
