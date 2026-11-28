import { z } from 'zod';

const Visibility = z.enum(['public', 'private']);
const Identifier = z.string().min(1);
const Sha = z.string().min(1);
// A game's folder name under `games/`: the shareable URL slug, so it stays a plain path segment (#513).
const Slug = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'slug is lowercase words joined by single hyphens');

// One instance keeps every game in one implementation repository: `games/<slug>/` per game, `packages/<name>/` for
// components that instance's games share.
export const GAMES_ROOT = 'games';
export const PACKAGES_ROOT = 'packages';

export function gameFolder(slug: string): string {
  return `${GAMES_ROOT}/${slug}`;
}

const BoundaryReason = z
  .object({
    code: z.enum(['path', 'size', 'secret', 'pii', 'rights', 'denylist']),
    path: z.string().optional(),
    detail: z.string().min(1),
  })
  .strict();

export const BoundaryVerdict = z
  .object({
    allowed: z.boolean(),
    reasons: z.array(BoundaryReason),
  })
  .strict();

export type BoundaryVerdict = z.infer<typeof BoundaryVerdict>;

/*
 * One instance keeps every game in one implementation repository: `games/<slug>/` per game, `packages/<name>/` for
 * components that instance's games share. So there is no repository to create per game — `create_game` writes the
 * folder on a branch, opens a pull request and merges it as the bot. Every other operation addresses a game by its
 * registry id and the commit service resolves its folder from the API.
 */
export const CommitOp = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create_game'),
      gameId: Identifier,
      slug: Slug,
      templateRef: Identifier,
      visibility: Visibility,
      // A fork copies another game's folder instead of rendering the template.
      from: z.object({ gameId: Identifier, sha: Sha }).strict().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('fold_design'),
      gameId: Identifier,
      base: Sha,
      files: z.array(
        z
          .object({
            path: z.string().min(1),
            content: z.string(),
          })
          .strict(),
      ),
      // The executor-approved promotion path: only a promotion may also write `packages/`.
      promotion: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('release'),
      gameId: Identifier,
      sha: Sha,
      semver: Identifier,
      changelog: z.string(),
    })
    .strict(),
  // Restores one game's folder from an earlier commit and leaves every other folder untouched.
  z
    .object({
      kind: z.literal('restore_game'),
      gameId: Identifier,
      sha: Sha,
    })
    .strict(),
  z
    .object({
      kind: z.literal('merge'),
      gameId: Identifier,
      prNumber: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set_visibility'),
      gameId: Identifier,
      visibility: Visibility,
    })
    .strict(),
  z
    .object({
      kind: z.literal('file_issue'),
      title: z.string().min(1),
      body: z.string(),
      labels: z.array(z.string().min(1)),
      // Present when the report is about one game: the issue lands in the instance repo with a `game:<slug>` label.
      gameId: Identifier.optional(),
      idempotencyKey: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,100}$/)
        .optional(),
      reconcile: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('create_branch'),
      gameId: Identifier,
      branch: Identifier,
      sha: Sha,
    })
    .strict(),
]);

export type CommitOp = z.infer<typeof CommitOp>;

export const CommitResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), sha: z.string().min(1) }).strict(),
  z.object({ ok: z.literal(false), verdict: BoundaryVerdict }).strict(),
]);

export type CommitResult = z.infer<typeof CommitResult>;

export const schemas = {
  'commit.v1': CommitOp,
} satisfies Record<'commit.v1', z.ZodType>;
