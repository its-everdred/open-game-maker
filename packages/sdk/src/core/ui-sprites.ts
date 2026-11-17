/** A visible canvas UI sprite's bounds in game-frame CSS pixels. */
export type UiSpriteBounds = {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  overlayAllowed?: boolean;
};

/** Provide current sprite bounds to the play-area verification gate. Returns a cleanup function. */
export function reportUiSprites(getSprites: () => UiSpriteBounds[]): () => void {
  const target = window as unknown as { __gmUiSprites?: () => UiSpriteBounds[] };
  target.__gmUiSprites = getSprites;
  return () => {
    if (target.__gmUiSprites === getSprites) delete target.__gmUiSprites;
  };
}
