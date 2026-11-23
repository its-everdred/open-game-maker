/**
 * The app shell owns the top-right menu button and its pause sheet, so every game shows the same one (#1294). A game
 * adds entries through the SDK (settings, game options) and never draws or restyles that menu itself.
 */

/** A hamburger glyph, or a control named as a menu for assistive tech (`aria-label="Menu"`, `ariaLabel = 'Game menu'`). */
const OWN_MENU = [
  /☰|\\u2630|&#9776;|&#x2630;/iu,
  /(?:aria-label|ariaLabel)["']?\s*[,:=]\s*["'`](?:open |game |pause )?menu["'`]/iu,
];

export type BundleFile =
  { fileName: string; type: 'chunk'; code: string } | { fileName: string; type: 'asset'; source: unknown };

/** Throw when the manifest restyles the shell's menu button or the built game draws a menu of its own. */
export function assertNoGameMenu(manifest: object, bundle: Record<string, BundleFile>): void {
  if ('playMenuButton' in manifest)
    throw new Error(
      'gm.manifest.json: remove playMenuButton; the app shell draws the same top-right menu button for every game',
    );
  for (const file of Object.values(bundle)) {
    if (!/\.(?:js|mjs|html|css)$/u.test(file.fileName)) continue;
    const text =
      file.type === 'chunk'
        ? file.code
        : typeof file.source === 'string'
          ? file.source
          : file.source instanceof Uint8Array
            ? new TextDecoder().decode(file.source)
            : '';
    if (OWN_MENU.some((pattern) => pattern.test(text)))
      throw new Error(
        `${file.fileName}: the game draws its own menu control; the app shell owns the top-right menu, so add entries ` +
          'through the SDK instead',
      );
  }
}
