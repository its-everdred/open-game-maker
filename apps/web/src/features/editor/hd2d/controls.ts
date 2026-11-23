import type { Hd2dSceneConfig } from '@gm/sdk/hd2d';

/**
 * Kevin's HD-2D lighting tool (#1211): the controls over one scene's HD-2D document. Each slider reads and writes one
 * field; the running game re-renders from the edited document, so the controls never draw anything themselves.
 */
export type Hd2dDoc = Hd2dSceneConfig;
type Shafts = NonNullable<Hd2dDoc['lighting']['shafts']>;
type Clouds = NonNullable<Hd2dDoc['lighting']['clouds']>;

export type Slider = {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** What the value reads as; a slider at an end can mean "always" rather than a number. */
  shown: string;
  set(doc: Hd2dDoc, value: number): Hd2dDoc;
};

export const TABS = [
  { id: 'shafts', label: 'Sun shafts', icon: 'sun' },
  { id: 'clouds', label: 'Clouds', icon: 'cloud' },
  { id: 'weather', label: 'Weather', icon: 'rain' },
  { id: 'light', label: 'Light', icon: 'bulb' },
  { id: 'focus', label: 'Focus', icon: 'focus' },
  { id: 'particles', label: 'Particles', icon: 'leaf' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

/** Turned on from nothing: a few short beams that come and go, like the forest sampler's. */
export const NEW_SHAFTS: Shafts = {
  direction: 1.1,
  color: '#ffe7a1',
  intensity: 0.4,
  count: 4,
  reach: 0.45,
  width: 0.05,
  pool: 0.8,
  cycle: 8,
  chance: 0.6,
};
export const NEW_CLOUDS: Clouds = { coverage: 0.45, scale: 0.55, speed: 0.015, direction: 0.3, shadow: 0.4, sun: 0.35 };

/** Weathers every game can name; a scene's own names are added to these. */
const WEATHERS = ['clear', 'partly-cloudy', 'overcast', 'rain'];
/** Beams with no `cycle` stay lit; the stay slider's top end stands for that. */
const STAY_MAX = 30;
export const FOCUS_MODES = [
  { id: 'off', label: 'Off' },
  { id: 'depthBands', label: 'Bands' },
  { id: 'tiltShift', label: 'Tilt' },
  { id: 'depthOfField', label: 'Depth' },
] as const;
const PRESET_NAMES: Record<string, string> = {
  'forest-leaves': 'Leaves',
  'forest-motes': 'Motes',
  'soft-motes': 'Soft motes',
  'campfire-embers': 'Embers',
};

/** A copy to change: documents are small, and the copy keeps the one the game reported untouched. */
function edit(doc: Hd2dDoc, change: (draft: Hd2dDoc) => void): Hd2dDoc {
  const draft = structuredClone(doc);
  change(draft);
  return draft;
}

const round = (value: number, step: number) => Math.round(value / step) * step;
const decimals = (step: number) => (step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step))));
const show = (value: number, step: number) => round(value, step).toFixed(decimals(step));
const percent = (value: number) => `${Math.round(value * 100)}%`;

function slider(
  id: string,
  label: string,
  [min, max, step]: [number, number, number],
  value: number,
  set: Slider['set'],
  shown = show(value, step),
): Slider {
  return { id, label, min, max, step, value, shown, set };
}

export function shaftSliders(doc: Hd2dDoc): Slider[] {
  const shafts = doc.lighting.shafts;
  if (!shafts) return [];
  const field =
    <K extends keyof Shafts>(key: K) =>
    (current: Hd2dDoc, value: number) =>
      edit(current, (draft) => {
        if (draft.lighting.shafts) (draft.lighting.shafts[key] as number) = value;
      });
  const stay = shafts.cycle ?? STAY_MAX;
  return [
    slider('brightness', 'Brightness', [0, 1, 0.01], shafts.intensity, field('intensity'), percent(shafts.intensity)),
    slider('count', 'Beams', [1, 12, 1], shafts.count ?? 1, field('count')),
    slider('chance', 'How often', [0, 1, 0.05], shafts.chance ?? 1, field('chance'), percent(shafts.chance ?? 1)),
    slider(
      'cycle',
      'Stays',
      [1, STAY_MAX, 1],
      stay,
      (current, value) =>
        edit(current, (draft) => {
          if (!draft.lighting.shafts) return;
          if (value >= STAY_MAX) delete draft.lighting.shafts.cycle;
          else draft.lighting.shafts.cycle = value;
        }),
      shafts.cycle === undefined ? 'always' : `${Math.round(stay)} s`,
    ),
    slider('reach', 'Reach', [0.05, 1, 0.05], shafts.reach ?? 0.45, field('reach'), percent(shafts.reach ?? 0.45)),
    slider('width', 'Width', [0.01, 0.2, 0.005], shafts.width ?? 0.035, field('width')),
    slider('pool', 'Ground glow', [0, 1, 0.05], shafts.pool ?? 0.8, field('pool'), percent(shafts.pool ?? 0.8)),
    slider(
      'direction',
      'Angle',
      [0.5, 2.6, 0.01],
      shafts.direction,
      field('direction'),
      `${Math.round((shafts.direction * 180) / Math.PI)}°`,
    ),
  ];
}

