import type { DesignDoc, Patch, Transaction } from '@ogm/contracts/browser';
import { apply } from '@ogm/design-log/browser';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { DesignSnapshot, TransactionBody, TransactionPostResult } from './api';
import {
  coalesceIntents,
  replayIntent,
  toTransactionBody,
  type EditorIntent,
  type TransactionContext,
} from './transactions';

export type SavedState = 'saved' | 'saving' | 'retrying' | 'not-saved' | 'read-only';

export type EditorSessionState = {
  doc: DesignDoc;
  headRev: number;
  buildId: string;
  saved: SavedState;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selection: string[];
  tool: string;
  error?: string;
  submit(intent: EditorIntent): Promise<void>;
  commitStroke(intents: readonly EditorIntent[], label: string): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  receive(transaction: Transaction): void;
  loseLease(holder?: string): Promise<void>;
  setSelection(ids: readonly string[]): void;
  setTool(tool: string): void;
};

type SessionApi = {
  postTransaction(body: TransactionBody): Promise<TransactionPostResult>;
  getSnapshot(): Promise<DesignSnapshot>;
};

export type EditorSessionOptions = {
  sessionId: string;
  leaseToken: number;
  snapshot: DesignSnapshot;
  ephemeral?: boolean;
  api: SessionApi;
  applyDesign?(doc: DesignDoc, patches: readonly Patch[], rev: number): void;
  retryDelayMs?: number;
  maxTransportRetries?: number;
  sleep?(milliseconds: number): Promise<void>;
};

type HistoryMode = { kind: 'normal' } | { kind: 'undo'; entry: EditorIntent } | { kind: 'redo'; entry: EditorIntent };

