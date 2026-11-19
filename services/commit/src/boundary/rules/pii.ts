import type { BoundaryReason, BoundaryRule } from '../types.js';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const PHONE = /(?:\+\d{1,3}[\s.-])?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{4}\b/u;
const ID_TOKEN = /[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+/gu;
const DOTTED_HEX_TOKEN = /\b(?=[a-z0-9_]*[a-z_])[a-z0-9_]+(?:[.-][a-z0-9_]+)+\b/giu;
const LONG_DOTTED_ID = /\b\d{5,}(?:[.-][a-z0-9_]+)*[.-][a-z_][a-z0-9_]*\b/giu;
const MIXED_NUMERIC_TOKEN = /(?<![\w.-])\d+(?:[.-]\d+)+(?![\w-]|\.\d)/gu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const STREET =
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct)\b/iu;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function hasPhone(line: string): boolean {
  const withoutIds = line
    .replace(DOTTED_HEX_TOKEN, ' ')
    .replace(LONG_DOTTED_ID, ' ')
    .replace(ID_TOKEN, (token) => (/[a-z_]/iu.test(token) || UUID.test(token) ? ' ' : token))
    .replace(MIXED_NUMERIC_TOKEN, (token) => (token.includes('-') && token.includes('.') ? ' ' : token));
  return PHONE.test(withoutIds);
}

export const piiRule: BoundaryRule = (input) => {
  const reasons: BoundaryReason[] = [];
  const profilePatterns = input.profileNames
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .map((term) => new RegExp(`\\b${escapeRegex(term)}\\b`, 'iu'));

  for (const file of input.files) {
    if (file.status === 'removed' || file.content === undefined || file.binary) continue;
    file.content.split(/\r?\n/u).forEach((line, index) => {
      const classes = [
        ...(profilePatterns.some((pattern) => pattern.test(line)) ? ['profile term'] : []),
        ...(EMAIL.test(line) ? ['email address'] : []),
        ...(hasPhone(line) ? ['phone number'] : []),
        ...(STREET.test(line) ? ['street address'] : []),
      ];
      for (const classification of classes) {
        reasons.push({
          code: 'pii',
          path: file.path,
          detail: `personal information (${classification}) at line ${index + 1}`,
        });
      }
    });
  }
  return reasons;
};
