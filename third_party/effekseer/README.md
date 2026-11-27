# Effekseer for WebGL 1.80.8

The web runtime behind `@gm/sdk/vfx`. It is MIT licensed (`LICENSE`).

The files come from `EffekseerForWebGL1.80.8.zip` in the Effekseer 1.80.8 release:
https://github.com/effekseer/Effekseer/releases/tag/1808.

The zip's SHA-256 is `cf52e634f7db0c46d925561341170b0c44cfb33b3299c852ee72018e18fce57e`, which matches the release's
`SHA256SUMS`. The files are unmodified:

| File | SHA-256 |
|---|---|
| `effekseer.min.js` | `c6017f840e847f58cabb224f69f004cbbc356575a39815099658b9d411261b4a` |
| `effekseer.wasm` | `e899ff40128799e42d01b352e3e9858297303d11d5a9ec7e71cd2c41f890bdf6` |

`effekseer.d.ts` is the release's full API. The SDK bundles the script as a module through
`packages/sdk/scripts/effekseer-runtime.mjs`.
