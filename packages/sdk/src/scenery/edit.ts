import { ScenerySchema, type Scenery } from '@ogm/contracts/scenery';

/** Editor history owns snapshots so undo also restores transforms and terrain. */
export class SceneryHistory {
  private current: Scenery;
  private readonly previous: Scenery[] = [];

  constructor(scene: Scenery) {
    this.current = ScenerySchema.parse(scene);
  }

  snapshot(): Scenery {
    return structuredClone(this.current);
  }

  update(edit: (scene: Scenery) => void): Scenery {
    const next = this.snapshot();
    edit(next);
    const validated = ScenerySchema.parse(next);
    this.previous.push(this.current);
    this.current = validated;
    return this.snapshot();
  }

  undo(): Scenery {
    this.current = this.previous.pop() ?? this.current;
    return this.snapshot();
  }
}

/** Snap the vertical component to a supplied ground height. */
export function snapToGround(
  position: [number, number, number],
  ground: (x: number, z: number) => number,
): [number, number, number] {
  const height = ground(position[0], position[2]);
  if (!Number.isFinite(height)) throw new Error('ground height must be finite');
  return [position[0], height, position[2]];
}