export function cloudSliders(doc: Hd2dDoc): Slider[] {
  const clouds = doc.lighting.clouds;
  if (!clouds) return [];
  const field = (key: keyof Clouds) => (current: Hd2dDoc, value: number) =>
    edit(current, (draft) => {
      if (draft.lighting.clouds) draft.lighting.clouds[key] = value;
    });
  return [
    slider('coverage', 'Cover', [0, 1, 0.05], clouds.coverage, field('coverage'), percent(clouds.coverage)),
    slider('shadow', 'Shade', [0, 1, 0.05], clouds.shadow, field('shadow'), percent(clouds.shadow)),
    slider('sun', 'Sunny patches', [0, 1, 0.05], clouds.sun, field('sun'), percent(clouds.sun)),
    slider('scale', 'Size', [0.1, 2, 0.05], clouds.scale, field('scale')),
    slider('speed', 'Drift', [0, 0.2, 0.005], clouds.speed, field('speed')),
  ];
}

export function lightSliders(doc: Hd2dDoc): Slider[] {
  const { ambient, grade, dapple, lights } = doc.lighting;
  const sliders = [
    slider(
      'ambient',
      'Ambient',
      [0, 1, 0.01],
      ambient.intensity,
      (current, value) => edit(current, (draft) => void (draft.lighting.ambient.intensity = value)),
      percent(ambient.intensity),
    ),
  ];
  const gradeField = (key: 'temperature' | 'saturation' | 'contrast') => (current: Hd2dDoc, value: number) =>
    edit(current, (draft) => {
      draft.lighting.grade = { temperature: 0, saturation: 1, contrast: 1, ...draft.lighting.grade, [key]: value };
    });
  sliders.push(
    slider('warmth', 'Warmth', [-1, 1, 0.05], grade?.temperature ?? 0, gradeField('temperature')),
    slider('saturation', 'Colour', [0, 2, 0.05], grade?.saturation ?? 1, gradeField('saturation')),
    slider('contrast', 'Contrast', [0.5, 1.5, 0.01], grade?.contrast ?? 1, gradeField('contrast')),
  );
  if (dapple)
    sliders.push(
      slider(
        'dapple',
        'Leaf dapple',
        [0, 1, 0.01],
        dapple.intensity,
        (current, value) =>
          edit(current, (draft) => {
            if (draft.lighting.dapple) draft.lighting.dapple.intensity = value;
          }),
        percent(dapple.intensity),
      ),
    );
  (lights ?? []).forEach((light, index) => {
    const at =
      (change: (target: NonNullable<Hd2dDoc['lighting']['lights']>[number], value: number) => void) =>
      (current: Hd2dDoc, value: number) =>
        edit(current, (draft) => {
          const target = draft.lighting.lights?.[index];
          if (target) change(target, value);
        });
    const name = readable(light.id);
    sliders.push(
      slider(
        `light-${index}`,
        name,
        [0, 1, 0.01],
        light.intensity,
        at((target, value) => void (target.intensity = value)),
        percent(light.intensity),
      ),
      slider(
        `light-${index}-radius`,
        `${name} reach`,
        [10, 1000, 10],
        light.radius,
        at((target, value) => void (target.radius = value)),
      ),
    );
    if (light.flicker)
      sliders.push(
        slider(
          `light-${index}-flicker`,
          `${name} flicker`,
          [0, 1, 0.05],
          light.flicker.amount,
          at((target, value) => {
            if (target.flicker) target.flicker.amount = value;
          }),
          percent(light.flicker.amount),
        ),
      );
  });
  return sliders;
}

