# OGM Glass prototype

The approved OGM app design as plain HTML: all 60 artboards of the Claude Design canvas
<https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM>, exported 2026-11-27 so workers can open them without the Claude
Design runtime. Unlike the archived prototypes beside it, this one is the live UI reference.

- **Status:** approved. Kevin approved all 11 design cards on 2026-11-26/27, plus the developer-console cards (canvas
  page "Developer console"). Each artboard's canvas title (shown in `index.html`) says whether it restyles a shipped screen (`existing`), is new for the Monday
  launch (`Monday`) or is designed for later (`future`).
- **Spec:** tokens, components, screen-to-route map and tickets are in [`docs/design/ogm-glass/`](../../docs/design/ogm-glass/).

## Use it

Serve from the repository root so pack art in `assets-local/` resolves:

```sh
python3 -m http.server 8000 --bind 127.0.0.1   # from the repo root
# open http://127.0.0.1:8000/prototypes/ogm-glass/
```

`index.html` shows every artboard (phone portrait by canvas page, phone landscape, desktop, system) as a scaled live
frame; click one to open it at full size (390×844, 844×390 or 1440 wide). Artboards link to each other as on the canvas.

Match it exactly: layout, spacing, sizes, colours, type, radii and glass effects. Port `glass.css` classes into shared
components in `apps/web/src/components/` and check each screen with `gm design parity` (core #1449, once it lands) against the artboard
of the same name. Icon buttons keep their words in `aria-label` only.

## Images

- `img/` holds OGM's own art: the GM mark, the Open Game Maker 2000 logo and the Minerals icon.
- Game and pack art (SmallScaleInt sprites and scenes, Dusk Helm, Blobs VS Blocks and Goblin Cellar covers, the title
  town) is not committed. Pages load it from `assets-local/review/design-ogm-glass/img/` (gitignored, on the host and
  in every worker's `assets-local` symlink). Where it is missing, `fallback.js` draws a placeholder of the same size.
  `assets.json` lists every such reference: artboard, local path, source, size.

## Refresh from the canvas

1. With the Artifact tool, read `project/*.dc.html`, `project/glass.css` and `project/canvas.json` from the canvas
   artifact, and fetch any new `/_blob/<id>` assets (`scope: "assets"`).
2. Put the blobs in one folder under the file names in `tools/convert.py` `BLOBS` (add new ids there, with `True` only
   for OGM's own art), then run
   `python3 tools/convert.py <project dir> <blob dir> prototypes/ogm-glass assets-local/review/design-ogm-glass/img`
   and `python3 tools/index.py prototypes/ogm-glass`.
3. Screenshot the changed artboards at their canvas size and compare them with the canvas renders.

`convert.py` drops the Claude Design runtime (`support.js`, `<x-dc>`, the inert `text/x-dc` script), moves each
`<helmet>` into `<head>`, rewrites `.dc.html` links and `/_blob/` URLs, and applies `PATCHES`: the 2026-11-27 global
`.pick` rule in `glass.css` squashed the square A/B choice tiles in `AgentChat`, `ChatA` and `ChatB`, so they get
`height:auto;display:block` back.
