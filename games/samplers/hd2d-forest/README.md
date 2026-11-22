# HD-2D forest sampler

The Dusk Helm forest clearing from the approved open-games #878 mocks, rebuilt in Phaser 4 to prove the core HD-2D
modules on real pack art. Lighting, focus and particles come only from `packages/sdk/src/hd2d` (imported by path until
`@gm/sdk/hd2d` ships); nothing here reimplements them.

- Presets: Golden shafts, Soft daylight and Amber canopy: short sun shafts that come and go at random places, lengths
  and brightness (only some reach the ground and light a patch there), shown only in this forest's clear or partly
  cloudy weather; drifting cloud shadows with sunny patches between, a light canopy dapple, plus a flickering campfire
  light.
- Hero: lit through a normal map generated from its alpha; every other sprite uses the flat default.
- Low tier (`quality=low`): keeps the focus blur and lights only the hero and the sprites the campfire reaches; the rest
  are drawn flat at the same ambient.
- Focus: depth bands with the hero crisp. The scene is grouped into six bands by isometric row so far rows blur while
  draw order stays correct.
- Particles: pixel leaves on the breeze that sways the trees, soft motes in the brightest shaft, embers over the
  campfire.

URL parameters: `preset=golden|daylight|amber`, `lighting=0`, `focus=0`, `particles=0`, `quality=low|high`,
`weather=clear|partly-cloudy|overcast|rain` (shafts show only in the first two).

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
