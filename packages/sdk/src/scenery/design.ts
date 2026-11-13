import { StableIdSchema, type DesignDoc, type Entity } from '@ogm/contracts/browser';
import { parseScenery, ScenerySchema, type Scenery } from '@ogm/contracts/scenery';

const PREFIX = 'scenery:';
const SETTINGS = 'scenery.settings';
type Asset = { id: string };

/** Add a scenery file to a design document without disturbing the game's own entities. */
export function sceneryToDesign(scene: Scenery, doc: DesignDoc, stableId: (itemId: string) => string): DesignDoc {
  const next = structuredClone(doc);
  scene = ScenerySchema.parse(scene);
  if (SETTINGS in next.globals) throw new Error('design already has scenery settings');
  next.globals[SETTINGS] = {
    version: scene.version,
    terrain: scene.terrain,
    lighting: scene.lighting,
    camera: scene.camera,
  };
  for (const item of scene.items) {
    const id = StableIdSchema.parse(stableId(item.id));
    if (next.entities[id]) throw new Error(`design entity already exists: ${id}`);
    next.entities[id] = {
      id,
      prefab: `${PREFIX}${item.assetId}`,
      level: 'main',
      origin: 'creator',
      props: {
        sceneryItemId: item.id,
        layer: item.layer,
        scale: item.scale,
        rotation: item.rotation,
        pose: { position: item.position, rotationY: (item.rotation[1] * 180) / Math.PI },
      },
    };
  }
  return next;
}

/** Read the effective document after creator transactions back into the same scenery format. */
export function sceneryFromDesign(doc: DesignDoc, assets: readonly Asset[]): Scenery {
  const settings = doc.globals[SETTINGS];
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('design has no scenery settings');
  const items = Object.values(doc.entities)
    .filter((entity) => entity.prefab.startsWith(PREFIX))
    .map(toItem);
  return parseScenery({ ...settings, items }, assets);
}

function toItem(entity: Entity): Scenery['items'][number] {
  const props = entity.props;
  const pose = props.pose as { position?: unknown; rotationY?: unknown } | undefined;
  const rotation = Array.isArray(props.rotation) ? [...props.rotation] : [0, 0, 0];
  if (typeof pose?.rotationY === 'number') rotation[1] = (pose.rotationY * Math.PI) / 180;
  return {
    id: typeof props.sceneryItemId === 'string' ? props.sceneryItemId : entity.id,
    assetId: entity.prefab.slice(PREFIX.length),
    position: pose?.position as [number, number, number],
    rotation: rotation as [number, number, number],
    scale: (props.scale ?? [1, 1, 1]) as [number, number, number],
    layer: (props.layer ?? 'mid') as Scenery['items'][number]['layer'],
  };
}
