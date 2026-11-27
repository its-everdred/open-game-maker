const details = [
  'Spacing and alignment',
  'Corner radii',
  'Glass blur, opacity and tint',
  'Borders and hairlines',
  'Shadows and glows',
  'Gradients and highlights',
  'Typography: family, size, weight, tracking and line height',
  'Icon glyphs, sizes and strokes',
  'Safe areas',
  'Pressed, disabled, loading, empty, error and focus states',
  'Motion: duration and easing',
];

/** A reviewer fills in each crop and checks it only after inspecting the result. */
export function glassChecklist(screen: string): string {
  return `# ${screen} detail review\n\n${details.map((detail) => `- [ ] ${detail} — crop: _required_`).join('\n')}\n`;
}
