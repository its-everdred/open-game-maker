import { readFileSync } from 'node:fs';

import type { ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

import type { AssetCard, MapLayoutSpec } from './card.generated.js';

export type { AssetCard, Clip, Font, Geometry, Image, Look, MapLayoutSpec, Rig } from './card.generated.js';

export const ASSET_CARD_SCHEMAS = ['ogm.asset-card/1.0', 'ogm.asset-card/1.1', 'ogm.asset-card/1.2'] as const;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictTypes: false,
  strictRequired: false,
  allowUnionTypes: true,
});
const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);

function readSchema(relativePath: string): object {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as object;
}

const cardValidator = ajv.compile<AssetCard>(readSchema('../schemas/asset-card.schema.json'));
const layoutValidator = ajv.compile<MapLayoutSpec>(readSchema('../schemas/map-layout-spec.schema.json'));

function errorsFor(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
}

function validate<T>(
  validator: ValidateFunction<T>,
  doc: unknown,
): { ok: true; value: T } | { ok: false; errors: string[] } {
  if (validator(doc)) return { ok: true, value: doc as T };
  return { ok: false, errors: errorsFor(validator.errors) };
}

export function validateCard(doc: unknown): { ok: true; card: AssetCard } | { ok: false; errors: string[] } {
  const result = validate(cardValidator, doc);
  return result.ok ? { ok: true, card: result.value } : result;
}

export function validateLayoutSpec(doc: unknown): { ok: true; spec: MapLayoutSpec } | { ok: false; errors: string[] } {
  const result = validate(layoutValidator, doc);
  return result.ok ? { ok: true, spec: result.value } : result;
}
