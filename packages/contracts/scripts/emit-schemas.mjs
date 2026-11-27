import { readdir, readFile, writeFile } from 'node:fs/promises';
import { toJSONSchema } from 'zod';

const dist = new URL('../dist/', import.meta.url);
const schemaDirectory = new URL('../schemas/', import.meta.url);
let emitted = 0;

for (const file of (await readdir(dist)).filter(
  (name) => name.endsWith('.js') && name !== 'index.js' && !name.endsWith('.generated.js'),
)) {
  const module = await import(new URL(file, dist).href);
  const records = Object.entries(module)
    .filter(([name]) => name === 'schemas' || /^[a-z0-9]+Schemas$/.test(name))
    .map(([, record]) => record);
  for (const [stem, schema] of records.flatMap((record) => Object.entries(record))) {
    const jsonSchema = toJSONSchema(schema, {
      target: 'draft-2020-12',
      ...(stem === 'decision-inventory.v1' ? { io: 'input' } : {}),
    });
    if (stem === 'decision-inventory.v1') {
      // Zod's status-dependent refinements are not emitted automatically.
      jsonSchema.items.allOf = [
        {
          if: { required: ['mode'], properties: { mode: { type: 'string' } } },
          else: {
            if: { required: ['status'], properties: { status: { const: 'answered' } } },
            then: { properties: { options: { type: 'array', minItems: 1 } } },
            else: { properties: { options: { type: 'array', minItems: 2 } } },
          },
        },
      ];
    }
    const output = `${JSON.stringify(
      {
        ...jsonSchema,
        $id: `https://open-game-maker-2000.local/schemas/${stem}.json`,
      },
      null,
      2,
    )}\n`;
    const target = new URL(`${stem}.json`, schemaDirectory);
    if (process.argv.includes('--check')) {
      let current;
      try {
        current = await readFile(target, 'utf8');
      } catch {
        throw new Error(`Missing emitted schema: schemas/${stem}.json`);
      }
      if (current !== output) throw new Error(`Emitted schema is stale: schemas/${stem}.json`);
    } else {
      await writeFile(target, output);
    }
    emitted += 1;
  }
}

if (emitted === 0) throw new Error('No contract schema families were emitted');
