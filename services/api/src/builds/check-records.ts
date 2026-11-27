import { randomUUID } from 'node:crypto';

import { schema } from '@ogm/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AppDeps } from '../app/types.js';

export const checkRecordBody = z
  .object({
    gitSha: z.string().regex(/^[0-9a-f]{40}$/),
    surface: z.literal('game'),
    sizes: z.array(z.string().max(40)).max(20),
    checks: z
      .array(z.object({ name: z.string().min(1).max(120), result: z.enum(['passed', 'failed']) }))
      .min(1)
      .max(50),
  })
  .strict();

export function recordChecks(deps: AppDeps, gameId: string, input: z.infer<typeof checkRecordBody>) {
  const id = `pc_${randomUUID()}`;
  const result = input.checks.every((check) => check.result === 'passed') ? 'passed' : 'failed';
  deps.db
    .insert(schema.publishChecks)
    .values({
      id,
      gameId,
      gitSha: input.gitSha,
      surface: input.surface,
      sizesJson: JSON.stringify(input.sizes),
      checksJson: JSON.stringify(input.checks),
      result,
      publishResult: result === 'failed' ? 'skipped' : 'pending',
      createdAt: new Date().toISOString(),
    })
    .run();
  return { id, result };
}

export function listCheckRecords(deps: AppDeps, gameId: string) {
  return deps.db
    .select()
    .from(schema.publishChecks)
    .where(eq(schema.publishChecks.gameId, gameId))
    .orderBy(desc(schema.publishChecks.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      gitSha: row.gitSha,
      buildId: row.buildId,
      surface: row.surface,
      sizes: JSON.parse(row.sizesJson) as string[],
      checks: JSON.parse(row.checksJson) as unknown,
      result: row.result,
      publishResult: row.publishResult,
      createdAt: row.createdAt,
    }));
}

export function passedChecks(deps: AppDeps, id: string, gameId: string, gitSha: string): boolean {
  const row = deps.db
    .select({ checksJson: schema.publishChecks.checksJson })
    .from(schema.publishChecks)
    .where(
      and(
        eq(schema.publishChecks.id, id),
        eq(schema.publishChecks.gameId, gameId),
        eq(schema.publishChecks.gitSha, gitSha),
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
