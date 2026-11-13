import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { sceneryToDesign } from '../scenery/design.js';

import {
  AssetsLockSchema,
  creditsFromLock,
  gameManifestSchema,
  parseScenery,
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
export const SCENERY_FILE = 'scenery.json';

/** Read and validate optional shared scenery data against the game's lock. */
export function sceneryArtifact(gameRoot: string, lockFile: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(gameRoot, SCENERY_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const lock = AssetsLockSchema.parse(JSON.parse(readFileSync(lockFile, 'utf8')));
  return `${JSON.stringify(parseScenery(JSON.parse(raw), lock.assets), null, 2)}\n`;
}

/**
 * Files a game keeps in `design/` that are not design docs. The creator feedback ledger (#567) and the decision record
 * (#595) are game data — the creator's rejections and the questions already put to them — so the build must not fold
 * them into the published design doc. The visual scope is verification evidence, not a design doc. The build folds
 * every other `*.json` there.
 */
export const DESIGN_DIR_NON_DOCS = ['feedback.json', 'decisions.json', 'look-scope.json'];

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

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Stable entity IDs keep editor transactions attached to the same scenery after a rebuild. */
export function sceneryEntityId(itemId: string): string {
  let value = BigInt(`0x${createHash('sha256').update(itemId).digest('hex').slice(0, 32)}`);
  let encoded = '';
  for (let i = 0; i < 26; i++) {
    encoded = CROCKFORD[Number(value & 31n)]! + encoded;
    value >>= 5n;
  }
  return `e_${encoded}`;
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
      let design = foldDesignFiles(options.designDir);
      const lockFile = options.assetsLockFile ?? join(gameRoot, 'assets.lock.json');
      const scenery = sceneryArtifact(gameRoot, lockFile);
      if (
        manifest.capabilities.includes('scenery') &&
        (scenery !== undefined || !('scenery.settings' in design.globals))
      ) {
        const lock = AssetsLockSchema.parse(JSON.parse(readFileSync(lockFile, 'utf8')));
        const raw = scenery
          ? JSON.parse(scenery)
          : {
              version: 1,
              items: [],
              terrain: [],
              lighting: 'warm-forest',
              camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
            };
        design = sceneryToDesign(parseScenery(raw, lock.assets), design, sceneryEntityId);
      }
      const credits = regenerateCredits(lockFile, options.creditsFile ?? join(gameRoot, 'CREDITS.md'));
      this.emitFile({ type: 'asset', fileName: MANIFEST_FILE, source: `${JSON.stringify(manifest, null, 2)}\n` });
      this.emitFile({ type: 'asset', fileName: DESIGN_FILE, source: `${JSON.stringify(design, null, 2)}\n` });
      if (scenery !== undefined) this.emitFile({ type: 'asset', fileName: SCENERY_FILE, source: scenery });
      this.emitFile({ type: 'asset', fileName: CREDITS_FILE, source: `${JSON.stringify(credits, null, 2)}\n` });
    },
  };
}
