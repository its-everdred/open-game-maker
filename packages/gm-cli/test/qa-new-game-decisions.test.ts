import { describe, expect, it, vi } from 'vitest';

import { decisionInventoryFailure, readNewGameDecisionInventory } from '../src/qa-new-game-decisions.js';

function inventory(size = 15, asked = 5, areas = 5) {
  return Array.from({ length: size }, (_, index) => ({
    id: `decision-${index}`,
    area: `Area ${index % areas}`,
    question: `Which sample ${index}?`,
    why: 'This changes what the creator sees and plays.',
    options: [
      { label: 'Forest', media: 'media/forest.png' },
      { label: 'Coast', media: 'media/coast.png' },
    ],
    recommendation: 'Forest: it matches the agreed direction.',
    sources: ['Summarized creation choices'],
    ticket: null,
    status: index < asked ? 'asked' : 'open',
    answer: null,
    answered_at: null,
  }));
}

describe('New Game decision inventory QA', () => {
  it('requires a substantial inventory, broad coverage, and five raised media-backed decisions', () => {
    expect(decisionInventoryFailure(inventory())).toBeNull();
    expect(decisionInventoryFailure(inventory(14))).toContain('fewer than 15');
    expect(decisionInventoryFailure(inventory(15, 5, 4))).toContain('fewer than five areas');
    expect(decisionInventoryFailure(inventory(15, 4))).toContain('not raised five');
  });

  it('rejects engineering choices from the creator inventory', () => {
    const decisions = inventory();
    decisions[0]!.question = 'Which game engine should the builder use?';
    expect(decisionInventoryFailure(decisions)).toContain('engineering-level choice');
  });

  it('reads and validates the inventory from the created game branch', async () => {
    const value = inventory();
    const request = vi.fn(async (_method: string, path: string) => {
      expect(path).toBe('/repos/example/games/contents/docs/qa/decisions.json?ref=game%2Fqa');
      return { encoding: 'base64', content: Buffer.from(JSON.stringify(value)).toString('base64') };
    });

    await expect(readNewGameDecisionInventory('example/games', 'qa', request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledOnce();
  });

  it('fails closed when the inventory file is absent', async () => {
    const request = vi.fn(async () => ({ encoding: 'base64', content: '' }));
    await expect(readNewGameDecisionInventory('example/games', 'qa', request)).rejects.toThrow(
      'New Game decision inventory is missing',
    );
  });
});
