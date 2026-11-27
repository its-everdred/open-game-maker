// Convert the design agent's approved JPEG exports without resizing or recolouring.
// Usage: node apps/web/tools/import-glass-exports.mjs <export-directory>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import process from 'node:process';
import sharp from 'sharp';

const names = [
  'Main',
  'Components',
  'Title',
  'SignIn',
  'Join',
  'Account',
  'Home',
  'GameSheet',
  'NewGame',
  'NewGameChat',
  'PlayView',
  'PauseMenu',
  'Editor',
  'EditMenu',
  'AgentChat',
  'VoiceLive',
  'BugReport',
  'Review',
  'Activity',
  'TicketChat',
  'BuildOrder',
  'Settings',
  'Resources',
  'LimitReached',
  'Publish',
  'Admin',
  'AdminInvite',
  'HomeDesktop',
  'HomeLandscape',
  'EditorDesktop',
  'EditorLandscape',
  'PauseLandscape',
  'BuildOrderDesktop',
];
const source = process.argv[2];
if (!source) throw new Error('Provide the directory containing the approved artboard exports');
const destination = resolve('tests/design-baselines/ogm-glass');
await mkdir(destination, { recursive: true });
const manifest = [];
for (const name of names) {
  const input = await readFile(join(source, `${name}.jpg`));
  const image = sharp(input);
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error(`Missing dimensions for ${name}`);
  const file = `${name}-${width}x${height}.png`;
  await writeFile(join(destination, file), await image.png().toBuffer());
  manifest.push({
    artboard: name,
    file,
    width,
    height,
    sourceSha256: createHash('sha256').update(input).digest('hex'),
  });
}
await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
