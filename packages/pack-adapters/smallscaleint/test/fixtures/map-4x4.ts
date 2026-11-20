const properties = (asset: string, rotation: number, solid?: boolean) => [
  { name: 'asset', value: asset },
  { name: 'rotation', value: rotation },
  ...(solid === undefined ? [] : [{ name: 'solid', value: solid }]),
];

/** A generated finite Tiled map with every adapter layer and all four measured facings. */
export function fixtureMap4x4() {
  const empty = () => Array<number>(16).fill(0);
  const floor = Array<number>(16).fill(1);
  const wall = empty();
  const decor = empty();
  const roof = empty();
  wall[5] = 2;
  wall[6] = 3;
  decor[8] = 4;
  decor[9] = 5;
  decor[10] = 6;
  decor[11] = 7;
  roof[5] = 8;

  return {
    orientation: 'isometric' as const,
    width: 4,
    height: 4,
    tilewidth: 128,
    tileheight: 64,
    infinite: false,
    tilesets: [
      {
        firstgid: 1,
        name: 'pieces',
        tiles: [
          { id: 0, properties: properties('ground-01', 0, false) },
          { id: 1, properties: properties('wall-01', 0, true) },
          { id: 2, properties: properties('door-01', 90, true) },
          { id: 3, properties: properties('chest', 0, false) },
          { id: 4, properties: properties('chest', 90, false) },
          { id: 5, properties: properties('chest', 180, false) },
          { id: 6, properties: properties('chest', 270, false) },
          { id: 7, properties: properties('roof-01', 270, false) },
        ],
      },
    ],
    layers: [
      { type: 'tilelayer' as const, name: 'floor', width: 4, height: 4, data: floor },
      { type: 'tilelayer' as const, name: 'wall', width: 4, height: 4, data: wall },
      { type: 'tilelayer' as const, name: 'decor', width: 4, height: 4, data: decor },
      { type: 'tilelayer' as const, name: 'roof', width: 4, height: 4, data: roof },
      {
        type: 'objectgroup' as const,
        name: 'spawns',
        objects: [
          {
            id: 1,
            name: 'player',
            x: 0,
            y: 128,
            properties: [{ name: 'prefab', value: 'hero' }],
          },
        ],
      },
    ],
  };
}
