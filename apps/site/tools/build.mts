import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderSetupHtml } from '../dist/render/html.js';
import { renderSetupMarkdown } from '../dist/render/markdown.js';
import { loadSetupContent } from '../dist/schema.js';

const packageRoot = new URL('../', import.meta.url);
const repositoryRoot = new URL('../../../', import.meta.url);
const sourcePath = fileURLToPath(new URL('content/setup.yaml', packageRoot));
const targetPath = fileURLToPath(new URL('SETUP.md', repositoryRoot));
const content = loadSetupContent(sourcePath, fileURLToPath(repositoryRoot));
const generated = renderSetupMarkdown(content);

if (process.argv.includes('--check')) {
  let current;
  try {
    current = await readFile(targetPath, 'utf8');
  } catch {
    throw new Error('Generated SETUP.md is missing; run pnpm --filter @ogm/site build');
  }

  if (current !== generated) {
    throw new Error('Generated SETUP.md is stale; run pnpm --filter @ogm/site build');
  }
} else {
  await writeFile(targetPath, generated);
}

const distRoot = new URL('dist/', packageRoot);
await mkdir(new URL('setup/', distRoot), { recursive: true });
await writeFile(new URL('setup/index.html', distRoot), renderSetupHtml(content));
await copyFile(new URL('apps/web/src/tokens.css', repositoryRoot), new URL('tokens.css', distRoot));
await copyFile(new URL('src/site.css', packageRoot), new URL('site.css', distRoot));

// Copy static assets and use the factory page at the root; /setup remains generated above.
await cp(new URL('public/', packageRoot), distRoot, { recursive: true });
const logo = await readFile(new URL('public/hero/logo.webp', packageRoot));
const logoVersion = createHash('sha256').update(logo).digest('hex').slice(0, 10);
const factory = await readFile(new URL('factory/index.html', packageRoot), 'utf8');
await writeFile(
  new URL('index.html', distRoot),
  factory.replaceAll('/hero/logo.webp', `/hero/logo.webp?v=${logoVersion}`),
);
