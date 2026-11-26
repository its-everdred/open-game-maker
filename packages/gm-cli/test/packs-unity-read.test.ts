import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readUnityRecords } from '../src/packs/unity/read.js';

it('reads Unity text directly and clearly refuses binary input without the conversion tool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-unity-read-'));
  try {
    const path = join(root, 'scene.unity');
    await writeFile(path, '--- !u!1 &1\nGameObject:\n  m_Name: House\n');
    expect(readUnityRecords(path).get('1')?.data.m_Name).toBe('House');
    await writeFile(path, '\uFEFF%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: House\n');
    expect(readUnityRecords(path).get('1')?.data.m_Name).toBe('House');
    await writeFile(path, Buffer.from([0, 0, 0, 1]));
    expect(() => readUnityRecords(path)).toThrow('binary Unity source requires --binary2text');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('uses an explicitly supplied converter for binary sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-unity-reader-'));
  try {
    const source = join(root, 'binary scene.unity');
    const tool = join(root, 'binary2text');
    await writeFile(source, Buffer.from([0, 0, 0, 22]));
    await writeFile(
      tool,
      '#!/bin/sh\nprintf "ID: 1 (ClassID: 1) GameObject\\n\\tm_Name \\\"House\\\" (string)\\n" > "$2"\n',
      { mode: 0o700 },
    );
    expect(readUnityRecords(source, tool).get('1')?.data.m_Name).toBe('House');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
