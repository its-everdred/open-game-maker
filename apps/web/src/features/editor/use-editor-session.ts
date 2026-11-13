import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import {
  acquireLease,
  getDesignSnapshot,
  heartbeatLease,
  NO_BUILD_ID,
  postTransaction,
  releaseLease,
  type DesignSnapshot,
  type ScenerySource,
} from './api';
import type { GameFrameController } from './frame';
import { LeaseController } from './lease';
import { bootstrapScenery } from './scenery-bootstrap';
import { createEditorSession, type EditorSessionState } from './session';
import { connectTransactionStream } from './stream';
import { toTransactionBody } from './transactions';

type Adoption = { gameId: string; branch: string; snapshot: DesignSnapshot };
type Options = {
  gameId: string;
  branch: string;
  mode: 'play' | 'edit';
  role?: string;
  activeSnapshot?: DesignSnapshot;
  requestOnlySnapshot?: DesignSnapshot;
  previewOnly?: boolean;
  source?: ScenerySource;
  frameRef: RefObject<GameFrameController | undefined>;
  setAdopted: Dispatch<SetStateAction<Adoption | undefined>>;
};

export function useEditorSession({
  gameId,
  branch,
  mode,
  role,
  activeSnapshot,
  requestOnlySnapshot,
  previewOnly = false,
  source,
  frameRef,
  setAdopted,
}: Options) {
  const [sessionStore, setSessionStore] = useState<StoreApi<EditorSessionState>>();
  const [sessionView, setSessionView] = useState<EditorSessionState>();
  const [editStartup, setEditStartup] = useState<EditorSessionState['saved']>();
  useEffect(() => {
    if (mode === 'edit' && role !== 'peer' && requestOnlySnapshot && gameId !== '') {
      let active = true;
      setEditStartup(undefined);
      void (async () => {
        const intent = source ? await bootstrapScenery(requestOnlySnapshot.doc, source.scene) : undefined;
        if (!active) return;
        const initial = intent ? { ...requestOnlySnapshot, doc: intent.doc } : requestOnlySnapshot;
        if (source) frameRef.current?.applyDesign(initial.rev, initial.doc, []);
        const editor = createSession(gameId, branch, 'preview', 0, initial, frameRef, previewOnly);
        if (!previewOnly) editor.setState({ readOnly: true });
        setSessionStore(editor);
      })().catch(() => {
        if (active) setEditStartup('not-saved');
      });
      return () => {
        active = false;
        setSessionStore(undefined);
      };
    }
    if (
      mode !== 'edit' ||
      role === 'peer' ||
      activeSnapshot === undefined ||
      gameId === '' ||
      (activeSnapshot.buildId === NO_BUILD_ID && source === undefined)
    ) {
      setSessionStore(undefined);
      setEditStartup(undefined);
      return;
    }
    setEditStartup('saving');
    const snapshot = activeSnapshot;
    const sessionId = globalThis.crypto.randomUUID();
    let active = true;
    let stream: ReturnType<typeof connectTransactionStream> | undefined;
    let editor: StoreApi<EditorSessionState> | undefined;
    const lease = new LeaseController({
      api: {
        acquire: () => acquireLease(gameId, branch, sessionId),
        heartbeat: (token) => heartbeatLease(gameId, branch, sessionId, token),
        release: (token) => releaseLease(gameId, branch, sessionId, token),
      },
      onLost: (holder) => {
        if (editor === undefined) {
          if (active) setEditStartup('read-only');
        } else {
          void editor.getState().loseLease(holder);
        }
      },
      onError: () => {
        if (!active) return;
        setEditStartup(editor === undefined ? 'not-saved' : 'retrying');
      },
      onRecovered: () => {
        if (active && editor !== undefined) setEditStartup(undefined);
      },
    });

    void lease
      .start()
      .then(async (result) => {
        if (!active) {
          await lease.stop();
          return;
        }
        if (!result.ok) return;
        let initial = snapshot;
        if (snapshot.buildId === NO_BUILD_ID) {
          initial = await getDesignSnapshot(gameId, branch);
          if (initial.buildId !== NO_BUILD_ID) {
            if (active) setAdopted({ gameId, branch, snapshot: initial });
            return;
          }
          const intent = await bootstrapScenery(initial.doc, source!.scene);
          if (intent) {
            const saved = await postTransaction(
              gameId,
              branch,
              toTransactionBody(intent, {
                baseRev: initial.rev,
                leaseToken: result.lease.token,
                baseBuildId: NO_BUILD_ID,
                sessionId,
              }),
            );
            if (!saved.ok) throw new Error('initial scenery could not be saved');
            initial = { ...initial, rev: saved.rev, doc: intent.doc };
          }
        }
        if (!active) return;
        frameRef.current?.applyDesign(initial.rev, initial.doc, []);
        editor = createSession(gameId, branch, sessionId, result.lease.token, initial, frameRef);
        setSessionStore(editor);
        setEditStartup(undefined);
        stream = connectTransactionStream({
          gameId,
          branch,
          after: initial.rev,
          receive: (transaction) => editor?.getState().receive(transaction),
        });
      })
      .catch(() => {
        if (active) setEditStartup('not-saved');
        void lease.stop();
      });

    return () => {
      active = false;
      stream?.close();
      void lease.stop();
      setSessionStore(undefined);
    };
  }, [activeSnapshot, requestOnlySnapshot, previewOnly, branch, gameId, mode, role, source, frameRef, setAdopted]);

  useEffect(() => {
    if (sessionStore === undefined) {
      setSessionView(undefined);
      return;
    }
    setSessionView(sessionStore.getState());
    return sessionStore.subscribe((state) => setSessionView(state));
  }, [sessionStore]);

  return { sessionStore, sessionView, editStartup };
}

function createSession(
  gameId: string,
  branch: string,
  sessionId: string,
  leaseToken: number,
  snapshot: DesignSnapshot,
  frameRef: RefObject<GameFrameController | undefined>,
  previewOnly = false,
) {
  let previewRev = snapshot.rev;
  return createEditorSession({
    sessionId,
    leaseToken,
    snapshot,
    ephemeral: previewOnly,
    api: {
      postTransaction: (body) =>
        previewOnly ? Promise.resolve({ ok: true as const, rev: ++previewRev }) : postTransaction(gameId, branch, body),
      getSnapshot: () => getDesignSnapshot(gameId, branch),
    },
    applyDesign: (doc, patches, rev) => frameRef.current?.applyDesign(rev, doc, patches),
  });
}
