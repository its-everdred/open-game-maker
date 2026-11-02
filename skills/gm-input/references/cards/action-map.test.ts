import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const CARD = fileURLToPath(new URL('./action-map.md', import.meta.url));

describe('action-map card', () => {
  it('carries ranges, edge semantics, and a three-statement input test', () => {
    const text = readFileSync(CARD, 'utf8');
    const testBlock = text.match(/## Test\n\n```ts\n([\s\S]*?)\n```/)?.[1] ?? '';

    expect(text).toMatch(/deadzone, range: \[0\.15, 0\.30\]/);
    expect(text).toMatch(/repeatDelayMs, range: \[150, 300\]/);
    expect(text).toContain('justPressed');
    expect(text).toContain('## No obvious extras');
    expect(text).toContain('deadzone: /* pick from the brief range */ 0');
    expect(testBlock.split('\n').filter(Boolean)).toHaveLength(3);
    expect(testBlock).toContain('advanceTime');
  });
});
