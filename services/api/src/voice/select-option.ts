// The option a spoken choice names: its id or label exactly, or the one option that matches ignoring case.
export function selectedOption<T extends { id: string; label: string }>(available: T[], choice: string): T | null {
  const exact = available.find(({ id, label }) => id === choice || label === choice);
  if (exact) return exact;
  const folded = choice.toLocaleLowerCase();
  const matches = available.filter(
    ({ id, label }) => id.toLocaleLowerCase() === folded || label.toLocaleLowerCase() === folded,
  );
  return matches.length === 1 ? matches[0]! : null;
}
