#!/usr/bin/env node
// Stage validated copies only. A host operator can review and apply the resulting plan.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateCard } from '@ogm/contracts';
import { structuralImageBounds } from '../dist/structural-bounds.js';
import { structuralCardFacts } from '../dist/structural-card.js';

const [libraryArg, outputArg] = process.argv.slice(2);
if (!libraryArg || !outputArg) throw new Error('Usage: stage-structural-cards <asset-library-root> <empty-output-directory>');
const library = await realpath(libraryArg);
const target = path.resolve(outputArg);
const parent = await realpath(path.dirname(target));
const candidate = path.join(parent, path.basename(target));
const insideLibrary = (value) => value === library || value.startsWith(`${library}${path.sep}`);
if (insideLibrary(candidate)) throw new Error('output must be outside the asset library');
await mkdir(candidate, { recursive: true });
const output = await realpath(candidate);
if (insideLibrary(output)) throw new Error('output must be outside the asset library');
if ((await readdir(output)).length) throw new Error('output directory must be empty');
const plan = [];
for (const id of Object.keys(structuralImageBounds.value)) {
  const match = /^t1:([a-z0-9-]+)\/tiles\/([a-z0-9-]+)\/([a-z0-9-]+)@\d{4}-\d{2}-\d{2}$/.exec(id);
  if (!match) throw new Error(`unexpected measured card id: ${id}`);
  const [, pack, group, slug] = match;
  const relative = `packs/${pack}/cards/tiles/${group}/${slug}.card.json`;
  const source = path.join(library, relative);
  const original = await readFile(source);
  const card = JSON.parse(original.toString('utf8'));
  if (card.id !== id || !card.sprite || card.sprite.structural_facings) throw new Error(`card changed or already has facts: ${id}`);
  card.sprite.structural_facings = structuralCardFacts(id);
  card.provenance['sprite.structural_facings'] = {
    by: 'code', tool: 'smallscaleint-structural-measure@0.1', at: new Date().toISOString(),
    input: 'Source PNG alpha scans and measured fence-grid overlap',
  };
  const result = validateCard(card);
  if (!result.ok) throw new Error(`${id}: ${result.errors.join('; ')}`);
  const staged = `${pack}--${slug}.card.json`;
  await writeFile(path.join(output, staged), `${JSON.stringify(card, null, 2)}\n`, { flag: 'wx' });
  plan.push({ id, source: relative, sha256: createHash('sha256').update(original).digest('hex'), staged });
}
await writeFile(path.join(output, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
console.log(`Staged ${plan.length} validated cards. Verify each source hash before applying.`);
