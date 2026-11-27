import { STYLE_FAMILY_IDS } from '@ogm/asset-cards';
import type { AssetCard } from '@ogm/contracts';
import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { basename, resolve } from 'node:path';

import { printJson, requireAssetsRoot } from '../../context.js';
import { readLicenseMap } from '../../packs/license-map.js';

export const command: GmCommand = {
  name: 'packs import',
  summary: 'safely import a quarantined asset drop or local archive',
  usage:
    '<dir|archive> --id <name> [--tier 1|2] [--license <id>] [--license-map <json>] [--version <v>] [--style <family>] [--cameras <list>]',
  example: 'packs import ./Kenney --id kenney-test --version 1 --json',
  flags: {
    id: { type: 'string', help: 'stable kebab-case pack id' },
    style: { type: 'string', help: 'known style family for the collection' },
    cameras: { type: 'string', help: 'comma-separated supported cameras' },
    license: { type: 'string', help: 'known SPDX or LicenseRef id' },
    tier: { type: 'string', help: 'asset tier: 1 (default) or 2' },
    'license-map': { type: 'string', help: 'per-item tier-2 licence JSON' },
    inspiration: { type: 'boolean', default: false, help: 'store outside game-material packs' },
    version: { type: 'string', help: 'vendor or intake version' },
    vendor: { type: 'string', help: 'pack vendor' },
    title: { type: 'string', help: 'pack title' },
    'source-url': { type: 'string', help: 'pack source URL' },
    'from-queue': { type: 'string', help: 'Drive queue drop id' },
    confirm: { type: 'string', help: 'confirm an existing collection id' },
    'confirmed-by': { type: 'string', help: 'human who confirmed the license' },
    note: { type: 'string', help: 'confirmation note' },
    decision: { type: 'string', help: 'rights narrowing: uses=a,b;audience=private;redistribution=none;note=...' },
  },
  async run(ctx, args, flags) {
    const assetsRoot = requireAssetsRoot(ctx);
    if (typeof flags.confirm === 'string') {
      if (flags.style !== undefined || flags.cameras !== undefined) {
        throw new UsageError('--style and --cameras are only available on a new import', 'gm help packs import');
      }
      if (args.length > 0) throw new UsageError('--confirm does not take an input path', 'gm help packs import');
      if (typeof flags.license !== 'string' || typeof flags['confirmed-by'] !== 'string') {
        throw new UsageError('--confirm requires --license and --confirmed-by', 'gm help packs import');
      }
      const { confirmCollection } = await import('../../packs/confirm.js');
      const result = await confirmCollection({
        assetsRoot,
        collectionId: flags.confirm,
        license: flags.license,
        confirmedBy: flags['confirmed-by'],
        ...(typeof flags.note === 'string' ? { note: flags.note } : {}),
        ...(typeof flags.decision === 'string' ? { decision: flags.decision } : {}),
      });
      if (ctx.json) printJson(ctx, result);
      else ctx.out(`${result.collection}  ${result.license}  imported`);
      ctx.emit('packs.import', result);
      return EXIT.ok;
    }
    if (typeof flags.id !== 'string') throw new UsageError('--id is required', 'gm help packs import');
    const tierValue = flags.tier ?? '1';
    if (tierValue !== '1' && tierValue !== '2') throw new UsageError('--tier must be 1 or 2', 'gm help packs import');
    const tier = Number(tierValue) as 1 | 2;
    if (tier === 1 && flags['license-map'] !== undefined) {
      throw new UsageError('--license-map requires --tier 2', 'gm help packs import');
    }
    if (tier === 2 && typeof flags['from-queue'] === 'string') {
      throw new UsageError('--tier 2 cannot import from the Drive queue', 'gm help packs import');
    }
    if (
      args.length > 1 ||
      (args.length === 0 && typeof flags['from-queue'] !== 'string') ||
      (args.length > 0 && typeof flags['from-queue'] === 'string')
    ) {
      throw new UsageError('give one input directory/archive, or --from-queue', 'gm help packs import');
    }
    const style = typeof flags.style === 'string' ? flags.style : undefined;
    if (style !== undefined && !STYLE_FAMILY_IDS.some((family) => family === style)) {
      throw new UsageError('unknown style family', 'gm help packs import');
    }
    const cameras =
      typeof flags.cameras === 'string' ? flags.cameras.split(',').map((value) => value.trim()) : undefined;
    const allowedCameras = ['isometric', 'top-down', 'third-person', 'first-person', 'side'];
    if (
      cameras &&
      (cameras.some((camera) => !allowedCameras.includes(camera)) || new Set(cameras).size !== cameras.length)
    ) {
      throw new UsageError('invalid or duplicate camera', 'gm help packs import');
    }
    if (flags.id.startsWith('smallscaleint-') && cameras?.some((camera) => camera !== 'isometric')) {
      throw new UsageError('SmallScaleInt cameras must be isometric', 'gm help packs import');
    }
    const { importPack, PackRefusal } = await import('../../packs/importer.js');
    let licenseMap;
    try {
      licenseMap =
        typeof flags['license-map'] === 'string'
          ? await readLicenseMap(resolve(ctx.cwd, flags['license-map']))
          : undefined;
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error), 'gm help packs import');
    }
    let result: Awaited<ReturnType<typeof importPack>>;
    try {
      result = await importPack({
        assetsRoot,
        cwd: ctx.cwd,
        ...(args[0] ? { input: args[0] } : {}),
        id: flags.id,
        ...(style ? { styleFamily: style as NonNullable<AssetCard['style_family']> } : {}),
        ...(cameras ? { cameras: cameras as NonNullable<AssetCard['cameras']> } : {}),
        ...(typeof flags.vendor === 'string' ? { vendor: flags.vendor } : {}),
        ...(typeof flags.title === 'string' ? { title: flags.title } : {}),
        ...(typeof flags['source-url'] === 'string' ? { sourceUrl: flags['source-url'] } : {}),
        ...(typeof flags.version === 'string' ? { version: flags.version } : {}),
        ...(typeof flags.license === 'string' ? { license: flags.license } : {}),
        ...(licenseMap
          ? { licenseMap, licenseRef: `operator licence map ${basename(flags['license-map'] as string)}` }
          : {}),
        ...(typeof flags['confirmed-by'] === 'string' ? { confirmedBy: flags['confirmed-by'] } : {}),
        tier,
        inspiration: flags.inspiration === true,
        ...(typeof flags['from-queue'] === 'string' ? { fromQueue: flags['from-queue'] } : {}),
      });
    } catch (error) {
      if (error instanceof PackRefusal) throw new UsageError(error.message, 'gm help packs import');
      throw error;
    }
    if (ctx.json) printJson(ctx, result);
    else ctx.out(`${result.collection}  ${result.status}  ${result.cards} card(s)`);
    ctx.emit('packs.import', result);
    return EXIT.ok;
  },
};
