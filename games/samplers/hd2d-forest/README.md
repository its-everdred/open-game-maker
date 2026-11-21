# HD-2D forest sampler

The Dusk Helm forest clearing from the approved open-games #878 mocks, rebuilt in Phaser 4 to prove the core HD-2D
modules on real pack art. Lighting and focus come only from `packages/sdk/src/hd2d` (imported by path until
`@gm/sdk/hd2d` ships); nothing here reimplements them.

- Presets: Golden shafts, Soft daylight and Amber canopy: soft shafts and dapple, plus a flickering campfire light.
- Hero: lit through a normal map generated from its alpha; every other sprite uses the flat default.
- Focus: depth bands with the hero crisp. The scene is grouped into six bands by isometric row so far rows blur while
  draw order stays correct.
- Particles: the button is disabled until the core particle backends (#1174, #1178) land.

URL parameters: `preset=golden|daylight|amber`, `lighting=0`, `focus=0`, `quality=low|high`.

Builds without the licensed pack (published mode, CI) draw stand-in shapes. For the real art, run these from this
directory:

```sh
pnpm prepare:assets -- --assets-root ../../../assets-local
pnpm exec vite build --mode test
pnpm exec vite preview --host 127.0.0.1
pnpm capture -- --url http://127.0.0.1:4173/ --out ../../../assets-local/review/1149
```

Copied media and captures stay under ignored `assets-local/` paths: this repository is public, so never commit them
or attach them to an issue or pull request.
