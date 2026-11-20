export type PrototypeReviewContent = {
  disposition: 'review' | 'none' | 'missing';
  works: string[];
  limitations: string[];
  decisionIds: string[];
};

type ParsedReview = {
  disposition: 'review' | 'none' | 'missing';
  works: string[];
  limitations: string[];
  decisionIds: string[];
};

function list(value: string): string[] {
  return value
    .split(/\s*[,;]\s*|\s*[•]\s*|\s*\n\s*[-*]\s*/u)
    .map((item) => item.trim().replace(/^[-*]\s*/u, ''))
    .filter((item) => item && !/^none\.?$/iu.test(item));
}

export function parsePrototypeReview(body: string): ParsedReview {
  if (/^\s*Prototype review:\s*none\s*$/imu.test(body))
    return { disposition: 'none', works: [], limitations: [], decisionIds: [] };
  const heading = /^##\s+Prototype review\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/imu.exec(body);
  if (!heading) return { disposition: 'missing', works: [], limitations: [], decisionIds: [] };
  const section = heading[1]!;
  const field = (name: string) => {
    const expression = new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.*(?:\\n(?!\\*\\*|Play:|Clip:)[^\\n]*)*)`, 'imu');
    return expression.exec(section)?.[1]?.trim() ?? '';
  };
  return {
    disposition: 'review',
    works: list(field('Works now')),
    limitations: list(field('Known limitations')),
    decisionIds: list(field('Weigh in on')).map((id) => id.replace(/^#/, '')),
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
  return {
    disposition: parsed.some((item) => item.disposition === 'missing') ? 'missing' : 'review',
    works: [...new Set(visible.flatMap((item) => item.works))],
    limitations: [...(visible.at(-1)?.limitations ?? [])],
    decisionIds: [...new Set(visible.flatMap((item) => item.decisionIds))].slice(0, 6),
  };
}
