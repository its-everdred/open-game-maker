import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { gameManifestSchema } from '@ogm/contracts/game';
import { readControlInputs } from './controls-manifest.js';

/** Validate declared control sets and flag recognizable game-owned controller markup. */
export function checkControls(game: string): string[] {
  let inputs: unknown;
  try {
    inputs = readControlInputs(game);
  } catch {
    return ['manifest: unable to resolve static controls'];
  }
  const parsed = gameManifestSchema.shape.inputs.safeParse(inputs);
  if (!parsed.success) return ['gm.manifest.json: invalid inputs or forbidden self-drawn touch controls'];
  const { actions, controls } = parsed.data;
  const errors: string[] = [];
  if (!controls?.gameplay) errors.push('gm.manifest.json: inputs.controls must declare a gameplay set');
  for (const [name, set] of Object.entries(controls ?? {})) {
    const needStick = set.layout !== 'tap';
    if (needStick && (!set.stick || actions[set.stick] !== 'stick'))
      errors.push(`inputs.controls.${name}: stick ${set.stick ?? '(missing)'} must name a stick action`);
    if (set.layout === 'tap' && (set.stick || set.secondStick))
      errors.push(`inputs.controls.${name}: tap layout cannot include sticks`);
    if (set.layout !== 'two-stick' && set.secondStick)
      errors.push(`inputs.controls.${name}: secondStick requires two-stick layout`);
    if (set.layout === 'two-stick' && set.stick === set.secondStick)
      errors.push(`inputs.controls.${name}: stick actions must differ`);
    if (set.layout === 'two-stick' && (!set.secondStick || actions[set.secondStick] !== 'stick'))
      errors.push(`inputs.controls.${name}: secondStick must name a stick action`);
    const seen = new Set<string>();
    for (const button of set.buttons) {
      if (actions[button.action] !== 'button')
        errors.push(`inputs.controls.${name}: ${button.action} must name a button action`);
      if (seen.has(button.action)) errors.push(`inputs.controls.${name}: duplicate button ${button.action}`);
      seen.add(button.action);
    }
  }
  const scanFile = (file: string): void => {
    const source = readFileSync(file, 'utf8');
    // These patterns catch common markup and prompts; source scanning cannot prove a canvas is control-free.
    if (
      /(?:class(?:Name)?\s*[:=]\s*["'`][^"'`]*|\.)(?:virtual[-_]?(?:joystick|gamepad|dpad)|touch[-_]?(?:controls?|buttons?|joystick|dpad|pad)|ctl[-_]?(?:pad|btn)|on[-_]?screen[-_]?(?:controls?|controller|gamepad))\b/iu.test(
        source,
      ) ||
      /data-role\s*=\s*["']controls["']/iu.test(source) ||
      /\bid\s*=\s*["']touch["'][\s\S]*?\bdata-key\s*=/iu.test(source) ||
      /(?:class(?:Name)?\s*[:=]\s*["'`][^"'`]*|\.)(?:left|right|up|down|jump|attack)[-_](?:button|btn|control)\b/iu.test(
        source,
      ) ||
      /data-(?:action|key)\s*=\s*["'](?:move[-_]?)?(?:left|right|up|down|jump|attack)["']/iu.test(source) ||
      /\b(?:draw|render|create)(?:Virtual|Touch|OnScreen)(?:Button|Joystick|Dpad|Pad)\s*\(/u.test(source) ||
      /["'`](?:tap|hold|mash|press)\s+[a-z](?=[!?."'`])/iu.test(source)
    )
      errors.push(`${relative(game, file)}: game-owned on-screen controller detected`);
  };
  const scan = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'test', 'tests', '__tests__'].includes(entry.name))
        continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|html|css)$/u.test(entry.name)) scanFile(file);
    }
  };
  for (const entry of readdirSync(game, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      /\.(?:[cm]?[jt]sx?|html|css)$/u.test(entry.name) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)
    )
      scanFile(join(game, entry.name));
  }
  scan(join(game, 'src'));
  scan(join(game, 'public'));
  return errors;
}
