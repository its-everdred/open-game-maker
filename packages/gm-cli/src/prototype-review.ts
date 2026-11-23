import { SCENARIO_NAME } from '@ogm/contracts';

export type PrototypeReviewContent = {
  disposition: 'review' | 'none' | 'missing';
  works: string[];
  limitations: string[];
  decisionIds: string[];
  /** The scenario the Play link starts in, which the published review embeds as a playable slice (#1281). */
  scenario?: string;
};

type ParsedReview = PrototypeReviewContent;

/** The `scenario=` of a review's Play link (`Play: <link>` or `**Play:** <link>`), when it names a valid one. */
export function playScenario(section: string): string | undefined {
  const link = /^\s*(?:\*\*)?Play:(?:\*\*)?\s*(\S+)/imu.exec(section)?.[1];
  if (!link) return undefined;
  let scenario: string | null;
  try {
    scenario = new URL(link, 'https://app.invalid').searchParams.get('scenario');
  } catch {
    return undefined;
  }
  return scenario && SCENARIO_NAME.test(scenario) ? scenario : undefined;
}

function list(value: string): string[] {
  return value
    .split(/\s*[,;]\s*|\s*[•]\s*|\s*\n\s*[-*]\s*/u)
    .map((item) => item.trim().replace(/^[-*]\s*/u, ''))
    .filter((item) => item && !/^none\.?$/iu.test(item));
}

/** Workers often give a reason: `Prototype review: none (mock images only; no playable change)` (#880). */
export function waivesPrototypeReview(body: string): boolean {
  return /^\s*Prototype review:\s*none\b.*$/imu.test(body);
}

export function parsePrototypeReview(body: string): ParsedReview {
  if (waivesPrototypeReview(body)) return { disposition: 'none', works: [], limitations: [], decisionIds: [] };
  const heading = /^##\s+Prototype review\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/imu.exec(body);
  if (!heading) return { disposition: 'missing', works: [], limitations: [], decisionIds: [] };
  const section = heading[1]!;
  const field = (name: string) => {
    const expression = new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.*(?:\\n(?!\\*\\*|Play:|Clip:)[^\\n]*)*)`, 'imu');
    return expression.exec(section)?.[1]?.trim() ?? '';
  };
  const scenario = playScenario(section);
  return {
    disposition: 'review',
    works: list(field('Works now')),
    limitations: list(field('Known limitations')),
    decisionIds: list(field('Weigh in on')).map((id) => id.replace(/^#/, '')),
    ...(scenario ? { scenario } : {}),
  };
}

/** Merge review summaries in merge order; the latest limitations list is the current build's truth. */
export function mergePrototypeReviews(reviews: readonly string[]): PrototypeReviewContent {
  const parsed = reviews.map(parsePrototypeReview);
  if (!parsed.some((item) => item.disposition === 'review')) {
    return {
      disposition: parsed.length === 0 || parsed.some((item) => item.disposition === 'missing') ? 'missing' : 'none',
      works: [],
      limitations: [],
      decisionIds: [],
    };
  }
  const visible = parsed.filter((item) => item.disposition === 'review');
  const scenario = [...visible].reverse().find((item) => item.scenario)?.scenario;
  return {
    disposition: parsed.some((item) => item.disposition === 'missing') ? 'missing' : 'review',
    works: [...new Set(visible.flatMap((item) => item.works))],
    limitations: [...(visible.at(-1)?.limitations ?? [])],
    decisionIds: [...new Set(visible.flatMap((item) => item.decisionIds))].slice(0, 6),
    ...(scenario ? { scenario } : {}),
  };
}
