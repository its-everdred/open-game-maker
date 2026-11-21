export interface ColorGrade {
  temperature: number;
  saturation: number;
  contrast: number;
}

export type RGB = readonly [number, number, number];

/** Applies a compact renderer-neutral grade to byte-range RGB values. */
export function gradeColor(rgb: RGB, grade: ColorGrade): [number, number, number] {
  const [red, green, blue] = rgb;
  const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const temperature = Math.max(-1, Math.min(1, grade.temperature));
  return [red, green, blue].map((channel, index) => {
    const saturated = luma + (channel - luma) * grade.saturation;
    const warmShift = index === 0 ? temperature * 18 : index === 2 ? -temperature * 18 : temperature * 2;
    return clampByte((saturated - 127.5) * grade.contrast + 127.5 + warmShift);
  }) as [number, number, number];
}

/** Returns a restrained warm morning, neutral midday, or cool night grade. */
export function timeOfDayGrade(hour0to24: number): ColorGrade {
  const hour = ((hour0to24 % 24) + 24) % 24;
  const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const twilight = Math.max(0, 1 - Math.abs(hour - 6) / 3, 1 - Math.abs(hour - 18) / 3);
  return {
    temperature: clamp(-0.32 + daylight * 0.38 + twilight * 0.22, -1, 1),
    saturation: 0.78 + daylight * 0.22,
    contrast: 0.96 + daylight * 0.08,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampByte(value: number): number {
  return Math.round(clamp(value, 0, 255));
}
