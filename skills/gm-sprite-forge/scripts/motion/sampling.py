"""Which source frame each sheet frame shows (#1282 bake-off). No Blender: render_motion.py and the tests import it.

even:  `n` frames spread evenly over [f0, f1]; a loop leaves out f1 (it is f0 again), a one-shot ends on f1.
keys:  key-pose stepped. `keys` lists source frames of the poses to hold (contact, passing, strike, recovery ...) and
       `holds` how many sheet frames each one holds; the holds sum to `n` (the pack clip's frame count), so the key
       poses land on the pack's own beats and nothing is drawn between them.
times: the sheet frames' source frames given outright (a retime to the pack's beats, with in-betweens).
"""


def frames(spec, n, f0, f1, loop):
    s = spec.get('sample', 'even')
    if s == 'even':
        if n == 1:
            return [float(f0)]
        step = (f1 - f0) / (n if loop else n - 1)
        return [f0 + i * step for i in range(n)]
    if s == 'keys':
        keys, holds = spec['keys'], spec['holds']
        if len(keys) != len(holds):
            raise ValueError(f'keys ({len(keys)}) and holds ({len(holds)}) differ in length')
        if sum(holds) != n or min(holds) < 1:
            raise ValueError(f'holds must be at least 1 each and sum to the {n} sheet frames, not {sum(holds)}')
        return [float(k) for k, h in zip(keys, holds) for _ in range(h)]
    if s == 'times':
        if len(spec['times']) != n:
            raise ValueError(f'times lists {len(spec["times"])} frames for a {n}-frame sheet')
        return [float(t) for t in spec['times']]
    raise ValueError(f'unknown sample {s!r}: even, keys or times')


def in_place(track, ts, f0, f1):
    """Offsets that hold a travelling clip in place: minus the straight-line drift of the hips' ground position from f0
    to f1 (track(t) -> (x, y)), so the step-to-step sway stays and only the forward travel goes."""
    x0, y0 = track(f0)
    x1, y1 = track(f1)
    span = (f1 - f0) or 1.0
    return [(-(x1 - x0) * (t - f0) / span, -(y1 - y0) * (t - f0) / span) for t in ts]


def in_place_keyed(track, src_ts, keyed):
    """in_place for a copy retarget, whose pose at sheet frame i is keyed at frame keyed[i] from source time src_ts[i]:
    the hips are read at the keyed frames (track(keyed frame) -> (x, y)) but the drift is taken over source time, so a
    key pose held for several sheet frames (the same source time) stays put instead of sliding through its hold."""
    key = {}
    for s, k in zip(src_ts, keyed):
        key.setdefault(s, k)
    return in_place(lambda s: track(key[s]), src_ts, src_ts[0], src_ts[-1])


def compatible(prev, q):
    """q, or -q when that is nearer prev (q and -q are one rotation): consecutive quaternion keys on one hemisphere, so
    any interpolation between them turns the short way instead of spinning a bone round (a back-and-forth glitch)."""
    return [-x for x in q] if sum(x * y for x, y in zip(prev, q)) < 0 else list(q)
