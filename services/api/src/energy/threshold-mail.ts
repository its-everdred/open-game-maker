import { schema, type Db } from '@ogm/db';
import { randomUUID } from 'node:crypto';
import type { EnergyResource } from '@ogm/contracts';
import { and, eq } from 'drizzle-orm';
import type { MailMessage } from '../auth/mail.js';

// Mail each current platform admin once per resource/reset period. Unknown or stale readings cannot trigger a warning.
export async function sendResourceThresholdMail(
  db: Db,
  mail: { send(message: MailMessage): Promise<unknown> },
  resources: EnergyResource[],
  maintainers: ReadonlySet<string> = new Set(),
): Promise<void> {
  const failures: unknown[] = [];
  const admins = db
    .select({ email: schema.allowedUsers.email })
    .from(schema.allowedUsers)
    .where(eq(schema.allowedUsers.role, 'admin'))
    .all();
  const allowed = db.select({ email: schema.allowedUsers.email }).from(schema.allowedUsers).all();
  for (const { email } of allowed) {
    if (maintainers.has(email.toLowerCase()) && !admins.some((admin) => admin.email === email)) admins.push({ email });
  }
  for (const resource of resources) {
    if (
      resource.resetsAt === null &&
      resource.freshness === 'fresh' &&
      resource.basis !== 'unknown' &&
      resource.used !== null &&
      resource.limit !== null &&
      resource.limit > 0 &&
      resource.used / resource.limit < 0.95
    ) {
      for (const { email } of admins) {
        const key = `resource-warning:${encodeURIComponent(resource.id)}:no-reset:${encodeURIComponent(email)}`;
        db.delete(schema.appMeta)
          .where(and(eq(schema.appMeta.key, key), eq(schema.appMeta.value, 'sent')))
          .run();
      }
    }
    if (
      resource.freshness !== 'fresh' ||
      resource.basis === 'unknown' ||
      resource.used === null ||
      resource.limit === null ||
      resource.limit <= 0 ||
      resource.used / resource.limit < 0.95
    )
      continue;
    const kind =
      resource.kind === 'subscription_window' && resource.serves.includes('coding')
        ? 'Minerals'
        : resource.unit === 'usd' && resource.kind === 'metered_spend'
          ? 'Gas'
          : null;
    if (!kind) continue;
    for (const { email } of admins) {
      const key = `resource-warning:${encodeURIComponent(resource.id)}:${encodeURIComponent(resource.resetsAt ?? 'no-reset')}:${encodeURIComponent(email)}`;
      const existing = db.select().from(schema.appMeta).where(eq(schema.appMeta.key, key)).get();
      if (existing?.value.startsWith('pending:') && Date.now() - Number(existing.value.split(':')[1]) > 300_000) {
        db.delete(schema.appMeta)
          .where(and(eq(schema.appMeta.key, key), eq(schema.appMeta.value, existing.value)))
          .run();
      }
      const owner = randomUUID();
      let lease = `pending:${Date.now()}:${owner}`;
      const claim = db.insert(schema.appMeta).values({ key, value: lease }).onConflictDoNothing().run();
      if (claim.changes === 0) continue;
      const renewal = setInterval(() => {
        try {
          const next = `pending:${Date.now()}:${owner}`;
          const updated = db
            .update(schema.appMeta)
            .set({ value: next })
            .where(and(eq(schema.appMeta.key, key), eq(schema.appMeta.value, lease)))
            .run();
          if (updated.changes) lease = next;
        } catch {
          // A failed renewal can be retried on the next tick; the lease still expires after a crash.
        }
      }, 60_000);
      renewal.unref();
      try {
        const qualifier = resource.basis === 'estimate' ? ' (estimate)' : '';
        await mail.send({
          to: email,
          subject: `${kind} is 95% used`,
          text: `${resource.label} has reached at least 95% of its limit${qualifier}.${resource.resetsAt ? ` Resets ${resource.resetsAt}.` : ''}`,
        });
        db.update(schema.appMeta)
          .set({ value: 'sent' })
          .where(and(eq(schema.appMeta.key, key), eq(schema.appMeta.value, lease)))
          .run();
      } catch (error) {
        db.delete(schema.appMeta)
          .where(and(eq(schema.appMeta.key, key), eq(schema.appMeta.value, lease)))
          .run();
        failures.push(error);
      } finally {
        clearInterval(renewal);
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Resource threshold mail failed');
}
