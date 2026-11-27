import { packOf, setFor, type CardIndex, type ResolvedCard } from '@ogm/asset-cards';
import { printJson } from '../context.js';
import type { GmContext } from '../command.js';

/** Escape terminal control and formatting characters in untrusted card text. */
export function terminalText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`);
}

/** Keep structured JSON values intact while escaping terminal controls on the wire. */
export function printSafeJson(ctx: GmContext, value: object): void {
  printJson(
    {
      ...ctx,
      out: (line) =>
        ctx.out(
          line.replace(/[\p{Cc}\p{Cf}]/gu, (character) =>
            character
              .split('')
              .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
              .join(''),
          ),
        ),
    },
    value,
  );
}

export type PackFilters = { camera?: string; setting?: string; style?: string };

export function discoverPacks(index: CardIndex, filters: PackFilters): ResolvedCard[] {
  return Object.values(index.collections)
    .filter((card) => {
      const pack = packOf(card.id);
      if (
        !pack ||
        !/^(?:assets-local\/)?packs\//.test(card.collection_info?.pack_manifest ?? '') ||
        card.status === 'quarantined' ||
        card.status === 'rejected' ||
        !card.resolved.rights.uses.includes('in-game')
      )
        return false;
      const style = filters.style;
      return (
        (!filters.camera || card.cameras?.includes(filters.camera as NonNullable<typeof card.cameras>[number])) &&
        (!filters.setting || card.settings?.includes(filters.setting as NonNullable<typeof card.settings>[number])) &&
        (!style ||
          card.style_family === style ||
          card.describe?.set === style ||
          setFor(pack)?.id === style ||
          (style === 'smallscaleint-isometric' && setFor(pack)?.id === 'smallscaleint'))
      );
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
