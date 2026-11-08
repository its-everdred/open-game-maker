import { isReservedGameSlug } from '@ogm/contracts';
import type { Db } from '@ogm/db';
import { schema } from '@ogm/db';
import { and, eq } from 'drizzle-orm';

import type { GameRow } from './games.js';

// Slug length keeps `/play/<slug>` readable in a chat message and inside a 64-character URL segment budget.
const MAX_SLUG_LENGTH = 48;
const FALLBACK_SLUG = 'game';

// The title as a URL segment: lowercase ASCII words joined by single hyphens. A title with no ASCII letters or digits
// (or only punctuation) still gets a usable slug, because every game needs a shareable link (#513).
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug || FALLBACK_SLUG;
}

// A slug is free when no app route answers to it (#591) and neither a live game nor a retired one holds it. `gameId` is
// the game being (re)named, so reusing a slug that is already its own never blocks the rename.
function isSlugAvailable(db: Db, slug: string, gameId?: string): boolean {
  if (isReservedGameSlug(slug)) return false;
  const live = db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.slug, slug)).get();
  if (live && live.id !== gameId) return false;
  const retired = db
    .select({ gameId: schema.gameSlugs.gameId })
    .from(schema.gameSlugs)
    .where(eq(schema.gameSlugs.slug, slug))
    .get();
  return retired === undefined || retired.gameId === gameId;
}

// Picks the game's next slug from its title and retires the previous one, so a link shared before a rename still opens
// the game.
export function assignSlug(db: Db, title: string, previous?: { gameId: string; slug: string | null }): string {
  const base = slugify(title);
  let slug = base;
  for (let suffix = 2; !isSlugAvailable(db, slug, previous?.gameId); suffix += 1) slug = `${base}-${suffix}`;

  if (previous) {
    db.delete(schema.gameSlugs)
      .where(and(eq(schema.gameSlugs.slug, slug), eq(schema.gameSlugs.gameId, previous.gameId)))
      .run();
    if (previous.slug && previous.slug !== slug) {
      db.insert(schema.gameSlugs)
        .values({ slug: previous.slug, gameId: previous.gameId, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
        .run();
    }
  }

  return slug;
}

// Resolves a `/play/<ref>` link. The id form keeps resolving for links minted before slugs existed; a retired slug
// resolves to the game that used to answer to it.
export function findGameBySlugOrId(db: Db, ref: string): GameRow | null {
  const byId = db.select().from(schema.games).where(eq(schema.games.id, ref)).get();
  if (byId) return byId;

  const bySlug = db.select().from(schema.games).where(eq(schema.games.slug, ref)).get();
  if (bySlug) return bySlug;

  const retired = db
    .select({ gameId: schema.gameSlugs.gameId })
    .from(schema.gameSlugs)
    .where(eq(schema.gameSlugs.slug, ref))
    .get();
  if (!retired) return null;
  return db.select().from(schema.games).where(eq(schema.games.id, retired.gameId)).get() ?? null;
}
