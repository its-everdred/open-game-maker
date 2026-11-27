import type { TouchIcon } from '@ogm/contracts/input';

/* Line icons in the app's style (apps/web/src/icons.ts): a 256 grid, 16-unit round strokes, drawn in currentColor. */
const line = (body: string) =>
  `<svg viewBox="0 0 256 256" width="100%" height="100%" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;

export const TOUCH_ICON_SVG: Record<TouchIcon, string> = {
  attack: line('<path d="M216 40v40l-96 96-40-40 96-96Z"/><path d="m64 128 64 64M92 164l-52 52"/>'),
  'heavy-attack': line('<path d="M140 116 40 216"/><path d="m137 34 85 85-39 39-85-85Z"/>'),
  block: line('<path d="M128 32 48 64v56c0 56 36 92 80 112 44-20 80-56 80-112V64Z"/>'),
  roll: line('<circle cx="160" cy="128" r="56"/><path d="M160 96a32 32 0 0 1 32 32M32 96h48M16 128h56M32 160h48"/>'),
  use: line(
    '<path d="M88 136V64a16 16 0 0 1 32 0v56V48a16 16 0 0 1 32 0v72V64a16 16 0 0 1 32 0v88c0 44-28 80-72 80-28 0-48-12-64-40l-28-48a16 16 0 0 1 28-16l24 32"/>',
  ),
  cast: line('<path d="M128 32 148 108 224 128 148 148 128 224 108 148 32 128 108 108Z"/>'),
  potion: line(
    '<path d="M96 32h64M112 32v56l-52 88a32 32 0 0 0 28 48h80a32 32 0 0 0 28-48l-52-88V32"/><path d="M76 152h104"/>',
  ),
  map: line('<path d="m32 64 64-24 64 24 64-24v152l-64 24-64-24-64 24Z"/><path d="M96 40v152M160 64v152"/>'),
  inventory: line(
    '<rect x="48" y="80" width="160" height="136" rx="16"/><path d="M96 80V64a32 32 0 0 1 64 0v16M48 136h160M112 136v24h32v-24"/>',
  ),
  jump: line('<path d="M128 184V48M72 104l56-56 56 56M64 216h128"/>'),
  confirm: line('<path d="m48 136 48 48L208 72"/>'),
  back: line('<path d="m64 64 128 128M192 64 64 192"/>'),
  'rotate-cw': line('<path d="M192 72v48h-48M190 118a72 72 0 1 0 4 72"/>'),
  'rotate-ccw': line('<path d="M64 72v48h48M66 118a72 72 0 1 1-4 72"/>'),
  down: line('<path d="M128 48v152M72 144l56 56 56-56"/>'),
  'hard-drop': line('<path d="M128 40v136M72 120l56 56 56-56M56 216h144"/>'),
  left: line('<path d="M208 128H48M104 72l-56 56 56 56"/>'),
  right: line('<path d="M48 128h160M152 72l56 56-56 56"/>'),
  swap: line('<path d="m176 48 32 32-32 32M48 80h160M80 144l-32 32 32 32M208 176H48"/>'),
  pause: line('<path d="M96 64v128M160 64v128"/>'),
  action: line('<circle cx="128" cy="128" r="48"/>'),
};

/** First match wins, so the narrower words (counter-clockwise, hard drop, heavy attack) come before the broader ones. */
const BY_NAME: [RegExp, TouchIcon][] = [
  [/\bccw\b|counter ?clockwise|anti ?clockwise/u, 'rotate-ccw'],
  [/rotate|\bturn\b|\bcw\b|\bspin\b/u, 'rotate-cw'],
  [/hard drop|slam/u, 'hard-drop'],
  [/heavy|charge|smash|power/u, 'heavy-attack'],
  [/attack|strike|slash|melee|\bhit\b|punch|sword/u, 'attack'],
  [/fire|shoot|cast|spell|magic|special/u, 'cast'],
  [/block|guard|shield|parry|defend/u, 'block'],
  [/roll|dodge|dash|evade/u, 'roll'],
  [/potion|heal|drink/u, 'potion'],
  [/\bmap\b/u, 'map'],
  [/inventory|\bbag\b|items/u, 'inventory'],
  [/\buse\b|interact|talk|grab|pick|open|take/u, 'use'],
  [/confirm|accept|\bok\b|select|start/u, 'confirm'],
  [/back|cancel|close|exit|return/u, 'back'],
  [/pause|menu/u, 'pause'],
  [/hold|swap|switch/u, 'swap'],
  [/drop|down|crouch/u, 'down'],
  [/jump|\bup\b/u, 'jump'],
  [/\bleft\b/u, 'left'],
  [/\bright\b/u, 'right'],
];

/** The icon an undeclared button gets from its action's spoken words; `action` when nothing matches, never a letter. */
export function iconForWords(words: string): TouchIcon {
  const lower = words.toLowerCase();
  return BY_NAME.find(([pattern]) => pattern.test(lower))?.[1] ?? 'action';
}
