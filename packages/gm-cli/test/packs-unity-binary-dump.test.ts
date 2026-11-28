import { expect, it } from 'vitest';
import { parseUnityBinaryDump } from '../src/packs/unity/binary-dump.js';

it('reads binary2text references, vectors, and stripped transforms without losing IDs', () => {
  const dump = `External References
path(1): "" GUID: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa Type: 3
ID: 10 (ClassID: 1001) PrefabInstance
\tm_Modification  (PrefabModification)
\t\tm_TransformParent  (PPtr<Transform>)
\t\t\tm_FileID 0 (int)
\t\t\tm_PathID 0 (SInt64)
\t\tm_Modifications  (vector)
\t\t\tsize 1 (int)
\t\t\tdata  (PropertyModification)
\t\t\t\ttarget  (PPtr<Object>)
\t\t\t\t\tm_FileID 1 (int)
\t\t\t\t\tm_PathID 9223372036854775807 (SInt64)
\t\t\t\tpropertyPath "m_Name" (string)
\t\t\t\tvalue "House" (string)
\tm_SourcePrefab  (PPtr<Prefab>)
\t\tm_FileID 1 (int)
\t\tm_PathID 100100000 (SInt64)
ID: 11 (ClassID: 4) EditorExtension
\tm_CorrespondingSourceObject  (PPtr<EditorExtension>)
\t\tm_FileID 1 (int)
\t\tm_PathID 9223372036854775807 (SInt64)
\tm_PrefabInstance  (PPtr<PrefabInstance>)
\t\tm_FileID 0 (int)
\t\tm_PathID 10 (SInt64)
ID: 12 (ClassID: 4) Transform
\tm_LocalPosition (1 2 -3.5) (Vector3f)
`;
  const records = parseUnityBinaryDump(dump);
  expect(records.get('10')?.data).toMatchObject({
    m_SourcePrefab: { fileID: '100100000', guid: 'a'.repeat(32) },
    m_Modification: {
      m_Modifications: [{ target: { fileID: '9223372036854775807', guid: 'a'.repeat(32) }, value: 'House' }],
    },
  });
  expect(records.get('12')?.data.m_LocalPosition).toEqual({ x: 1, y: 2, z: -3.5 });
  expect(records.get('11')).toMatchObject({
    type: 'Transform',
    stripped: true,
    data: { m_PrefabInstance: { fileID: '10' } },
  });
  expect(() => parseUnityBinaryDump(dump.replace('m_FileID 1 (int)', 'm_FileID 9 (int)'))).toThrow(
    'missing binary Unity external',
  );
});
