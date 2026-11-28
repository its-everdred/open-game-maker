import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUnityBinaryDump } from './binary-dump.js';
import { parseUnityYaml, type UnityRecord } from './yaml.js';

/** Read a Unity text asset, or use the explicitly supplied Unity binary2text tool. */
export function readUnityRecords(path: string, binary2text?: string): Map<string, UnityRecord> {
  if (statSync(path).size > 256 * 1024 * 1024) throw new Error('Unity source is too large');
  const bytes = readFileSync(path);
  const prefix = bytes.subarray(0, 128).toString('utf8');
  if (/^\uFEFF?(?:%YAML|\s*--- !u!)/.test(prefix)) return parseUnityYaml(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (!binary2text) throw new Error('binary Unity source requires --binary2text <tool-path>');
  const directory = mkdtempSync(join(tmpdir(), 'gm-unity-binary-'));
  try {
    const output = join(directory, 'dump.txt');
    execFileSync(binary2text, [path, output, '-largebinaryhashonly'], { timeout: 5 * 60_000, maxBuffer: 1024 * 1024 });
    if (statSync(output).size > 512 * 1024 * 1024) throw new Error('Unity binary dump is too large');
    return parseUnityBinaryDump(readFileSync(output, 'utf8'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
