# Vendored skills

Reference skills for Phaser 4.2 and three.js r186, and three art and design tool sets, copied at pinned commits
(`skills.lock`):

- `anykit/`: AnyKit prop-kit method (MIT): Tripo and Meshy image-to-3D on fal, pick per item, normalise; its fal client is replaced by `gm-sprite-forge/scripts/fal3d.py`.
- `anymachine/`: AnyMachine reference-based Blender prop and machine method (MIT), with asset-specific check examples.
- `phaser/`: the 28 official Phaser skills (`phaserjs/phaser`, MIT).
- `threejs/`: 11 CloudAI-X three.js skills (MIT); `threejs-react-three-fiber` and `threejs-asset-pipeline` are left out.
- `gamedev/`: 17 awesome-gamedev skills (Apache-2.0) with every code block rewritten to TypeScript.
- `sprite-forge/`: the five Sprite Forge skills (`0x0funky/agent-sprite-forge` v0.4.0, MIT) with their Python scripts.
- `video-to-game/`: the clip study and compare scripts of `lovisdotio/video-to-game` (MIT), and its fal asset guide for the 3D arms.
- `sprite-stacking/`: the sprite-stacking skill (`danielwh2/sprite-stacking`, MIT): four orthographic pixel views carved into
  a spinnable fake-3D slice strip, with its slicer, viewer and self-check.
- `impeccable/`: Impeccable frontend design skill (`pbakaus/impeccable` 4.9.2, Apache-2.0).
- `frontend-design/`: Anthropic's frontend-design skill (`anthropics/claude-plugins-official` 1.1.1, Apache-2.0).

The engine sets hold text only. `sprite-forge/`, `video-to-game/`, `sprite-stacking/`, `impeccable/`, `anymachine/` and `anykit/` ship scripts; the gm skill that names a tool
holds the rules for running it (no provider keys; fal only on the NUC host through the gm-sprite-forge ledger), and
those rules win over the vendored text.

Each adapted skill file's front matter names its `license`, `source` (repo, commit, path) and whether it was `modified`; impeccable's upstream reference files retain their original form. Each set's
`CHANGES.md` lists the modified files. `@ogm/tools-skills` checks that every class and method the code blocks name
exists in the pinned `phaser` and `three` packages. It proves names, not signatures.

To refresh a set, open a PR that re-copies it at the new commit, updates `skills.lock` and every `source:` line, and
passes `pnpm --filter @ogm/tools-skills test` and `pnpm --filter @ogm/tools-skills check-api-names`.
