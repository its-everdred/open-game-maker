# Archived prototypes

These prototypes are frozen; do not port them into production code. Read their write-ups, then use the maintained replacements.

## `ogm-glass` (live, not archived)

Approved OGM UI: [`ogm-glass/`](ogm-glass/) (open `index.html`); match it exactly. It is refreshed from the Claude Design canvas, never edited by hand; see its README.

## `studio-v0`

The studio prototype proved the title-to-library-to-editor loop, visual language, build tracker, and deploy shape. Its detailed notes remain in [`studio-v0/README.md`](studio-v0/README.md). The product and deploy flow now live in `apps/web` and `apps/web/tools/deploy.sh`.

## `ui-v0`

The UI prototype proved the home-to-editor-to-play loop and deterministic game hooks. Its findings are in [`docs/research/v0.5/C1-ui-prototype-learnings.md`](../docs/research/v0.5/C1-ui-prototype-learnings.md). `apps/web` replaces the interface, and `packages/sdk` (`@gm/sdk`) owns the game hooks.

## `title-city`

The title-city prototype proved the castle-town look and its mobile loading pipeline. The write-up is [`docs/research/v0.5/C4-mobile-asset-pipeline.md`](../docs/research/v0.5/C4-mobile-asset-pipeline.md). Its history-preserving source is now `apps/web/title-town`, which builds the asset served from `apps/web/public/town`.

## Capture tools

The prototype-only capture scripts are superseded by OGM-090's `@ogm/gm-verify` commands: `gm run`, `gm shot`, and `gm perf`. The copies under `apps/web/title-town/tools` remain only for maintaining the town.
