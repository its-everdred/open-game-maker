import { describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import type { GameManifest } from '@ogm/contracts/browser';

import type { GameFrameController } from './frame';
import { changeInstanceCount } from './instanceCount';
import type { EditorSessionState } from './session';

const skeleton = 'e_01BX5ZZKBKACTAV9WEVGEMMVRZ';
const manifest = {
  view: 'iso',
  grid: { size: 2, units: 'm' },
} as GameManifest;

function harness(result: { ok: true } | { ok: false; reason: string }) {
  const submit = vi.fn().mockResolvedValue(undefined);
  const state = {
    readOnly: false,
    submit,
    doc: {
      schemaVersion: 1,
      globals: {},
      entities: {
        [skeleton]: {
          id: skeleton,
          prefab: 'skeleton',
          level: 'crypt',
          origin: 'creator',
          props: { pose: { position: [3, 0, 4] } },
        },
      },
    },
  } as unknown as EditorSessionState;
  const frame = {
    validatePlacement: vi.fn().mockResolvedValue(result),
  } as unknown as GameFrameController;
  const session = { getState: () => state } as StoreApi<EditorSessionState>;
  return { frame, session, submit };
}

describe('instance count controls', () => {
  it('places an adjacent item relative to a legacy 2D entity', async () => {
    const test = harness({ ok: true });
    test.session.getState().doc.entities[skeleton]!.props = { x: 400, y: 320 };
    await changeInstanceCount(
      { direction: 1, prefab: 'skeleton', targetIds: [skeleton] },
      manifest,
      test.frame,
      test.session,
    );
    expect(test.frame.validatePlacement).toHaveBeenCalledWith('skeleton', { position: [402, 320, 0] }, 3_000);
  });
  it('validates an adjacent placement before posting an entity transaction', async () => {
    const test = harness({ ok: true });

    await expect(
      changeInstanceCount(
        { direction: 1, prefab: 'skeleton', targetIds: [skeleton] },
        manifest,
        test.frame,
        test.session,
      ),
    ).resolves.toEqual({ ok: true });

    expect(test.frame.validatePlacement).toHaveBeenCalledWith('skeleton', { position: [5, 0, 4] }, 3_000);
    expect(test.submit).toHaveBeenCalledWith(expect.objectContaining({ label: 'Added skeleton' }));
  });

  it('shows placement rejection without posting a transaction', async () => {
    const test = harness({ ok: false, reason: 'That tile is blocked.' });

    await expect(
      changeInstanceCount(
        { direction: 1, prefab: 'skeleton', targetIds: [skeleton] },
        manifest,
        test.frame,
        test.session,
      ),
    ).resolves.toEqual({ ok: false, reason: 'That tile is blocked.' });
    expect(test.submit).not.toHaveBeenCalled();
  });
});
