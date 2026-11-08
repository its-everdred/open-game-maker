# Ticket roles

Every game ticket carries `game:<slug>` and one or more `role:*` labels. aiur inlines each label's mandatory skills at
the start of the ticket (`agent.skills.by_label`), so the labels decide what the worker knows before it reads a file.
Pick roles by the work the ticket does; a ticket that spans two kinds of work gets both.

This table is the one source: `gm skills config` prints the aiur config from it, the builder writes it into each game
daemon's config, and `gm plan check` refuses a ticket whose roles are not in it.

| Label | Work | Mandatory skills |
|---|---|---|
| `role:visual` | screens, HUD, menus, look and layout | gm-core, gm-verify, gm-ui-hud, gm-image-mock |
| `role:3d` | models, scenes, cameras and 3D assets | gm-core, gm-3d, gm-verify |
| `role:gameplay` | rules, controls, entities and game feel | gm-core, gm-input, gm-verify, gm-qa |
| `role:audio` | music, sound effects and voice | gm-core, gm-audio, gm-voiceover |
| `role:qa` | playtests, journeys and verification | gm-core, gm-qa, gm-verify |
| `role:multiplayer` | rooms, shared state and netcode | gm-core, gm-multiplayer-ready, gm-qa |
| `role:game-design` | scope, flow, plans and creator options | gm-core, gm-new-game-design, gm-new-game-plan, gm-image-mock, gm-scope-options |
| `role:assets` | pack adapters, variants and showcases | gm-core, gm-asset-variants, gm-pack-adapter, gm-asset-showcase |

## The game label

`game:<slug>` maps to `gm-core` and the set skill `gm-set-<set>`, where `<set>` is the `set` in
`games/<slug>/gm.lock.json` (a game with no set gets `gm-core` alone). It carries game-wide context only; the work
skills come from the roles.

## Everything else is on demand

Skills outside a ticket's mandatory set are found with `gm skills search <words>` and read with
`gm skills show <name>`. That catalog is for discovery; it never replaces the inlined set.
