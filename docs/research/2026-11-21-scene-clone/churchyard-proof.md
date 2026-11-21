# Churchyard proof: first comparison

The target is the approved Overgrown churchyard image from open-games #24, SHA-256
`dfe017dea24bd823225371d4c0f38cefcba757797c4fb8d8b41814d92868ba95` (941 × 1672). The
comparison capture is the checked-in 390 × 844 fence-round image at game commit
`47e9544ee34c08d964418681435ad0c3a5b07a0b`, SHA-256
`c65662417ce3169a35e7b366b4bba0a64a11766ce36227e9bef2d0ab2d083ffe`.
The private side-by-side is `assets-local/review/1154/churchyard-unregistered.png`.
The camera centre, scale, and visible area differ; this is a visual comparison,
not a registered image score or an in-engine recapture at the target framing.

## Ranked discrepancies

1. **Framing and scale:** the mock fills the phone with the yard and a prominent
   knight; the capture shows the map edge and a large empty area, and its actors
   are much smaller. Match the camera and character height before pixel metrics.
2. **Chapel:** the mock has a roofed, closed stone building with a central door,
   steps, cross and side windows; the capture has a freestanding wall and arch.
   The game map itself calls the facade provisional. A suitable multi-piece
   assembly has not been verified; do not call a single high-scoring sprite a
   complete chapel.
3. **Approach:** the mock has a chain of stepping stones from the foreground gate
   toward the door. The capture has separated paving patches; the current map
   explicitly skips every third path cell. Preserve the intended route and make
   its visual sequence reach both ends.
4. **Graves:** gravestones flank the approach in the mock. The capture has much
   less visual density and a different arrangement. Keep the playable route
   clear and compare the rows after the camera is matched.
5. **Fence and gate:** corner and gate pillars, with visible torches, frame the
   mock. The current capture lacks those prominent pillars and torch lights. The
   checked-in game revision already joins the fence runs; the earlier disconnected
   fence report is not evidence that this revision is still disconnected.
6. **Vegetation and light:** the mock has large bare trees, dense dark ground
   growth and warm localized lights; the capture is sparse and has conspicuous
   green diamond-shaped ivy. Compare pack candidates before marking any element
   unavailable.

## Provisional intent and uncertainty

The mock depicts a chapel beyond a central approach, with the grave groups on
both sides and a fence/gate defining the foreground. The chapel and back fence
occlude background vegetation; foreground fence posts and trees occlude the yard.
Characters stand on the ground plane in front of the chapel. These relationships
are visible; exact grid cells, cardinal facing, footpoints and object scale in
character-height units still need a validated registration and explicit inference.
The mock's tall door, roof silhouette and warm lights may need an assembly or
variants; the existing game kit audit does not establish that no suitable pack
asset exists. The source map uses an 11 × 11 grid with gate `(5, 10)` and crypt
`(5, 1)`, which are current-game facts, not inferred mock coordinates.

The current search covers only the fantasy-isometric pack and one facing. Other
packs, facings and character assets must be considered before declaring a kit
gap. Full-catalog similarity rankings are candidate suggestions, not proof of
identity, orientation, fit or usability.

## Existing game assets

The current game's lock records the source of the provisional arch as
`wall-f6`, its wall as `wall-f1`, and its door as `door-a1` in the
SmallScaleInt fantasy isometric pack. Its grave, cross and headstone are
`stone-a4`, `stone-a5` and `stone-a13`; grass and paving come from `ground-a2`
and `ground-h1`. The fence is the rural zombie pack's `fence-b1`. The game
also locks the HD character pack's `1knight` and the undead pack's `6warrior`
and `5archer`. These are identities of assets in the current game, not verified
matches for the generated mock. The current map records the wall, door and arch
at 270 degrees; the mock's equivalent cardinal orientation has not yet been
measured against the game's projection.
