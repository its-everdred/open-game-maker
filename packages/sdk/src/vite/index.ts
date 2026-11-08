import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  AssetsLockSchema,
  creditsFromLock,
  gameManifestSchema,
  renderCredits,
  StrictDesignDocSchema,
  type CreditsDocument,
  type DesignDoc,
  type GameManifest,
} from '@ogm/contracts';

/* Node-only (a Vite plugin for game builds): tsc emits it; the browser bundle in scripts/build.mjs leaves it out. */

/** Where the games host and the API read a build's manifest and design (services/api/src/design/base-doc.ts). */
export const MANIFEST_FILE = 'manifest.json';
export const DESIGN_FILE = 'design/design.json';
export const CREDITS_FILE = 'credits.json';

/**
 * Files a game keeps in `design/` that are not design docs. The creator feedback ledger (#567) and the decision record
 * (#595) are game data — the creator's rejections and the questions already put to them — so the build must not fold
 * them into the published design doc. The build folds every other `*.json` there.
 */
export const DESIGN_DIR_NON_DOCS = ['feedback.json', 'decisions.json'];

export function regenerateCredits(lockFile: string, creditsFile: string): CreditsDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(lockFile, 'utf8'));
  } catch (error) {
    throw new Error(`assets lock is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const lock = AssetsLockSchema.parse(raw);
  const document = creditsFromLock(lock);
  writeFileSync(creditsFile, renderCredits(lock));
  return document;
}

function mergeDisjoint<T>(into: Record<string, T>, from: Record<string, T>, what: string, file: string): void {
  for (const [key, value] of Object.entries(from)) {
    if (key in into) throw new Error(`design/${file}: ${what} "${key}" is already defined by another design file`);
    into[key] = value;
  }
}

/** Fold every design-doc `*.json` in a design directory (name order) into one doc; a key defined twice is an error. */
export function foldDesignFiles(designDir: string): DesignDoc {
  const files = readdirSync(designDir)
    .filter((name) => name.endsWith('.json') && !DESIGN_DIR_NON_DOCS.includes(name))
    .sort();
  if (files.length === 0) throw new Error(`${designDir} has no design files`);

  let folded: DesignDoc | undefined;
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(designDir, file), 'utf8'));
    } catch (error) {
      throw new Error(`design/${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    const parsed = StrictDesignDocSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`design/${file} is not a valid design doc: ${parsed.error.message}`);
    const doc = parsed.data;
    if (!folded) {
      folded = { schemaVersion: doc.schemaVersion, globals: {}, entities: {} };
    } else if (doc.schemaVersion !== folded.schemaVersion) {
      throw new Error(`design/${file}: schemaVersion ${doc.schemaVersion} differs from ${folded.schemaVersion}`);
    }
    mergeDisjoint(folded.globals, doc.globals, 'global', file);
    mergeDisjoint(folded.entities, doc.entities, 'entity', file);
  }
  return folded as DesignDoc;
}

type EmitContext = { emitFile(file: { type: 'asset'; fileName: string; source: string }): string };

/** Vite plugin: publish the host artifacts and refresh the game's checked-in credits from its current lock. */
export function gmBuildArtifacts(options: {
  manifest: GameManifest;
  designDir: string;
  assetsLockFile?: string;
  creditsFile?: string;
}) {
  const gameRoot = dirname(resolve(options.designDir));
  return {
    name: 'gm-build-artifacts',
    generateBundle(this: EmitContext) {
      const manifest = gameManifestSchema.parse(options.manifest);
      const design = foldDesignFiles(options.designDir);
      const credits = regenerateCredits(
        options.assetsLockFile ?? join(gameRoot, 'assets.lock.json'),
        options.creditsFile ?? join(gameRoot, 'CREDITS.md'),
      );
      this.emitFile({ type: 'asset', fileName: MANIFEST_FILE, source: `${JSON.stringify(manifest, null, 2)}\n` });
      this.emitFile({ type: 'asset', fileName: DESIGN_FILE, source: `${JSON.stringify(design, null, 2)}\n` });
      this.emitFile({ type: 'asset', fileName: CREDITS_FILE, source: `${JSON.stringify(credits, null, 2)}\n` });
    },
  };
}
