/** A gain target on the deterministic game clock. A zero time constant sets the gain immediately. */
export type GainTarget = { time: number; target: number; timeConstant: number };

/** Build an ffmpeg volume expression for overlapping exponential bus gain targets. */
export function gainEnvelope(initial: number, targets: GainTarget[], offset: number): string {
  if (!Number.isFinite(initial) || initial < 0 || !Number.isFinite(offset) || offset < 0)
    throw new Error('invalid audio gain envelope');
  let start = 0;
  let from = initial;
  let target = initial;
  let tau = 0;
  let expression = String(initial);
  for (const event of targets) {
    if (
      !Number.isFinite(event.time) ||
      event.time < start ||
      !Number.isFinite(event.target) ||
      event.target < 0 ||
      !Number.isFinite(event.timeConstant) ||
      event.timeConstant < 0
    )
      throw new Error('invalid audio gain target');
    const prior = tau === 0 ? target : target + (from - target) * Math.exp(-(event.time - start) / tau);
    start = event.time;
    from = prior;
    target = event.target;
    tau = event.timeConstant;
    const next = tau === 0 ? String(target) : `(${target}+(${from - target})*exp(-(t+${offset}-${start})/${tau}))`;
    expression = `if(lt(t+${offset},${start}),${expression},${next})`;
  }
  return expression;
}
