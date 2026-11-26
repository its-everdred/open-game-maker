import { parseDocument } from 'yaml';

/** A Unity YAML document, keyed by the exact (potentially 64-bit) local file ID. */
export type UnityRecord = {
  classId: number;
  id: string;
  stripped: boolean;
  type: string;
  data: Record<string, unknown>;
};

function stringsForBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stringsForBigInts);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stringsForBigInts(entry)]));
  }
  return value;
}

/** Parse Unity's tagged multi-document YAML without loading or executing package code. */
export function parseUnityYaml(source: string): Map<string, UnityRecord> {
  const header = /^--- !u!(\d+) &(-?\d+)( stripped)?\s*$/gm;
  const matches = [...source.matchAll(header)];
  if (!matches.length) throw new Error('no Unity YAML records found');
  const records = new Map<string, UnityRecord>();
  for (const [index, match] of matches.entries()) {
    const id = match[2]!;
    if (records.has(id)) throw new Error(`duplicate Unity fileID ${id}`);
    const start = match.index! + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const document = parseDocument(source.slice(start, end), { intAsBigInt: true });
    if (document.errors.length) throw new Error(`invalid Unity YAML record ${id}: ${document.errors[0]!.message}`);
    const value = stringsForBigInts(document.toJS({ maxAliasCount: 0 }));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) {
      throw new Error(`invalid Unity YAML record ${id}`);
    }
    const [type, data] = Object.entries(value)[0]!;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`invalid Unity YAML record ${id}`);
    records.set(id, {
      classId: Number(match[1]),
      id,
      stripped: Boolean(match[3]),
      type,
      data: data as Record<string, unknown>,
    });
  }
  return records;
}
