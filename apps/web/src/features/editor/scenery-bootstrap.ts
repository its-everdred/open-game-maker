import { sceneryToDesign } from '@gm/sdk/scenery';
import type { DesignDoc } from '@ogm/contracts/browser';
import type { Scenery } from '@ogm/contracts/scenery';

import { coalesceIntents, createEntityIntent, createIntent, type EditorIntent } from './transactions';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

async function sceneryId(id: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)));
  let value = 0n;
  for (const byte of hash.slice(0, 16)) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  for (let i = 0; i < 26; i++) {
    encoded = ALPHABET[Number(value & 31n)]! + encoded;
    value >>= 5n;
  }
  return `e_${encoded}`;
}

/** Persist the checked-in scene as the initial design before accepting edits. */
export async function bootstrapScenery(doc: DesignDoc, scene: Scenery): Promise<EditorIntent | undefined> {
  if ('scenery.settings' in doc.globals) return undefined;
  const ids = new Map(await Promise.all(scene.items.map(async (item) => [item.id, await sceneryId(item.id)] as const)));
  const next = sceneryToDesign(scene, doc, (id) => ids.get(id)!);
  const intents: EditorIntent[] = [];
  let current = doc;
  for (const control of ['scenery.settings', 'scenery.lighting', 'scenery.terrain']) {
    const intent = createIntent(
      current,
      [{ op: 'set', control, targets: 'global', value: next.globals[control] }],
      'Initial scenery',
    );
    intents.push(intent);
    current = intent.doc;
  }
  for (const id of ids.values()) {
    const intent = createEntityIntent(current, next.entities[id]!, 'Initial scenery');
    intents.push(intent);
    current = intent.doc;
  }
  return coalesceIntents(intents, 'Initial scenery');
}
