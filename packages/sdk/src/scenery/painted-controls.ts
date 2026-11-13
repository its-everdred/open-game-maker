import type { ControlDecl } from '@ogm/contracts';

/** Instance controls shared by painted-scene manifests and the editor preview. */
export const paintedSceneryControls: ControlDecl[] = [
  {
    id: 'scenery.depth',
    label: 'Depth',
    scope: 'instance',
    path: '/props/scenery.depth',
    widget: { kind: 'slider', min: -1000, max: 1000, step: 1 },
    default: 0,
  },
  {
    id: 'scenery.parallax',
    label: 'Parallax',
    scope: 'instance',
    path: '/props/scenery.parallax',
    widget: { kind: 'slider', min: 0, max: 2, step: 0.05 },
    default: 1,
  },
];
