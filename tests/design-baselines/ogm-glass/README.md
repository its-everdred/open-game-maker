# OGM Glass references

These are lossless PNG conversions of the design agent's approved JPEG artboard exports. The canvas could not be opened by the headless web tool, so these exports are the fallback. They are retained at their native pixel dimensions: phone portrait exports are 780 × 1688 (390 × 844 at 2×), while the landscape and desktop exports use their own native dimensions. The manifest records the SHA-256 of each original JPEG.

Regenerate from the approved export directory at the repository root:

```sh
node apps/web/tools/import-glass-exports.mjs assets-local/review/design-ogm-glass
```

The exports do not provide a separate landscape artboard for every screen. Do not resize a portrait export and call it a landscape reference; obtain a render of the approved layout at that viewport first. These files alone do not implement or satisfy the parity gate.
