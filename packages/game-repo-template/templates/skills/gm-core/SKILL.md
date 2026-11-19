---
name: gm-core
description: Use at the start of every Open Game Maker job in a game repo. Routes to the gm commands and the rest of the gm-* skills.
---

# gm-core

1. Read `.gm/context/bundle.json` for the job's brief. If `.gm/context/bundle.missing` exists instead, ask for the
   game's context in the build chat before changing code.
2. Work in small steps; after each `gm run`, post a still with `gm chat post`.
3. Done means `gm check`, `gm test` and `gm run` are green.
4. For image sizing, follow the no-stretch rule in `gm-ui-hud`.
