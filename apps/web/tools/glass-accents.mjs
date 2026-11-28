// Chat and working share the approved blue. Neutral control variants carry no accent.
const accents = {
  go: 'green',
  create: 'yellow',
  warn: 'orange',
  'needs-you': 'orange',
  info: 'blue',
  working: 'blue',
  chat: 'blue',
  live: 'purple',
  agents: 'purple',
  danger: 'red',
  'danger-ink': 'red',
  focus: 'aqua',
};

export function accentForName(name) {
  return Object.hasOwn(accents, name) ? accents[name] : undefined;
}

export function accentsInCss(value) {
  return [...value.matchAll(/var\(\s*--ogm-role-([a-z-]+)\b/g)].map((match) => accentForName(match[1])).filter(Boolean);
}
