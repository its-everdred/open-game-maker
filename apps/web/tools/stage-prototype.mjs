#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const GENERATED_DIRECTORIES = ['art', 'demo', 'town'];
const PRIVATE_TRACKS = new Set(['art/music/camelot.mp3', 'art/music/underground.mp3']);

function publicPath(path) {
  return path.split(sep).join('/').toLowerCase();
}

export function isPrivatePrototypePath(path) {
  const normalized = publicPath(path);
  return (
    normalized.includes('synty-') ||
    normalized.includes('/synty/') ||
    normalized.endsWith('/synty') ||
    normalized === 'synty' ||
    normalized.startsWith('synty/') ||
    normalized.includes('sidetrax') ||
    normalized.includes('smallscaleint') ||
    PRIVATE_TRACKS.has(normalized)
  );
}

async function requireDirectory(path) {
  const details = await stat(path).catch(() => undefined);
  if (!details?.isDirectory()) {
    throw new Error(`prototype deploy input is missing: ${path} (run prototypes/studio-v0/tools/build.sh first)`);
  }
}

async function removePrivateFiles(root, directory = root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const deployedPath = relative(root, path);
    if (entry.isSymbolicLink()) {
      throw new Error(`prototype deploy payload contains a symbolic link: ${deployedPath}`);
    } else if (isPrivatePrototypePath(deployedPath)) {
      await rm(path, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await removePrivateFiles(root, path);
    }
  }
}

function wrapIndex(fragment) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><link rel="icon" href="favicon.ico" sizes="48x48"><link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png"><link rel="apple-touch-icon" href="icons/apple-touch-icon.png"><link rel="manifest" href="site.webmanifest"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>
${fragment}
</body></html>
`;
}

async function isolateServiceWorker(destination) {
  const appPath = join(destination, 'app.js');
  const app = await readFile(appPath, 'utf8');
  const scoped = app.replace(
    "navigator.serviceWorker.register('sw.js')",
    "navigator.serviceWorker.register('sw.js', { scope: './' })",
  );
  if (scoped === app) throw new Error('prototype service-worker registration was not found');
  await writeFile(appPath, scoped);

  const workerPath = join(destination, 'sw.js');
  const worker = await readFile(workerPath, 'utf8');
  const isolated = worker
    .replace("CACHE = 'ogm-' + BUILD", "CACHE = 'ogm-proto-' + BUILD")
    .replace("ASSETS = 'ogm-assets'", "ASSETS = 'ogm-proto-assets'")
    .replace(
      'ks.filter(k => k !== CACHE && k !== ASSETS)',
      "ks.filter(k => k.startsWith('ogm-proto-') && k !== CACHE && k !== ASSETS)",
    );
  if (
    !isolated.includes("CACHE = 'ogm-proto-' + BUILD") ||
    !isolated.includes("ASSETS = 'ogm-proto-assets'") ||
    !isolated.includes("k.startsWith('ogm-proto-') && k !== CACHE && k !== ASSETS")
  ) {
    throw new Error('prototype service-worker cache isolation patterns were not found');
  }
  await writeFile(workerPath, isolated);
}

export async function stagePrototype(prototypeDirectory, shellDirectory, destination, { publicOnly = false } = {}) {
  await Promise.all(GENERATED_DIRECTORIES.map((directory) => requireDirectory(join(prototypeDirectory, directory))));
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  const sourceEntries = await readdir(prototypeDirectory, { withFileTypes: true });
  const scripts = sourceEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.js'));
  await Promise.all(
    scripts.map((entry) => cp(join(prototypeDirectory, entry.name), join(destination, entry.name), { force: true })),
  );
  // The app imports these scenes from outside /proto; resolve their art beside the module, not the caller's URL.
  const scenesPath = join(destination, 'scenes.js');
  const scenes = await readFile(scenesPath, 'utf8');
  const scopedScenes = scenes.replace('im.src = src;', 'im.src = new URL(src, import.meta.url).href;');
  if (scopedScenes === scenes) throw new Error('prototype scene asset URL pattern was not found');
  await writeFile(scenesPath, scopedScenes);
  await Promise.all(
    GENERATED_DIRECTORIES.map((directory) =>
      cp(join(prototypeDirectory, directory), join(destination, directory), { recursive: true }),
    ),
  );
  await Promise.all([
    cp(join(shellDirectory, 'favicon.ico'), join(destination, 'favicon.ico')),
    cp(join(shellDirectory, 'icons'), join(destination, 'icons'), { recursive: true }),
    cp(join(shellDirectory, 'site.webmanifest'), join(destination, 'site.webmanifest')),
  ]);

  const fragment = await readFile(join(prototypeDirectory, 'index.html'), 'utf8');
  await writeFile(join(destination, 'index.html'), wrapIndex(fragment));
  if (publicOnly) await removePrivateFiles(destination);
  await isolateServiceWorker(destination);

  const remaining = [];
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if (entry.isSymbolicLink()) {
        throw new Error(`prototype deploy payload contains a symbolic link: ${relative(destination, path)}`);
      } else remaining.push(relative(destination, path));
    }
  }
  await inspect(destination);
  const leaked = publicOnly ? remaining.find(isPrivatePrototypePath) : undefined;
  if (leaked) throw new Error(`private prototype asset remained in deploy payload: ${leaked}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, command, prototypeDirectory, shellDirectory, destination, mode, ...extra] = process.argv;
  if (!prototypeDirectory || !shellDirectory || !destination || extra.length > 0 || (mode && mode !== '--public')) {
    process.stderr.write(`usage: ${basename(command)} <prototype-dir> <shell-dir> <destination> [--public]\n`);
    process.exit(2);
  }
  stagePrototype(resolve(prototypeDirectory), resolve(shellDirectory), resolve(destination), {
    publicOnly: mode === '--public',
  }).catch((error) => {
    process.stderr.write(`deploy: ${error.message}\n`);
    process.exit(1);
  });
}
