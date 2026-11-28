const screens = ['Title', 'Home', 'Editor', 'Settings', 'SignIn', 'NewGame', 'GameSheet', 'Admin', 'Activity'];

/** Parse the selected screen set; an absent selection leaves ordinary browser runs unchanged. */
export function paritySelection(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set();
  if (value === 'all') return new Set(screens);
  const selected = value.split(',');
  if (selected.some((screen) => !screens.includes(screen))) throw new Error(`Unknown glass parity screen: ${value}`);
  return new Set(selected);
}
