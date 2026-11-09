import { z } from 'zod';

// A build ticket that waits on a creator decision (#680). `gm build park --on <key>` labels the ticket `waits:<key>`
// and comments a hidden `gm-waits-on` marker; when the decision is answered, the API releases every ticket that carries
// the label. The key is either the aiur decision id (`dec_<hex>`) or a name such as `blobs/diorama` that a later
// Command carries in its context (`gm decide --key`), so a ticket can wait on a question that has not been asked yet.
// GitHub caps a label at 50 characters, so a key is at most 40 after the `waits:` prefix.
export const DecisionKey = z.string().regex(/^[a-z0-9][a-z0-9_/-]{0,39}$/);

const WAIT_LABEL_PREFIX = 'waits:';

export function waitLabel(key: string): string {
  return `${WAIT_LABEL_PREFIX}${key}`;
}

// The key a `waits:` label names; null for any other label.
export function waitKeyOfLabel(label: string): string | null {
  if (!label.startsWith(WAIT_LABEL_PREFIX)) return null;
  const key = label.slice(WAIT_LABEL_PREFIX.length);
  return DecisionKey.safeParse(key).success ? key : null;
}

// The key a Command carries in its long context, `<!-- gm-decision-key:<key> -->`; null when it names none.
const KEY_MARKER = /<!-- gm-decision-key:(\S+) -->/;

export function decisionKeyMarker(key: string): string {
  return `<!-- gm-decision-key:${key} -->`;
}

export function decisionKeyFromMarker(text: string | null | undefined): string | null {
  const match = typeof text === 'string' ? KEY_MARKER.exec(text) : null;
  const key = match?.[1];
  return key !== undefined && DecisionKey.safeParse(key).success ? key : null;
}

// What a waiting ticket waits for. `when` is an option id: the ticket is follow-up work (filed ahead, or closed and to
// be reopened) that runs only when the answer picks that option, and is closed as not planned when it picks another.
export const DecisionWait = z.object({
  key: DecisionKey,
  when: z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/)
    .optional(),
});
export type DecisionWait = z.infer<typeof DecisionWait>;

const WAIT_MARKER = /<!-- gm-waits-on:(\{[^\n]*?\}) -->/g;

export function waitMarker(wait: DecisionWait): string {
  return `<!-- gm-waits-on:${JSON.stringify(DecisionWait.parse(wait))} -->`;
}

// Every wait a text declares, in order; malformed markers are skipped.
export function waitsFromText(text: string): DecisionWait[] {
  const waits: DecisionWait[] = [];
  for (const match of text.matchAll(WAIT_MARKER)) {
    try {
      const parsed = DecisionWait.safeParse(JSON.parse(match[1] as string) as unknown);
      if (parsed.success) waits.push(parsed.data);
    } catch {
      continue;
    }
  }
  return waits;
}
