# Changes from 0x0funky/agent-sprite-forge@5324342fdfab72430f4e9604f3fe427009f8596d (v0.4.0)

The five skills (`codeart2d`, `generate2dmap`, `generate2dmedia`, `generate2dsprite`, `video2dsprite`) are copied
whole. Every markdown file gains `license`, `source` and `modified` front-matter keys. Files with `modified: true`
also gain a first line pointing at Game Maker's Sprite Forge rules in `gm-asset-variants`:

- generate2dsprite/SKILL.md: the rules pointer.
- generate2dmap/SKILL.md: the rules pointer.
- generate2dmedia/SKILL.md: the rules pointer.
- video2dsprite/SKILL.md: the rules pointer.

No other file is changed.
The repository's `docs/`, `shared/`, `src/`, `tests/` and `tools/` are not vendored (each skill ships its own copies
of the shared scripts).

Run the scripts with the Forge venv (`~/.local/share/ogm/forge-venv/bin/python`). Game Maker's rules for using them
(no provider keys, Codex CLI route only, ask before any generation, no paid-pack references) live in the gm skills
that name them, not here.
