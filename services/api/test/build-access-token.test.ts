import { describe, expect, it } from 'vitest';
import { signBuildAccess, verifyBuildAccess } from '../src/games/build-access-token.js';

describe('build access capability', () => {
  it('binds the game and user, expires, and rejects tampering', () => {
    const claims = { gameId: 'g', userId: 'u', familyId: 'f', sessionId: 's' };
    const token = signBuildAccess(claims, 'secret', 0);
    expect(verifyBuildAccess(token, 'secret', 1)).toMatchObject(claims);
    expect(verifyBuildAccess(token, 'secret', 86_400_000)).toBeNull();
    expect(verifyBuildAccess(token, 'other', 1)).toBeNull();
    expect(verifyBuildAccess(`${token}x`, 'secret', 1)).toBeNull();
  });
});