export function createEditorSession(options: EditorSessionOptions): StoreApi<EditorSessionState> {
  let history: EditorIntent[] = [];
  let redoHistory: EditorIntent[] = [];
  let pending: EditorIntent | undefined;
  let writeQueue = Promise.resolve();
  const sleep =
    options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const store = createStore<EditorSessionState>((set, get) => ({
    doc: options.snapshot.doc,
    headRev: options.snapshot.rev,
    buildId: options.snapshot.buildId,
    saved: options.ephemeral ? 'not-saved' : 'saved',
    readOnly: false,
    canUndo: false,
    canRedo: false,
    selection: [],
    tool: 'select',
    submit: (intent) => enqueue(() => persist(intent, { kind: 'normal' })),
    commitStroke: (intents, label) => enqueue(() => persist(coalesceIntents(intents, label), { kind: 'normal' })),
    undo: () =>
      enqueue(async () => {
        const entry = history.at(-1);
        if (entry === undefined || get().readOnly) return;
        await persist(inverseIntent(entry, get().doc), { kind: 'undo', entry });
      }),
    redo: () =>
      enqueue(async () => {
        const entry = redoHistory.at(-1);
        if (entry === undefined || get().readOnly) return;
        await persist(replayIntent(entry, get().doc), { kind: 'redo', entry });
      }),
    receive: (transaction) => {
      const state = get();
      if (transaction.rev <= state.headRev) return;
      if (transaction.rev !== state.headRev + 1) {
        set({ saved: 'not-saved', error: 'Design updates arrived out of order' });
        return;
      }
      if (pending !== undefined && samePatches(transaction.patches, pending.patches)) {
        set({ headRev: transaction.rev });
        return;
      }
      const doc = apply(state.doc, transaction.patches);
      set({ doc, headRev: transaction.rev });
      options.applyDesign?.(doc, transaction.patches, transaction.rev);
    },
    loseLease: async (holder) => becomeReadOnly(holder),
    setSelection: (ids) => set({ selection: [...ids] }),
    setTool: (tool) => set({ tool }),
  }));

  function enqueue(work: () => Promise<void>): Promise<void> {
    const next = writeQueue.then(work, work);
    writeQueue = next.catch(() => undefined);
    return next;
  }

  async function persist(initialIntent: EditorIntent, mode: HistoryMode): Promise<void> {
    if (store.getState().readOnly) return;
    let intent = initialIntent;
    let baseRev = store.getState().headRev;
    let conflictRetried = false;
    let transportRetries = 0;
    pending = intent;
    applyOptimistic(intent);

    for (;;) {
      const context: TransactionContext = {
        baseRev,
        leaseToken: options.leaseToken,
        baseBuildId: store.getState().buildId,
        sessionId: options.sessionId,
      };
      const body = toTransactionBody(intent, context);
      const result = await options.api.postTransaction(body);
      if (result.ok) {
        pending = undefined;
        recordSuccess(intent, mode);
        store.setState({ headRev: result.rev, saved: options.ephemeral ? 'not-saved' : 'saved', error: undefined });
        options.applyDesign?.(store.getState().doc, [], result.rev);
        return;
      }
      if (result.kind === 'conflict' && !conflictRetried) {
        conflictRetried = true;
        let snapshot: DesignSnapshot;
        try {
          snapshot = await options.api.getSnapshot();
        } catch (error) {
          pending = undefined;
          store.setState({
            saved: 'not-saved',
            error: error instanceof Error ? error.message : 'Could not refresh the design',
          });
          return;
        }
        intent = replayIntent(initialIntent, snapshot.doc);
        pending = intent;
        baseRev = snapshot.rev;
        store.setState({ doc: intent.doc, headRev: snapshot.rev, buildId: snapshot.buildId, saved: 'saving' });
        options.applyDesign?.(intent.doc, intent.patches, snapshot.rev);
        continue;
      }
      if (result.kind === 'lease-lost') {
        pending = undefined;
        await becomeReadOnly(result.holder);
        return;
      }
      if (result.kind === 'retryable' && transportRetries < (options.maxTransportRetries ?? 2)) {
        transportRetries += 1;
        store.setState({ saved: 'retrying', error: result.message });
        await sleep(options.retryDelayMs ?? 500 * 2 ** (transportRetries - 1));
        if (store.getState().readOnly) return;
        continue;
      }
      pending = undefined;
      const message =
        result.kind === 'invalid' ? result.reason : result.kind === 'failure' ? result.message : 'Conflict';
      store.setState({ saved: 'not-saved', error: message });
      return;
    }
  }

  function applyOptimistic(intent: EditorIntent): void {
    store.setState({ doc: intent.doc, saved: 'saving', error: undefined });
    options.applyDesign?.(intent.doc, intent.patches, store.getState().headRev);
  }

  function recordSuccess(intent: EditorIntent, mode: HistoryMode): void {
    if (mode.kind === 'normal') {
      history = [...history, intent];
      redoHistory = [];
    } else if (mode.kind === 'undo') {
      history = history.slice(0, -1);
      redoHistory = [...redoHistory, mode.entry];
    } else {
      redoHistory = redoHistory.slice(0, -1);
      history = [...history, intent];
    }
    store.setState({ canUndo: history.length > 0, canRedo: redoHistory.length > 0 });
  }

  async function becomeReadOnly(holder?: string): Promise<void> {
    history = [];
    redoHistory = [];
    pending = undefined;
    try {
      const snapshot = await options.api.getSnapshot();
      store.setState({
        doc: snapshot.doc,
        headRev: snapshot.rev,
        buildId: snapshot.buildId,
        saved: 'read-only',
        readOnly: true,
        canUndo: false,
        canRedo: false,
        error: holder ? `Editing moved to ${holder}` : 'The edit lease was lost',
      });
      options.applyDesign?.(snapshot.doc, [], snapshot.rev);
    } catch {
      store.setState({
        saved: 'read-only',
        readOnly: true,
        canUndo: false,
        canRedo: false,
        error: 'The edit lease was lost',
      });
    }
  }

  return store;
}

function inverseIntent(intent: EditorIntent, doc: DesignDoc): EditorIntent {
  return {
    label: `Undo ${intent.label}`,
    commands: [],
    patches: intent.inverse,
    inverse: intent.patches,
    doc: apply(doc, intent.inverse),
  };
}

function samePatches(left: readonly Patch[], right: readonly Patch[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
