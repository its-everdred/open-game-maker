import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import process from 'node:process';
import { format, resolveConfig } from 'prettier';

const source = new URL('../../../docs/design/ogm-glass/tokens.json', import.meta.url);
const destination = new URL('../src/glass-tokens.css', import.meta.url);
const tokens = JSON.parse(await readFile(source, 'utf8'));
const properties = [];
const accentProperties = [];
const sliderProperties = [];
function emit(name, value) {
  const target = String(value).includes('var(--ogm-action-color)')
    ? accentProperties
    : String(value).includes('var(--ogm-slider-fill)')
      ? sliderProperties
      : properties;
  target.push(`  --ogm-${name}: ${value};`);
}
for (const [group, entries] of Object.entries(tokens.color)) {
  for (const [name, token] of Object.entries(entries)) {
    if (Array.isArray(token.$value)) token.$value.forEach((value, i) => emit(`${group}-${name}-${i + 1}`, value));
    else emit(`${group}-${name}`, token.$value);
  }
}
for (const name of ['fill', 'fill-strong', 'blur', 'edge', 'gloss']) emit(`glass-${name}`, tokens.glass[name].$value);
for (const [name, value] of Object.entries(tokens.component)) emit(`component-${name}`, value);
for (const [name, value] of Object.entries(tokens.radius)) emit(`radius-${name}`, value);
for (const [name, value] of Object.entries(tokens.size.orb)) emit(`orb-${name}`, value);
for (const [name, value] of Object.entries(tokens.size.pill)) emit(`pill-${name}`, value);
tokens.space.forEach((value, i) => emit(`space-${i + 1}`, value));
emit('font-display', `'${tokens.type.display.family}', sans-serif`);
emit('font-body', `'${tokens.type.body.family}', sans-serif`);
for (const name of ['ease', 'spring']) {
  emit(`motion-${name}`, tokens.motion[name].$value);
  emit(`motion-${name}-duration`, tokens.motion[name].duration);
}
const output = await format(
  `/* Generated from docs/design/ogm-glass/tokens.json. Do not edit. */\n:root {\n${properties.join('\n')}\n}\n` +
    `:is(.ogm-tone-go, .ogm-tone-create, .ogm-tone-warn, .ogm-tone-info, .ogm-tone-danger, .ogm-tone-live, .ogm-tone-glassy, .ogm-accent-go, .ogm-accent-create, .ogm-accent-warn, .ogm-accent-info, .ogm-accent-danger, .ogm-accent-live) {\n${accentProperties.join('\n')}\n}\n` +
    `.ogm-glass-slider {\n${sliderProperties.join('\n')}\n}\n`,
  { ...(await resolveConfig(fileURLToPath(destination))), parser: 'css' },
);
if (process.argv.includes('--check')) {
  if ((await readFile(destination, 'utf8').catch(() => '')) !== output) {
    console.error(`${fileURLToPath(destination)} is stale; run node apps/web/tools/generate-glass-tokens.mjs`);
    process.exitCode = 1;
  }
} else await writeFile(destination, output);
