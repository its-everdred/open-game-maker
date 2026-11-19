import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { loadFamilies } from '@ogm/asset-cards';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { resolveContainedPath } from '../../context.js';
import {
  CORE_RELEASE_SET_PATH,
  localCoreDependencies,
  readCoreReleaseSet,
  resolveCoreDependencies,
} from '../../core-release-set.js';
import { isEmptyDirectory } from '../../filesystem.js';
import { AGENTS_MD } from '../../skills/agents-md.js';
import { gmCliVersion, locatePackAdapterPackage, locateSkillPack, locateTemplates } from '../../skills/pack.js';

const TEMPLATES = new Set(['game-2d', 'game-3d', 'game-multiplayer']);
const GAME_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function copyContents(source: string, destination: string): void {
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(destination, entry), { recursive: true });
  }
}

/** Style ids come from the same registry `gm assets search` reads. */
function validateStyle(family: string | undefined, set: string | undefined): void {
  const families = loadFamilies();
  if (family && !families.some((entry) => entry.id === family)) {
    const parent = families.find((entry) => entry.sets.some((entry) => entry.id === family));
    if (parent) {
      throw new UsageError(`"${family}" is a style set, not a family`, `use --family ${parent.id}`);
    }
    throw new UsageError(
      `unknown style family "${family}"`,
      `choose one of ${families.map((entry) => entry.id).join(', ')}`,
    );
  }
  if (!set) return;
  const parent = families.find((entry) => entry.sets.some((entry) => entry.id === set));
  if (!parent) {
    throw new UsageError(
      `unknown style set "${set}"`,
      `choose one of ${families.flatMap((entry) => entry.sets.map((entry) => entry.id)).join(', ')}`,
    );
  }
  if (family && parent.id !== family) {
    throw new UsageError(
      `style set "${set}" belongs to family "${parent.id}", not "${family}"`,
      `use --family ${parent.id}`,
    );
  }
}

function adapterVersion(cwd: string, set: string): string {
  const packagePath = locatePackAdapterPackage(cwd, set);
  if (!packagePath) return gmCliVersion();
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: unknown; version?: unknown };
  if (packageJson.name !== `@gm/pack-${set}` || typeof packageJson.version !== 'string') {
    throw new Error(`invalid adapter package metadata: ${packagePath}`);
  }
  return packageJson.version;
}

