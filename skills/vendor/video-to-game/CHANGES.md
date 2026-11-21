# Changes from lovisdotio/video-to-game@d1a24fd8a47576ec4b3c36388b30deda0631def9

Only the study and compare tools are vendored: `scripts/study_video.py` (frames, contact sheet, palette, cuts),
`scripts/side_by_side.py` (a video frame beside a game shot), `scripts/best_window.py` (the liveliest seconds of a
take) and the two references that use them. Each needs `ffmpeg` and `ffprobe` and only the Python standard library.
Every markdown file gains `license`, `source` and `modified` front-matter keys; no file is otherwise changed.

- references/fal-assets.md: added 2026-11-21 for the fal 3D bake-off arms, with a project-rules note on top; the
  upstream text below it is unchanged.

Not vendored: `SKILL.md` and `scripts/fal_asset.py` (fal generation for every asset, with its own client; Game Maker
uses packs, pixelfx and the Codex CLI route, and its fal 3D arms run through `gm-sprite-forge/scripts/fal3d.py`), `scripts/record_play.mjs`, `references/playtest.md`,
`references/game-loop.md` and `templates/` (Game Maker records builds with `gm run` and `gm shot`).
