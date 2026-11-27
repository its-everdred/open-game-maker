import { randomUUID } from 'node:crypto';

import { schema } from '@ogm/db';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';

export const checkRecordBody = z
  .object({
    gitSha: z.string().regex(/^[0-9a-f]{40}$/),
    artifactSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    testArtifactSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    surface: z.literal('game'),
    sizes: z.array(z.string().max(40)).max(20),
    checks: z
      .array(z.object({ name: z.string().min(1).max(120), result: z.enum(['passed', 'failed']) }))
      .min(1)
      .max(50),
  })
  .strict();

export const appCheckRecordBody = checkRecordBody
  .extend({
    surface: z.literal('app'),
    publishResult: z.enum(['published', 'skipped', 'failed']),
    recordId: z.string().uuid(),
    attemptedAt: z.string().datetime(),
  })
  .refine((input) => input.publishResult !== 'published' || input.artifactSha256 !== undefined, {
    message: 'published app records require an artifact hash',
    path: ['artifactSha256'],
  });

export function recordChecks(
  deps: AppDeps,
  gameId: string | null,
  input: z.infer<typeof checkRecordBody> | z.infer<typeof appCheckRecordBody>,
) {
  const id = `pc_${input.surface === 'app' ? input.recordId : randomUUID()}`;
  const result = input.checks.every((check) => check.result === 'passed') ? 'passed' : 'failed';
  const row = {
    id,
    gameId,
    gitSha: input.gitSha,
    artifactSha256: input.artifactSha256 ?? null,
    testArtifactSha256: input.testArtifactSha256 ?? null,
    surface: input.surface,
    sizesJson: JSON.stringify(input.sizes),
    checksJson: JSON.stringify(input.checks),
    result,
    publishResult:
      input.surface === 'app'
        ? input.publishResult
        : result === 'failed'
          ? 'skipped'
          : input.artifactSha256
            ? 'pending'
            : 'failed',
    createdAt: input.surface === 'app' ? input.attemptedAt : new Date().toISOString(),
  } satisfies typeof schema.publishChecks.$inferInsert;
  const inserted = deps.db.insert(schema.publishChecks).values(row).onConflictDoNothing().run();
  if (inserted.changes === 0) {
    const previous = deps.db.select().from(schema.publishChecks).where(eq(schema.publishChecks.id, id)).get();
    if (
      !previous ||
      previous.gameId !== row.gameId ||
      (input.surface === 'app' && previous.createdAt !== row.createdAt) ||
      previous.gitSha !== row.gitSha ||
      previous.artifactSha256 !== row.artifactSha256 ||
      previous.testArtifactSha256 !== row.testArtifactSha256 ||
      previous.surface !== row.surface ||
      previous.sizesJson !== row.sizesJson ||
      previous.checksJson !== row.checksJson ||
      previous.result !== row.result ||
      previous.publishResult !== row.publishResult
    ) {
      throw new HttpError(409, 'publish_check_record_conflict');
    }
  }
  return { id, result };
}

export function listCheckRecords(deps: AppDeps, gameId: string) {
  return deps.db
    .select()
    .from(schema.publishChecks)
    .where(
      or(
        eq(schema.publishChecks.gameId, gameId),
        and(isNull(schema.publishChecks.gameId), eq(schema.publishChecks.surface, 'app')),
      ),
    )
    .orderBy(desc(schema.publishChecks.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      gitSha: row.gitSha,
      artifactSha256: row.artifactSha256,
      testArtifactSha256: row.testArtifactSha256,
      buildId: row.buildId,
      surface: row.surface,
      sizes: JSON.parse(row.sizesJson) as string[],
      checks: JSON.parse(row.checksJson) as unknown,
      result: row.result,
      publishResult: row.publishResult,
      createdAt: row.createdAt,
    }));
}

export function passedChecks(
  deps: AppDeps,
  id: string,
  gameId: string,
  gitSha: string,
  artifactSha256: string,
): boolean {
  const row = deps.db
    .select({ checksJson: schema.publishChecks.checksJson })
    .from(schema.publishChecks)
    .where(
      and(
        eq(schema.publishChecks.id, id),
        eq(schema.publishChecks.gameId, gameId),
        eq(schema.publishChecks.gitSha, gitSha),
        eq(schema.publishChecks.artifactSha256, artifactSha256),
        eq(schema.publishChecks.surface, 'game'),
        eq(schema.publishChecks.result, 'passed'),
      ),
    )
    .get();
  if (!row) return false;
  const checks = JSON.parse(row.checksJson) as { name: string; result: string }[];
  return ['pnpm run test', 'pnpm run build'].every((name) =>
    checks.some((check) => check.name === name && check.result === 'passed'),
  );
}
