import type { UnityRecord } from './yaml.js';

type Field = { name: string; type: string; value: string; children: Field[] };
const TYPES: Record<number, string> = {
  1: 'GameObject',
  4: 'Transform',
  23: 'MeshRenderer',
  33: 'MeshFilter',
  108: 'Light',
  114: 'MonoBehaviour',
  205: 'LODGroup',
  1001: 'PrefabInstance',
};
const READ = new Set(['GameObject', 'Transform', 'MeshRenderer', 'MeshFilter', 'LODGroup', 'PrefabInstance']);

/** Convert Unity binary2text output into the same record representation as YAML. */
export function parseUnityBinaryDump(source: string): Map<string, UnityRecord> {
  const external = new Map<string, string>();
  const records = new Map<string, UnityRecord>();
  let current: UnityRecord | undefined;
  let fields: Field[] = [];
  let stack: Array<{ depth: number; children: Field[] }> = [];
  const convert = (field: Field): unknown => {
    if (field.type.startsWith('PPtr<')) {
      const children = Object.fromEntries(field.children.map((entry) => [entry.name, convert(entry)]));
      const index = String(children.m_FileID);
      const fileId = children.m_PathID;
      if (typeof fileId !== 'string') throw new Error('invalid binary Unity reference');
      const guid = index === '0' ? undefined : external.get(index);
      if (index !== '0' && !guid) throw new Error(`missing binary Unity external ${index}`);
      return { fileID: fileId, ...(guid ? { guid } : {}) };
    }
    if (field.type === 'vector' || field.type === 'Array')
      return field.children.filter((entry) => entry.name === 'data').map(convert);
    if (field.type === 'Vector3f' && field.value.startsWith('(')) {
      const values = field.value.slice(1, -1).trim().split(/\s+/).map(Number);
      if (values.length !== 3 || values.some((value) => !Number.isFinite(value)))
        throw new Error('invalid binary Unity vector');
      return { x: values[0], y: values[1], z: values[2] };
    }
    if (field.children.length) return Object.fromEntries(field.children.map((entry) => [entry.name, convert(entry)]));
    if (field.type === 'string') return JSON.parse(field.value);
    if (field.type === 'float' || field.type === 'double') {
      const value = Number(field.value);
      if (!Number.isFinite(value)) throw new Error('invalid binary Unity number');
      return value;
    }
    return field.value;
  };
  const finish = () => {
    if (!current) return;
    if (READ.has(current.type)) current.data = Object.fromEntries(fields.map((field) => [field.name, convert(field)]));
    records.set(current.id, current);
  };
  for (const line of source.split(/\r?\n/)) {
    const ref = /^path\((\d+)\): .* GUID: ([a-f0-9]{32}) Type: \d+$/i.exec(line);
    if (ref) {
      if (external.has(ref[1]!)) throw new Error(`duplicate binary Unity external ${ref[1]}`);
      external.set(ref[1]!, ref[2]!.toLowerCase());
      continue;
    }
    const header = /^ID: (-?\d+) \(ClassID: (\d+)\) (.+)$/.exec(line);
    if (header) {
      finish();
      const id = header[1]!,
        classId = Number(header[2]);
      if (records.has(id)) throw new Error(`duplicate binary Unity fileID ${id}`);
      const type = TYPES[classId] ?? header[3]!;
      current = { id, classId, type, stripped: header[3] === 'EditorExtension', data: {} };
      fields = [];
      stack = [{ depth: 0, children: fields }];
      continue;
    }
    if (!current || !READ.has(current.type) || !line.startsWith('\t')) continue;
    const match = /^(\t+)(\S+)(?: (.*?))? \(([^()]*)\)$/.exec(line);
    if (!match) throw new Error(`invalid binary Unity field in ${current.id}`);
    const depth = match[1]!.length;
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    if (!stack.length || stack[stack.length - 1]!.depth !== depth - 1)
      throw new Error(`invalid binary Unity indentation in ${current.id}`);
    const field: Field = { name: match[2]!, value: (match[3] ?? '').trim(), type: match[4]!, children: [] };
    stack[stack.length - 1]!.children.push(field);
    stack.push({ depth, children: field.children });
  }
  finish();
  if (!records.size) throw new Error('no binary Unity records found');
  return records;
}
