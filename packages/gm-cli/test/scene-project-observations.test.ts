import { expect, it } from 'vitest';
import { projectSceneObservations, type ImageObservation } from '../src/scene/project-observations.js';

it('projects reviewed footpoints and keeps unmeasured scale, facing and occlusion unknown', () => {
  const brief = {
    image: { width: 10, height: 10 },
    story: 'A grave by the gate.',
    mood: 'Dusk',
    light: 'Warm',
    focalRegion: 'grave',
    regions: [
      { id: 'grave', label: 'Grave', layer: 'prop', bounds: { x: 1, y: 1, width: 3, height: 5 } },
      { id: 'gate', label: 'Gate', layer: 'landmark', bounds: { x: 4, y: 1, width: 4, height: 7 } },
    ],
  };
  const anchors = [
    { x: 0, y: 0 },
    { x: 9, y: 0 },
    { x: 9, y: 9 },
    { x: 0, y: 9 },
  ].map((point) => ({ image: point, ground: point }));
  const observations: ImageObservation[] = [
    { id: 'grave', footpoint: { x: 2, y: 6 }, visibleHeightPx: 4, facing: null, occludes: ['gate'] },
    { id: 'gate', footpoint: null, visibleHeightPx: null, facing: null, occludes: null },
  ];
  const mockSha256 = 'a'.repeat(64);
  const result = projectSceneObservations({ brief, mockSha256, anchors, characterHeightPx: 2, observations });
  expect(result).toMatchObject({ mockSha256, hasAnchors: true });
  expect(result.observations[0]).toMatchObject({
    id: 'grave',
    layer: 'prop',
    ground: { x: 2, y: 6 },
    facing: null,
    screenHeightInCharacters: 2,
    occludes: ['gate'],
  });
  expect(result.observations[1]).toMatchObject({ ground: null, screenHeightInCharacters: null, occludes: null });
  expect(
    projectSceneObservations({ brief, mockSha256, anchors: null, characterHeightPx: null, observations })
      .observations[0],
  ).toMatchObject({
    ground: null,
    screenHeightInCharacters: null,
  });
  expect(() =>
    projectSceneObservations({
      brief,
      mockSha256,
      anchors,
      characterHeightPx: 2,
      observations: [{ ...observations[0]!, footpoint: { x: 8, y: 8 } }, observations[1]!],
    }),
  ).toThrow('outside region');
  expect(() =>
    projectSceneObservations({
      brief,
      mockSha256,
      anchors,
      characterHeightPx: 2,
      observations: [observations[0]!, { ...observations[1]!, occludes: ['grave'] }],
    }),
  ).toThrow('cyclic');
  expect(() =>
    projectSceneObservations({
      brief,
      mockSha256,
      anchors,
      characterHeightPx: 2,
      observations: [{ ...observations[0]!, occludes: ['missing'] }, observations[1]!],
    }),
  ).toThrow('unknown observation');
  expect(() => projectSceneObservations({ brief, mockSha256, anchors, characterHeightPx: 11, observations })).toThrow(
    'character image height',
  );
  expect(() =>
    projectSceneObservations({ brief, mockSha256, anchors, characterHeightPx: Number.MIN_VALUE, observations }),
  ).toThrow('screen height ratio');
  expect(() =>
    projectSceneObservations({ brief, mockSha256: 'bad', anchors, characterHeightPx: 2, observations }),
  ).toThrow('mock hash');
});
