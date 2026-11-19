import { describe, expect, it, vi } from 'vitest';
import { cleanupQaGame } from '../src/qa-new-game-cleanup.js';

describe('QA game cleanup ordering', () => {
  it('never deletes the row if remote folder cleanup fails', async () => {
    const report = {
      game: { id: 'g_123', slug: 'qa', path: 'games/qa', repoUrl: 'https://github.com/example/games' },
      daemon: null,
      tickets: [{ jobId: 'j_123', key: 'new-game', repo: 'example/games', issue: 7 }],
      sessions: [],
      jobs: [{ id: 'j_123', kind: 'new_game', state: 'cancelled', releasedAt: 'now', repo: 'example/games', issue: 7 }],
    };
    const services = {
      report: vi.fn(async () => report),
      checkOwnership: vi.fn(),
      readyToDelete: vi.fn(),
      cancel: vi.fn(),
      unitStopped: vi.fn(async () => true),
      checkTickets: vi.fn(),
      closeParent: vi.fn(),
      closeScopeIssue: vi.fn(),
      closeCreationPull: vi.fn(),
      closeScopePulls: vi.fn(),
      noOpenIssues: vi.fn(),
      removeFolder: vi.fn(async () => {
        throw new Error('merge refused');
      }),
      deleteGame: vi.fn(),
      gameExists: vi.fn(async () => false),
      sleep: vi.fn(),
    };
    await expect(cleanupQaGame('g_123', 'example/games', services)).rejects.toThrow('merge refused');
    expect(services.deleteGame).not.toHaveBeenCalled();
    expect(services.closeParent).toHaveBeenCalledWith('j_123', 'g_123', 7);
  });

  it('verifies stopped work and external cleanup before deleting and rechecking the row', async () => {
    const report = {
      game: { id: 'g_123', slug: 'qa', path: 'games/qa', repoUrl: 'https://github.com/example/games' },
      daemon: { status: 'stopped', repo: 'example/games' },
      tickets: [{ jobId: 'j_123', key: 'new-game', repo: 'example/games', issue: 7 }],
      sessions: [],
      jobs: [{ id: 'j_123', kind: 'new_game', state: 'cancelled', releasedAt: 'now', repo: 'example/games', issue: 7 }],
    };
    const calls: string[] = [];
    const services = {
      report: vi.fn(async () => report),
      checkOwnership: vi.fn(),
      readyToDelete: vi.fn(),
      cancel: vi.fn(),
      unitStopped: vi.fn(async () => true),
      checkTickets: vi.fn(async () => {
        calls.push('tickets');
      }),
      closeParent: vi.fn(async () => {
        calls.push('parent');
      }),
      closeScopeIssue: vi.fn(),
      closeCreationPull: vi.fn(async () => {
        calls.push('creation');
      }),
      closeScopePulls: vi.fn(async () => {
        calls.push('pulls');
      }),
      noOpenIssues: vi.fn(async () => {
        calls.push('issues');
      }),
      removeFolder: vi.fn(async () => {
        calls.push('folder');
      }),
      deleteGame: vi.fn(async () => {
        calls.push('row');
      }),
      gameExists: vi.fn(async () => {
        calls.push('verify');
        return false;
      }),
      sleep: vi.fn(),
    };
    await cleanupQaGame('g_123', 'example/games', services);
    expect(calls).toEqual([
      'tickets',
      'parent',
      'issues',
      'creation',
      'pulls',
      'folder',
      'issues',
      'tickets',
      'row',
      'verify',
    ]);
    expect(services.deleteGame).toHaveBeenCalledWith('g_123', 'games/qa', ['j_123'], report.tickets, report.sessions);
  });
});
