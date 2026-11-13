import type { GameManifest } from '@ogm/contracts/browser';

import type { GameFrameController, GameFrameState } from './frame';
import type { EditorStage } from './api';

const manifest: GameManifest = {
  id: 'stage-preview',
  sdk: '*',
  title: 'Preview',
  inputs: { actions: {} },
  presentation: { orientation: 'any', minLogical: { w: 640, h: 360 }, fit: 'responsive' },
  view: 'fixed',
  dimension: '2d',
  capabilities: [],
  palette: { categories: [], items: [] },
  tools: ['place'],
  gizmos: {},
  saves: false,
  overrides: { aliases: {}, retired: [] },
};

/** The shell shows reviewed media until a runnable preview or build is available. */
export function mountStagePreview(
  container: HTMLElement,
  stage: EditorStage,
  onState: (state: GameFrameState) => void,
): GameFrameController {
  const media = document.createElement(stage.kind === 'clip' ? 'video' : 'img');
  media.src = stage.url;
  if (media instanceof HTMLVideoElement) {
    media.autoplay = true;
    media.loop = true;
    media.muted = true;
    media.playsInline = true;
    if (stage.poster) media.poster = stage.poster;
  } else {
    media.alt = '';
  }
  Object.assign(media.style, { width: '100%', height: '100%', objectFit: 'contain' });
  container.append(media);
  const state: GameFrameState = {
    bridgeState: 'ready',
    dropped: 0,
    manifest,
    load: { phase: 'ready', loaded: 1, total: 1, done: true },
  };
  onState(state);
  const noop = () => {};
  return {
    state: () => state,
    setMode: noop,
    setSettings: noop,
    applyDesign: noop,
    pick: noop,
    pickAt: async () => [],
    project: async () => null,
    select: noop,
    camera: noop,
    validatePlacement: async () => ({ ok: false, reason: 'This is a preview.' }),
    onPicked: () => noop,
    onScreen: () => noop,
    pause: noop,
    resume: noop,
    restoreSave: noop,
    onSaveLoadError: () => noop,
    sendRoomMessage: noop,
    onSaveWrite: () => noop,
    onEvent: () => noop,
    netInfo: async () => undefined,
    dispose: () => media.remove(),
  };
}
