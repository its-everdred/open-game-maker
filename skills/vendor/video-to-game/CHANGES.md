# Changes from lovisdotio/video-to-game@d1a24fd8a47576ec4b3c36388b30deda0631def9

Only the study and compare tools are vendored: `scripts/study_video.py` (frames, contact sheet, palette, cuts),
`scripts/side_by_side.py` (a video frame beside a game shot), `scripts/best_window.py` (the liveliest seconds of a
take) and the two references that use them. Each needs `ffmpeg` and `ffprobe` and only the Python standard library.
Every markdown file gains `license`, `source` and `modified` front-matter keys; no file is otherwise changed.

Not vendored: `SKILL.md`, `scripts/fal_asset.py`, `references/fal-assets.md` (fal generation; Game Maker uses packs,
pixelfx and the Codex CLI route instead), `scripts/record_play.mjs`, `references/playtest.md`,
`references/game-loop.md` and `templates/` (Game Maker records builds with `gm run` and `gm shot`).