function pinAdapter(gameDir: string, set: string, specifier: string): void {
  const packagePath = join(gameDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  packageJson.dependencies = Object.fromEntries(
    Object.entries({ ...(packageJson.dependencies ?? {}), [`@gm/pack-${set}`]: specifier }).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function readPackageJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function findInstanceGames(start: string): Promise<string | null> {
  let current = resolve(start);
  for (;;) {
    const packagePath = join(current, 'package.json');
    if (existsSync(packagePath)) {
      const packageJson = await readPackageJson(packagePath);
      const instance = (packageJson?.gameMaker as { instance?: unknown } | undefined)?.instance;
      const gamesPath = join(current, 'games');
      const packagesPath = join(current, 'packages');
      if (instance === true && existsSync(join(current, 'pnpm-workspace.yaml'))) {
        const [games, packages] = await Promise.all([
          resolveContainedPath(current, gamesPath).catch(() => null),
          resolveContainedPath(current, packagesPath).catch(() => null),
        ]);
        if (games && packages && statSync(games).isDirectory() && statSync(packages).isDirectory()) return games;
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

type CoreScaffold = {
  /** The release set's core commit, when the instance repository has one. */
  readonly sha: string | null;
  readonly registry: string;
  /** Whether a release set was read: a set without the game's core packages refuses instead of guessing. */
  readonly hasSet: boolean;
  readonly note: string | null;
  /** The release set's specifiers, so a pinned style adapter installs its released version too. */
  readonly packages: Readonly<Record<string, string>>;
};

/**
 * Replaces the staged game's local core dependencies with the released specifiers from the instance
 * repository's version set. A template with no core dependency needs no set unless a style adapter is
 * pinned from it; an instance repository with no set yet keeps the template's workspace links and is told
 * how to get the released ones; a set that does not list a core dependency the template needs refuses
 * rather than scaffolding a game that cannot install.
 */
async function resolveStagedCoreDeps(gameDir: string, instanceRoot: string, needsSet: boolean): Promise<CoreScaffold> {
  const packagePath = join(gameDir, 'package.json');
  const text = readFileSync(packagePath, 'utf8');
  const local = localCoreDependencies(JSON.parse(text) as Record<string, unknown>);
  if (local.length === 0 && !needsSet) {
    return { sha: null, registry: '', hasSet: false, note: null, packages: {} };
  }
  const set = await readCoreReleaseSet(instanceRoot);
  if (set === null) {
    return {
      sha: null,
      registry: '',
      hasSet: false,
      packages: {},
      note:
        local.length === 0
          ? null
          : `note: no ${CORE_RELEASE_SET_PATH} in this instance repository, so ${local.join(', ')} keep the ` +
            "template's workspace link. Run core-release switch --apply from a core checkout to install the " +
            'published core packages instead',
    };
  }
  const { after, resolution } = resolveCoreDependencies(text, set);
  if (resolution.missing.length > 0) {
    throw new UsageError(
      `the release set in ${CORE_RELEASE_SET_PATH} does not list ${resolution.missing.join(', ')}`,
      'run core-release switch --apply from the core checkout to record the current core packages',
    );
  }
  if (after !== text) writeFileSync(packagePath, after);
  return { sha: set.sha, registry: set.registry, hasSet: true, note: null, packages: set.packages };
}

function nameGamePackage(gameDir: string, slug: string): void {
  const packagePath = join(gameDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
  packageJson.name = `@game/${slug}`;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function removeCoreWorkspaceReferences(gameDir: string): void {
  const tsconfigPath = join(gameDir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return;
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
    references?: Array<{ path?: unknown }>;
  };
  if (!tsconfig.references) return;
  tsconfig.references = tsconfig.references.filter(
    (reference) =>
      typeof reference.path !== 'string' ||
      !/^\.\.\/\.\.\/packages\/(contracts|iframe-bridge|sdk)$/.test(reference.path),
  );
  if (tsconfig.references.length === 0) delete tsconfig.references;
  writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
}

export const command: GmCommand = {
  name: 'new',
  summary: 'add a scaffold-only game to the instance repository',
  usage: '<game-2d|game-3d|game-multiplayer> <slug> [--family id] [--set id] [--pov id]',
  example: 'new game-2d my-game --family isometric-2d --set smallscaleint --pov side',
  flags: {
    family: { type: 'string', help: 'record the chosen style-family id' },
    set: { type: 'string', help: 'pin one registered style-set adapter' },
    pov: { type: 'string', help: 'record the chosen point-of-view id' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 2) throw new UsageError('gm new needs a template and game slug', 'gm help new');
    const [template, requested] = args;
    if (!TEMPLATES.has(template)) throw new UsageError(`unknown template "${template}"`, 'gm help new');
    if (!GAME_SLUG.test(requested)) {
      throw new UsageError(`invalid game slug "${requested}"`, 'use lower-case letters, numbers, and single hyphens');
    }
    const gamesRoot = await findInstanceGames(ctx.cwd);
    if (!gamesRoot) {
      throw new UsageError('not inside a Game Maker instance repository', 'run gm instance init <dir> first');
    }
    const templates = locateTemplates(ctx.cwd);
    const source = templates ? join(templates, template) : '';
    if (!source || !existsSync(source) || !statSync(source).isDirectory()) {
      throw new UsageError(`template "${template}" is unavailable`, 'install the matching platform template');
    }
    const destination = join(gamesRoot, requested);
    if (existsSync(destination) && !isEmptyDirectory(destination)) {
      throw new UsageError(`destination is not empty: ${destination}`, 'choose an empty directory');
    }
    const family = typeof flags.family === 'string' ? flags.family : undefined;
    const set = typeof flags.set === 'string' ? flags.set : undefined;
    const pov = typeof flags.pov === 'string' ? flags.pov : undefined;
    validateStyle(family, set);
    if (set && !existsSync(join(locateSkillPack(ctx.cwd, ctx.skillsDir), `gm-set-${set}`, 'SKILL.md'))) {
      throw new UsageError(
        `style set "${set}" has no installed skill`,
        'choose a set supported by this Game Maker installation',
      );
    }

    mkdirSync(dirname(destination), { recursive: true });
    let core: CoreScaffold;
    const staging = mkdtempSync(join(dirname(destination), '.gm-new-stage-'));
    try {
      copyContents(source, staging);
      nameGamePackage(staging, requested);
      removeCoreWorkspaceReferences(staging);
      // The core repository's templates link core sources with workspace:*; an instance repository has
      // no core checkout to link to, so the released specifiers from its version set replace them.
      core = await resolveStagedCoreDeps(staging, dirname(gamesRoot), set !== undefined);
      // A pinned style adapter installs its released version when the set has one; the local manifest
      // version only applies to a core checkout, where the adapter is a workspace link. A set that lists
      // the game's other core packages but not the adapter cannot install the game, so refuse instead of
      // writing a bare local version no registry serves.
      if (set) {
        const releasedAdapter = core.packages[`@gm/pack-${set}`];
        if (releasedAdapter !== undefined) {
          pinAdapter(staging, set, releasedAdapter);
        } else if (core.hasSet) {
          throw new UsageError(
            `the release set in ${CORE_RELEASE_SET_PATH} does not list @gm/pack-${set}`,
            'run core-release switch --apply from the core checkout to record the current core packages',
          );
        } else {
          pinAdapter(staging, set, adapterVersion(ctx.cwd, set));
        }
      }
      writeFileSync(join(staging, 'AGENTS.md'), AGENTS_MD);
      writeFileSync(
        join(staging, 'gm.lock.json'),
        `${JSON.stringify(
          {
            v: 1,
            template,
            ...(family ? { family } : {}),
            ...(set ? { set } : {}),
            ...(pov ? { pov } : {}),
            ...(core.sha === null ? {} : { core: { sha: core.sha, registry: core.registry } }),
            createdAt: new Date().toISOString(),
            gmVersion: gmCliVersion(),
          },
          null,
          2,
        )}\n`,
      );
      if (existsSync(destination)) rmdirSync(destination);
      renameSync(staging, destination);
    } finally {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    }
    if (core.note !== null) ctx.out(core.note);
    ctx.out(
      `created ${destination}. Next: cd ${dirname(gamesRoot)} && pnpm install --offline (refreshes pnpm-lock.yaml; commit it)`,
    );
    ctx.emit('new.create', { game: requested, template, family: family ?? null, set: set ?? null, pov: pov ?? null });
    return EXIT.ok;
  },
};
