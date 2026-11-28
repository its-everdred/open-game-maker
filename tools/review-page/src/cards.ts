export interface Media {
  kind: 'img' | 'video' | 'audio';
  src: string;
  meta?: {
    kind?: string;
    model?: string;
    cost?: string;
    skill?: string;
    tool?: string;
    time?: string;
    ai?: boolean;
    pack?: string;
  };
  orig?: Media;
}

export interface Option {
  id: string;
  label: string;
  media: Media[];
}

export interface Card {
  key: string;
  repo: string;
  ticket: number;
  decision: string;
  title: string;
  at: string;
  mode: 'review' | 'multi' | 'matrix';
  shared: Media[];
  options: Option[];
  groups?: { id: string; label: string; media: Media[]; options: Option[] }[];
  rows?: { label: string; cells: (Option & { orig: boolean })[] }[];
  link?: string;
  play?: string;
  /** Internal precedence marker, removed before cards are published. */
  playSource?: 'preview';
  take?: string;
  top?: number;
  big?: number;
  ignoreSavedBefore?: number;
  phase?: { at: string; next: string };
  source?: string;
}

export interface Command {
  decision_id: string;
  question: string;
  created_at: string;
  ticket: { identifier: string | number };
  authority?: string;
  context?: { authority_basis?: string };
  media?: unknown[];
  options?: { id: string; label: string; media?: unknown[] }[];
}

/** Preserve the legacy page's shared-media and per-option review shapes. */
export function commandCard(repo: string, command: Command, resolveMedia: (items: unknown[]) => Media[]): Card {
  const shared = resolveMedia(command.media ?? []);
  const options = (command.options ?? []).map((option) => ({
    id: option.id,
    label: option.label,
    media: resolveMedia(option.media ?? []),
  }));
  if (options.length > 2 && shared.length === options.length && options.every((o) => !o.media.length)) {
    options.forEach((option, index) => {
      option.media = [shared[index]!];
    });
    shared.length = 0;
  }
  const distinct = new Set(options.map((option) => JSON.stringify(option.media))).size > 1;
  const card: Card = {
    key: command.decision_id,
    repo,
    ticket: Number(String(command.ticket.identifier).replace(/^#/, '')) || 0,
    decision: command.decision_id,
    title: command.question,
    at: command.created_at,
    mode: distinct ? 'multi' : 'review',
    shared,
    options,
  };
  if (distinct && options.filter((option) => option.label.includes(' / ')).length >= 4) {
    const rows = new Map<string, (Option & { orig: boolean })[]>();
    for (const option of options) {
      const [label, ...rest] = option.label.split(' / ');
      const cells = rows.get(label!) ?? [];
      cells.push({ ...option, orig: rest.join(' / ').trim().toLowerCase().startsWith('orig') });
      rows.set(label!, cells);
    }
    card.mode = 'matrix';
    card.options = [];
    card.rows = [...rows].map(([label, cells]) => ({
      label,
      cells: cells.sort((a, b) => Number(b.orig) - Number(a.orig)),
    }));
    return card;
  }
  if (distinct) {
    card.groups = options.map((option) => ({
      id: option.id,
      label: option.label,
      media: option.media,
      options: [
        { id: 'like', label: 'Like', media: [] },
        { id: 'dislike', label: 'Dislike', media: [] },
      ],
    }));
    card.options = [];
  } else if (options[0]) {
    for (const item of options[0].media) {
      if (!shared.some((existing) => existing.src === item.src)) shared.push(item);
    }
    card.options = options.map((option) => ({ ...option, media: [] }));
  }
  return card;
}
