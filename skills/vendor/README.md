# Vendored skills

Reference skills for Phaser 4.2 and three.js r186, and three art and design tool sets, copied at pinned commits
(`skills.lock`):

- `phaser/`: the 28 official Phaser skills (`phaserjs/phaser`, MIT).
- `threejs/`: 11 CloudAI-X three.js skills (MIT); `threejs-react-three-fiber` and `threejs-asset-pipeline` are left out.
- `gamedev/`: 17 awesome-gamedev skills (Apache-2.0) with every code block rewritten to TypeScript.
- `sprite-forge/`: the five Sprite Forge skills (`0x0funky/agent-sprite-forge` v0.4.0, MIT) with their Python scripts.
- `video-to-game/`: only the clip study and compare scripts of `lovisdotio/video-to-game` (MIT).
- `frontend-design/`: Anthropic's frontend-design skill (`anthropics/claude-plugins-official` 1.1.1, Apache-2.0).

The engine sets hold text only. `sprite-forge/` and `video-to-game/` ship scripts; the gm skill that names a tool
holds the rules for running it (no provider keys, ask before any generation), and those rules win over the vendored
text.

Each file's front matter names its `license`, `source` (repo, commit, path) and whether it was `modified`; each set's
`CHANGES.md` lists the modified files. `@ogm/tools-skills` checks that every class and method the code blocks name
exists in the pinned `phaser` and `three` packages. It proves names, not signatures.

To refresh a set, open a PR that re-copies it at the new commit, updates `skills.lock` and every `source:` line, and
passes `pnpm --filter @ogm/tools-skills test` and `pnpm --filter @ogm/tools-skills check-api-names`.
