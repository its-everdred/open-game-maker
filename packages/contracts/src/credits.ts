import { z } from 'zod';

import type { AssetsLock } from './assets.js';

const webUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:/.test(value), 'source URL must use http or https');

export const creditSourceSchema = z.strictObject({
  label: z.string().trim().min(1),
  url: webUrlSchema.optional(),
});
export type CreditSource = z.infer<typeof creditSourceSchema>;

/** Normalized legal provenance copied onto every asset lock entry. */
export const assetCreditSchema = z.strictObject({
  pack: z.string().trim().min(1),
  title: z.string().trim().min(1),
  licenseSource: z.string().trim().min(1),
  attribution: z.string().trim().min(1),
  source: creditSourceSchema,
});
export type AssetCredit = z.infer<typeof assetCreditSchema>;

export const creditPackSchema = assetCreditSchema.extend({
  license: z.string().trim().min(1),
  private: z.boolean(),
});
export type CreditPack = z.infer<typeof creditPackSchema>;

export const creditsDocumentSchema = z.strictObject({
  version: z.literal(1),
  packs: z.array(creditPackSchema),
});
export type CreditsDocument = z.infer<typeof creditsDocumentSchema>;

/** Merge credit documents into one deterministic row per pack, refusing inconsistent metadata. */
export function mergeCreditsDocuments(documents: readonly CreditsDocument[]): CreditsDocument {
  const packs = new Map<string, CreditPack>();
  for (const pack of documents.flatMap((document) => document.packs)) {
    const previous = packs.get(pack.pack);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(pack)) {
      throw new Error(`asset pack ${pack.pack} has inconsistent credit metadata`);
    }
    packs.set(pack.pack, pack);
  }
  return {
    version: 1,
    packs: [...packs.values()].sort(
      (left, right) => left.license.localeCompare(right.license) || left.title.localeCompare(right.title),
    ),
  };
}

/** Collapse a lock to one deterministic row per pack, refusing inconsistent metadata. */
export function creditsFromLock(lock: Pick<AssetsLock, 'assets'>): CreditsDocument {
  return mergeCreditsDocuments([
    {
      version: 1,
      packs: lock.assets.map((entry) => {
        if (entry.credit === undefined) throw new Error('asset lock entry is missing credit metadata');
        return creditPackSchema.parse({
          ...entry.credit,
          license: entry.license,
          private: entry.rights.audience === 'private',
        });
      }),
    },
  ]);
}

/** Markdown checked into game repos and refreshed from the lock on every build. */
export function renderCredits(lock: Pick<AssetsLock, 'assets'>): string {
  const markdownText = (value: string): string =>
    [...value]
      .map((character) => {
        const code = character.codePointAt(0)!;
        return code <= 0x1f ||
          (code >= 0x7f && code <= 0x9f) ||
          code === 0x061c ||
          code === 0x200e ||
          code === 0x200f ||
          (code >= 0x202a && code <= 0x202e) ||
          (code >= 0x2066 && code <= 0x2069)
          ? '?'
          : character;
      })
      .join('')
      .replace(/[\\`*_[\]<>]/g, '\\$&');
  const generatedByPack = new Map<string, Set<string>>();
  for (const entry of lock.assets) {
    if (entry.credit === undefined || entry.meta?.generation?.method !== 'ai') continue;
    const tools = generatedByPack.get(entry.credit.pack) ?? new Set<string>();
    tools.add(entry.meta.generation.tool);
    generatedByPack.set(entry.credit.pack, tools);
  }
  const byLicense = new Map<string, CreditPack[]>();
  for (const pack of creditsFromLock(lock).packs) {
    const group = byLicense.get(pack.license) ?? [];
    group.push(pack);
    byLicense.set(pack.license, group);
  }

  const sections = [...byLicense]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, packs]) => {
      const lines = packs.map((pack) => {
        const tools = generatedByPack.get(pack.pack);
        const marker = tools ? ` [AI-generated: ${[...tools].sort().map(markdownText).join(', ')}]` : '';
        return `- ${pack.title} — ${pack.attribution} (licence: ${markdownText(pack.licenseSource)})${marker}`;
      });
      if (license === 'CC0-1.0') lines.unshift(`- CC0 assets from: ${packs.map((pack) => pack.pack).join(', ')}`);
      return `## ${license}\n${lines.join('\n')}`;
    });
  return `# Credits\n${sections.length === 0 ? '' : `\n${sections.join('\n\n')}\n`}`;
}
