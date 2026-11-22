# Scene model for the map maker (#1207)

Part of the map maker epic (#1191). This note picks how a scene is stored, revised and handed between Kevin and the
agents. The code ships with it: `packages/contracts/src/scene.ts` (schema), `packages/design-log/src/scene.ts` and
`scene-migrate.ts` (revisions, rebase, conflicts, migrations) and `gm scene pull` / `gm scene push` (`packages/gm-cli/src/commands/scene/`).

## What exists today

- **Dusk Helm scenes are TypeScript.** `games/dusk-helm/src/features/*/map.ts` builds a Tiled-style iso map (`floor`,
  `wall`, `decor`, `roof` tile layers and a `spawns` object layer) that `@gm/pack-smallscaleint`'s `IsoMap` renders.
  Nothing but a code edit can change one, and an agent rewrites the whole file each round.
- **The design log** (`packages/design-log`, `packages/contracts/src/design-log.ts`, `services/api/src/design/`) stores
  editor transactions for 3D scenery: immer patches over `{ globals, entities }`, a branch `headRev`, `baseRev` on every
  write (a stale write is refused with `StaleBaseRev`), an edit lease and a `buildId`. `reduce` folds transactions into a
  working set that `reapply` carries onto the next build. Its `actor` is a user id; it does not say whether the change
  came from Kevin or an agent, from the editor or the CLI.
- **Branches and releases** (`branches.ts`, `releases.ts`) fork and merge design-log branches per game.

What is missing: a game-agnostic scene document (tile layers, placed objects, HD-2D settings), the author and source of
each change, and a rule that keeps an agent from overwriting Kevin's edits.

## Prior art

- **Tiled (TMX/JSON):** layers of gid arrays plus object groups; tile identity lives in tilesets. Compact for the
  runtime, but a gid array has no per-cell identity, so two writers' edits to one layer cannot be told apart.
- **LDtk:** a JSON project with levels, typed layer instances, entity instances with stable `iid`s and a
  `jsonVersion` that the editor migrates on open. Stable ids per placed thing and explicit versioned migrations are the
  two ideas worth taking.
- **CRDTs (Automerge, Yjs):** merge any concurrent edits automatically and keep full history. They resolve conflicts by
  a fixed rule (last writer by logical clock), so "Kevin always wins" would be a layer on top, and they carry per-field
  metadata that a JSON file in a game repo should not. Our writers are one creator and agents taking turns, not peers
  editing offline at once.
- **Revision + rebase (Git, the design log's `baseRev`):** a linear log with a server-ordered head. A writer names the
  revision it started from; the store replays its changes on the current head and decides each clash with an explicit
  policy.

## Recommendation: a unit-level revision log with creator precedence

One scene is one JSON document plus a linear revision log. No CRDT.

**Document (`SceneDoc`, schema version 1).** `game`, `scene`, `packAdapter` id, `layers` (each `tiles` or `objects`,
with an `order`), `objects` keyed by id (asset ref, layer, pose, rotation, facing, flip, props) and an `hd2d` block
(`lighting`, `focus`, `atmosphere`, `occlusion`, `particles`, whose settings follow the HD-2D core schemas from
#1172–#1174 and are validated with them by `gm scene`). Tiles live in their layer keyed by cell (`"x,y"`), so every
painted cell has its own identity without a gid array. Ids are short readable slugs, because agents write this file.

**Units.** Merging and locking work on units, not on the whole file: `meta` (the pack adapter id), each layer's own
settings, each tile cell, each object, and each HD-2D section. A unit is the smallest thing Kevin would think of as
"mine": the tree he moved, the cell he painted, the light rig he tuned.

**Revisions.** Every write appends a `SceneRevision`: `rev`, `parentRev` (the head it was applied on), `baseRev` (what
the writer started from), `author` (`kevin` or `agent:<ticket>`), `source` (`editor`, `cli`, `migration`), a label, a
timestamp, the unit changes with their before and after values, and the hash of the resulting document. The before
values let the store rebuild any earlier revision from the head. A write appends to the log, then replaces the head;
the head is the commit point, so a revision logged past it (a write that stopped between the two, even mid-line) is
dropped on the next read, and a log with no head at all is discarded.

**Ownership.** When a creator revision changes a unit, the unit gets `lockedBy: "creator"` (objects, tile cells, layers
and HD-2D sections carry the field; a locked layer covers its tiles and objects). Agents can never set or clear it.

**Rebase and conflicts.** A push names its `baseRev`. The store diffs the pushed document against that base unit by
unit, then applies the changes on the current head:

- a unit Kevin has locked (or one inside a locked layer) refuses any agent change, even if Kevin touched it before the
  agent's base;
- a unit someone else changed after the base, to a different value, refuses the change (stale);
- a tile or object left in a layer that is gone (one writer deleted the layer while another added to it) goes with the
  layer when Kevin deleted it, brings the layer back (locked) when an agent deleted it and Kevin's stale save edits
  inside it, and refuses the agent's change otherwise;
- anything else applies, and a stale base rebases silently.

If any change is refused, the whole push is refused with a list of conflicts naming each unit, why, and Kevin's value.
The agent pulls again and redoes its change around his. Creator revisions are never refused; Kevin's edit wins. So the
head after Kevin saves is always what the next agent turn starts from.

**Migrations.** `schemaVersion` is checked on every read; `migrateScene` runs each registered step in order up to the
current version, and the store records the upgrade as a `migration` revision. A migration must be lossless (the tests
round-trip a sample scene through one).

**Pack adapters.** Pack rules stay out of the document. `ScenePackAdapter` (in contracts) declares an asset's drawn
facings and placement kind (cell, edge, free), snapping, brushes and an autotile hook. The document only names the
adapter; #1208 implements SmallScaleInt's.

## Storage

The revision rules live in `@ogm/design-log` as pure functions (`commitScene`, `diffScene`, `migrateScene`) over a
`SceneStore`-shaped head and log, so the API can reuse them. This ticket ships a file store in the game's folder, which
the game builds from and which the agent commits:

- `scenes/<scene>.scene.json`: the head (`rev` and `doc`);
- `scenes/<scene>.revs.jsonl`: the revision log, one revision per line.

`gm scene pull <game> <scene>` writes a working copy to `.gm/scenes/<game>/<scene>.json` (`baseRev` and `doc`); the
agent edits its `doc` and runs `gm scene push <game> <scene>`, which commits as `agent:<ticket>` from the `cli` source,
rebases, or prints the conflicts and exits non-zero. A push takes a lock file so two pushes cannot interleave.

Not in this ticket: the editor (#1209) saving Kevin's edits. It calls the same `commitScene` with `author: kevin` and
`source: editor`. When the editor needs the scene shared through the API instead of the game repo, a `scene_revisions`
table implements the same head-and-log shape; the rules do not change.

## Why not extend design-log transactions

Design-log transactions patch 3D entity props against a build, under a lease, and `reapply` carries them onto the next
build. A scene document is the source itself, not an override on a build, and its writers take turns without a lease.
Folding scenes into `{ globals, entities }` would lose tile layers and per-unit locks, and would make every scene write
depend on a build id. The scene log reuses the design log's ideas (`baseRev`, canonical JSON, content hashes) and its
`canonical` and `sha256Canonical` helpers, but keeps its own document.
