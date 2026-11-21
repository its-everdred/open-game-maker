# Changes from danielwh2/sprite-stacking@6fecdfd0d6e5a0595f979550e05f4b1fcde550fe

Upstream: https://github.com/danielwh2/sprite-stacking (MIT, Daniel White). The skill folder and `tests/check.py` keep
their upstream layout, so `python3 tests/check.py` runs unchanged from this folder. The code needs Python 3 with Pillow and NumPy
and touches no network; `scripts/viewer.html` is a standalone page with no external requests.

`SKILL.md` and `references/engines.md` gain `license`, `source` and `modified` front-matter keys, and
`views_to_slices.py` loses its executable bit; no file is otherwise changed.

Not vendored: `README.md` (install through `npx skills add`), `media/` (a 3 MB demo GIF and a diagram) and `.gitignore`.
