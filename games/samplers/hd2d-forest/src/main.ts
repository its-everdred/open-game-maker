import Phaser from 'phaser';

import { PRESET_IDS, type PresetId } from './presets.js';
import { Forest, type ForestOptions, type Quality } from './scene.js';

const params = new URLSearchParams(location.search);
const preset = params.get('preset');
const options: ForestOptions = {
  preset: PRESET_IDS.includes(preset as PresetId) ? (preset as PresetId) : 'amber',
  lighting: params.get('lighting') !== '0',
  focus: params.get('focus') !== '0',
  particles: params.get('particles') !== '0',
  quality: (params.get('quality') === 'low' ? 'low' : 'high') satisfies Quality,
  weather: params.get('weather') ?? 'clear',
};

const scene = new Forest(options);
const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: document.body,
  backgroundColor: '#1d2a1c',
  pixelArt: true,
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.RESIZE, width: innerWidth, height: innerHeight },
  scene,
});

const SWATCH: Record<PresetId, { color: string; label: string }> = {
  golden: { color: '#f2b941', label: 'Golden shafts' },
  daylight: { color: '#cfe3a8', label: 'Soft daylight' },
  amber: { color: '#e07a2c', label: 'Amber canopy' },
};

const ICON = {
  lighting:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  focus:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M21 12h-6M12 21v-6M3 12h6"/></svg>',
  particles: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M5 19l8-8"/></svg>',
};

const bar = document.createElement('nav');
bar.className = 'bar';
document.body.append(bar);

function button(label: string, html: string, pressed: boolean, onPress: (button: HTMLButtonElement) => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.innerHTML = html;
  element.setAttribute('aria-label', label);
  element.setAttribute('aria-pressed', String(pressed));
  element.addEventListener('click', () => onPress(element));
  bar.append(element);
  return element;
}

const swatches = PRESET_IDS.map((id) =>
  button(
    SWATCH[id].label,
    `<span class="swatch" style="background:${SWATCH[id].color}"></span>`,
    id === options.preset,
    () => {
      scene.setPreset(id);
      swatches.forEach((swatch, index) => swatch.setAttribute('aria-pressed', String(PRESET_IDS[index] === id)));
    },
  ),
);
const lightingButton = button('Lighting', ICON.lighting, options.lighting, (element) => {
  scene.setLighting(!options.lighting);
  element.setAttribute('aria-pressed', String(options.lighting));
});
const focusButton = button('Focus', ICON.focus, options.focus, (element) => {
  scene.setFocus(!options.focus);
  element.setAttribute('aria-pressed', String(options.focus));
});
const particlesButton = button('Particles', ICON.particles, options.particles, (element) => {
  scene.setParticles(!options.particles);
  element.setAttribute('aria-pressed', String(options.particles));
});

declare global {
  interface Window {
    __forest?: {
      ready: boolean;
      options: ForestOptions;
      fps(): number;
      particles(): number;
      litSprites(): number;
      bandBlur(): number[];
      setPreset(id: PresetId): void;
      setLighting(on: boolean): void;
      setFocus(on: boolean): void;
      setParticles(on: boolean): void;
      setWeather(weather: string): void;
    };
  }
}

void scene.ready.then(() => {
  window.__forest = {
    ready: true,
    options,
    fps: () => game.loop.actualFps,
    particles: () => scene.particles?.particles.drawn ?? 0,
    litSprites: () => scene.litSprites(),
    bandBlur: () => scene.bandBlur(),
    setPreset: (id) => swatches[PRESET_IDS.indexOf(id)]!.click(),
    setLighting: (on) => {
      if (on !== options.lighting) lightingButton.click();
    },
    setFocus: (on) => {
      if (on !== options.focus) focusButton.click();
    },
    setWeather: (weather) => scene.setWeather(weather),
    setParticles: (on) => {
      if (on !== options.particles) particlesButton.click();
    },
  };
});
