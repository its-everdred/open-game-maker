---
name: gm-build
description: Install and build a Game Maker repo inside the network-off sandbox.
---

# Build offline

1. From the instance repository root, run `pnpm install --offline`. After `gm new` this refreshes `pnpm-lock.yaml`, so
   commit the change; later installs add `--frozen-lockfile`.
2. Run `gm build`; when asset targets are needed, run `gm build assets --tier mobile,desktop`. `gm build` fails naming
   `dist/manifest.json` or `dist/design/design.json` when either is missing or invalid: fix `src/manifest.ts` or
   `design/*.json` (a key defined in two design files fails the build).
3. Read the build output from `dist/` and the resolved asset inventory from `assets/manifest.json`.
   Lazy groups have separate mobile and desktop byte budgets, configurable in `.gm/game.json` under `budgets.lazy`.
4. Run the `gm-core` done gates before handing off.

The sandbox has no package-registry network. Never run `npm install` or `pnpm add`, and never weaken offline or
lockfile enforcement. If a required dependency is absent, ask an aiur native question with the package name, exact version, and reason.
Wait for the operator to add it to the seeded store and lockfile; do not substitute an unpinned package.

`ERR_PNPM_NO_OFFLINE_META` or a missing tarball means the seeded store lacks the exact locked package. Report the
package and version from the error and ask for the store to be reseeded. Retrying with network access is not a fix.
