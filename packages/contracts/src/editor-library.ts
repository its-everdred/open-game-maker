/**
 * The map maker's asset library (#1210): every placeable piece a game can use, read from the asset card catalog.
 * `GET /api/v1/games/:gameId/editor/library` returns it; thumbnails come from the `thumb` route by card id.
 */

/** One piece in the library. */
export type EditorLibraryItem = {
  /** The asset card id; what a placement names. */
  id: string;
  label: string;
  /** The pack slug (`smallscaleint-2d-hd-zombie-rural-tileset`). */
  pack: string;
  /** The kind chip it sits under (`EditorLibraryGroup.id`). */
  group: string;
  /** The finer word it shares with its siblings (`Tree`, `Wall`, `Wooden fence`). */
  tag: string;
  /** Footprint bucket, only when the card measured one (models). */
  size?: 'small' | 'medium' | 'large';
};

export type EditorLibraryGroup = { id: string; label: string };

export type EditorLibraryPack = { id: string; label: string };

export type EditorLibrary = {
  /** The game's style set (`gm.lock.json` `set`), when it names one. */
  set?: string;
  /** Kind chips in display order; only groups that hold items. */
  groups: EditorLibraryGroup[];
  packs: EditorLibraryPack[];
  items: EditorLibraryItem[];
};
