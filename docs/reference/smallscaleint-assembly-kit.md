# SmallScaleInt assembly kit

The private library kit at `assets-local/sets/smallscaleint/kit/` contains an audited index, contact sheets, an assembly guide, recipes, character coverage, and clean and diagnostic renders. Licensed source images and generated media remain in the local library; they are not part of the repository.

The five recipes cover a narrow house, its separately represented interior, a village fragment, a rock-recess entrance and a graveyard fragment. Each is **provisional**: the inspected stills and grid checks do not establish actor-sized movement, door operation, precise collision, or occlusion. The house is four cells long and one cell deep; it is not evidence that the wider house trial works. The village contains a flattened copy of that house; its composition audit detects part drift but not floor-fill or collision drift. The cave uses a rock recess as an entrance; the source piece's intended semantics are not verified.

The local coverage report records source action names and paths for six hero builds, the standalone knight, goblins/orcs and undead. It reports no named lift or throw action for the audited actors; matching an action name does not establish gameplay suitability or visual compatibility. In particular, the top-down goblin/orc sprites still need comparison with the chosen isometric game look.

From the repository root, the kit's `tool/build.mjs` rebuilds the index, contact sheets, coverage and renders using the installed local packs. `tool/check.mjs`, `tool/audit-connectivity.mjs` and `tool/audit-composition.mjs` check schema, declared grid connectivity and the flattened house parts respectively. The guide and inspection notes explain their limits, the earlier failed showcase attempts and remaining visual and gameplay checks.
