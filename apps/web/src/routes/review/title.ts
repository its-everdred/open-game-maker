// A review's title is a short topic (#594). Aiur hands over the Command's short summary when it has one and the whole
// question when it does not, so a title past a few words keeps its first five; the question stays below the deck.
const TITLE_WORDS = 5;
const TITLE_CHARS = 28;

export function reviewTitle(title: string): string {
  const trimmed = title.trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= TITLE_WORDS && trimmed.length <= TITLE_CHARS) return trimmed;
  let short = words.slice(0, TITLE_WORDS).join(' ');
  if (short.length > TITLE_CHARS) short = short.slice(0, TITLE_CHARS).replace(/\s+\S*$/, '');
  return `${short.replace(/[\s,.;:!?…-]+$/, '')}…`;
}