export function focusSliders(doc: Hd2dDoc): Slider[] {
  const sliders = [
    slider(
      'strength',
      'Blur',
      [0, 1, 0.05],
      doc.focus.strength,
      (current, value) => edit(current, (draft) => void (draft.focus.strength = value)),
      percent(doc.focus.strength),
    ),
    slider(
      'range',
      'Sharp area',
      [0, 1, 0.05],
      doc.focus.range,
      (current, value) => edit(current, (draft) => void (draft.focus.range = value)),
      percent(doc.focus.range),
    ),
  ];
  const haze = doc.atmosphere.haze;
  if (haze)
    sliders.push(
      slider(
        'haze',
        'Haze',
        [0, 1, 0.05],
        haze.density ?? 1,
        (current, value) =>
          edit(current, (draft) => {
            if (draft.atmosphere.haze) draft.atmosphere.haze.density = value;
          }),
        percent(haze.density ?? 1),
      ),
    );
  return sliders;
}

export function particleSliders(doc: Hd2dDoc): Slider[] {
  const sliders = doc.particles.emitters.map((emitter, index) =>
    slider(
      `emitter-${index}`,
      PRESET_NAMES[emitter.preset] ?? emitter.preset,
      [0, 4, 0.1],
      emitter.density ?? 1,
      (current, value) =>
        edit(current, (draft) => {
          const target = draft.particles.emitters[index];
          if (target) target.density = value;
        }),
      `${show(emitter.density ?? 1, 0.1)}×`,
    ),
  );
  sliders.push(
    slider('wind', 'Wind', [0, 4, 0.1], doc.particles.wind.strength, (current, value) =>
      edit(current, (draft) => void (draft.particles.wind.strength = value)),
    ),
  );
  return sliders;
}

export function slidersFor(tab: TabId, doc: Hd2dDoc): Slider[] {
  switch (tab) {
    case 'shafts':
      return shaftSliders(doc);
    case 'clouds':
      return cloudSliders(doc);
    case 'light':
      return lightSliders(doc);
    case 'focus':
      return focusSliders(doc);
    case 'particles':
      return particleSliders(doc);
    case 'weather':
      return [];
  }
}

/** Sun shafts on or off; turning them back on restores the ones Kevin turned off. */
export function setShafts(doc: Hd2dDoc, on: boolean, restore: Shafts | undefined): Hd2dDoc {
  return edit(doc, (draft) => {
    if (on) draft.lighting.shafts = draft.lighting.shafts ?? structuredClone(restore ?? NEW_SHAFTS);
    else delete draft.lighting.shafts;
  });
}

export function setClouds(doc: Hd2dDoc, on: boolean, restore: Clouds | undefined): Hd2dDoc {
  return edit(doc, (draft) => {
    if (on) draft.lighting.clouds = draft.lighting.clouds ?? structuredClone(restore ?? NEW_CLOUDS);
    else delete draft.lighting.clouds;
  });
}

export function setFocusMode(doc: Hd2dDoc, mode: Hd2dDoc['focus']['mode']): Hd2dDoc {
  return edit(doc, (draft) => void (draft.focus.mode = mode));
}

/** The weathers to offer: the common ones, then any the scene or game names. */
export function weathers(doc: Hd2dDoc, current: string | undefined): string[] {
  const named = [...(doc.lighting.shafts?.when?.weather ?? []), ...(current ? [current] : [])];
  return [...new Set([...WEATHERS, ...named])];
}

/** `undefined`: shafts show in any weather. */
export function shaftWeathers(doc: Hd2dDoc): readonly string[] | undefined {
  return doc.lighting.shafts?.when?.weather;
}

/** Lets shafts through in `weather` or not. Clearing the last one leaves an empty list: no weather lets them through. */
export function toggleShaftWeather(doc: Hd2dDoc, weather: string, all: readonly string[]): Hd2dDoc {
  return edit(doc, (draft) => {
    const shafts = draft.lighting.shafts;
    if (!shafts) return;
    const allowed = new Set(shafts.when?.weather ?? all);
    if (allowed.has(weather)) allowed.delete(weather);
    else allowed.add(weather);
    shafts.when = { ...shafts.when, weather: all.filter((name) => allowed.has(name)) };
  });
}

/** Shafts in every weather again. */
export function anyWeather(doc: Hd2dDoc): Hd2dDoc {
  return edit(doc, (draft) => {
    const shafts = draft.lighting.shafts;
    if (!shafts?.when) return;
    delete shafts.when.weather;
    if (Object.keys(shafts.when).length === 0) delete shafts.when;
  });
}

/** A readable name for an id such as `partly-cloudy` or `sun-fill`. */
export function readable(weather: string): string {
  const words = weather.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Two documents with the same fields, whatever their key order: the game's echo of an edit is not a new scene. */
export function sameDoc(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([x], [y]) => x.localeCompare(y)))
      : entry,
  );
}
