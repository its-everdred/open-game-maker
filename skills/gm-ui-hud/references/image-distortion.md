# Image distortion

Never scale an image non-uniformly. Use a 9-slice (`border-image` with the art's slice insets) or separate corners,
edges, and centre for frames, buttons, and panels that must fit multiple sizes. For a new shape, generate a new asset
at the slot's exact aspect ratio, state its pixel size in the image-generation prompt, save it under its own name,
and mark it AI-generated as usual. Do not force an existing image into the new slot. Include the distortion gate's
output in the verify checklist.

For canvas or WebGL UI sprites, use the draft-only `@gm/sdk/debug` image-draw helpers: call `beginImageDraws()` at the
start of each UI frame and `reportImageDraw({ id, file, source: { width, height }, drawn: { width, height } })` for
each visible sprite. Draw dimensions are CSS pixels. The capture reads `window.__gm.imageDraws()`; world textures do
not need reports. Call `beginImageDraws()` even on frames with no UI sprites so the gate can distinguish an empty frame
from missing instrumentation. For WebGL UI, use a separate canvas with a unique DOM id, include that id as `canvasId`
in each report, and draw sprites as quads; mark world-only canvases with
`data-gm-world-canvas="true"`. Keep this instrumentation out of published builds.

