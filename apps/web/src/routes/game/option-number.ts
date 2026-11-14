export function snapOptionNumber(value: number, min: number, max: number, step: number): number {
  const steps = Math.min(Math.floor((max - min) / step + 1e-9), Math.max(0, Math.round((value - min) / step)));
  return Number((min + steps * step).toPrecision(15));
}
