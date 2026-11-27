# Dusk Helm armor generation feasibility

Research only, 2026-11-26. No generation or spending was performed. The requested
breadth is Warrior, Wizard and Ranger equipment progressing from basic to
elaborate; no number of tiers is decided.

## Recommendation

Try the existing Codex image route for original, consistent concept views, then
`fal-ai/trellis/multi` via the host's `skills/gm-sprite-forge/scripts/fal3d.py`
ledger. The previous character bake-off favored this route at about $0.02 per
mesh, but it did not demonstrate fitted armor. Generate individual rigid pieces
first, beginning with a helmet; fit to the existing body locally and reuse its
skeleton, then test motion and the current pixel finish. Reuse cleared equipment
where it fits. Do not infer that a cheap mesh is a usable set.

For the concept series, establish one rights-cleared neutral body, fixed pose,
camera, lighting and palette; use it for original front, side and back views of
each design. Specify class, materials, broad silhouettes and progression in
words; compare tiers together at phone scale. Consistency and matched views are
hypotheses to test, not a promised output. Leartes, Hivemind and Fab NoAI
assets must never be sent to generation; no paid-pack asset, including a body
reference, may be sent to cloud processing. Named games are private style
references, not source assets to copy. Verify rights for every input, including
body references, before any upload. Review concepts through the standard visual
review flow before modeling.

## Evidence and limits

- **Documented:** [fal's TRELLIS multi endpoint](https://fal.ai/models/fal-ai/trellis/multi)
  lists $0.02 per unit and accepts multiple images; its
  [schema](https://fal.ai/models/fal-ai/trellis/multi/api) describes a model
  mesh, not armor slots, a hero-compatible rig, or skin weights. It does not
  guarantee separable parts. A clothed character may be fused: inspect the GLB
  rather than assume separation. Generate parts individually or cut and repair a
  full mesh; neither assures fit, hollow interiors or usable topology.
- **Project evidence:** [the bake-off](../../skills/gm-sprite-forge/references/gpu-bakeoff.md)
  records the creator's favorable static TRELLIS character verdict and ~$0.02
  call, but also reports that no arm passed its gates and single-view hidden
  surfaces are invented. That is not armor or animation acceptance. TRELLIS 2
  is a different endpoint: [fal's guide](https://fal.ai/learn/devs/trellis-2-image-to-3d-prompt-guide)
  lists $0.25 at 512, not $0.02; recheck endpoint and settings before spending.
- **Current integration:** the local Dusk Helm armory draws a base-body image
  and separate directional weapon/offhand images at hand points. That shows a
  working weapon layer, not a verified interchangeable armor skinning pipeline.
  Confirm the current hero source rig, body proportions and available animations
  at trial time. Helmet and weapon can attach rigidly to head/hand; shoulders
  need checking through arm motion; torso, gloves, boots and robes may require
  skin-weight transfer, body masking, topology repair and clipping fixes.
  Bake/render the appropriate directions and frames if the chosen presentation
  needs sprites. Do not decide the separate 3D-versus-sprite question here.
- **Rights and service:** prior project research records a product-wide fal
  exclusion pending written confirmation, and a self-hosted TRELLIS export
  dependency concern. A fal model page's commercial-use label alone does not
  clear those project restrictions. Verify the current decision and provider
  terms before any trial or production use; no approval is inferred here.

Use broad color blocks, readable helmet and shoulder profiles, and one clear
weapon silhouette; simplify tiny ornaments that disappear at game scale. This
is a hypothesis until compared in the actual phone-sized view and motion.

## Economics and trial

Illustrative generation budget, not a measured cost per usable set. Assume a
seven-piece set (helmet, shoulders, torso, legs, gloves, boots, weapon), one mesh per
piece, and one or two attempts each: 7–14 × $0.02 = **$0.14–$0.28**. If two
parts need separate left/right outputs, add $0.04–$0.08 at the same retry rate.
A paid concept path such as [FLUX Kontext Pro](https://fal.ai/learn/tools/how-to-use-flux)
adds $0.04 per image: 3–6 images add $0.12–$0.24. Thus this illustrative set is
**$0.26–$0.52** before extra sides, failed batches, rigging or cleanup; free
Codex-route mocks could lower cash cost, subject to availability and rights.
Per-piece costs exclude its share of concept images. Whole-character generation
at $0.02 per attempt is cheaper but is not modular equipment. Actual yield is
unknown, so no reliable upper bound or proven usable-set cost exists.

The existing bake-off lists optional Meshy rigging at $0.20 plus $0.12 per
animation through fal; recheck its endpoint and current pricing before using it.
A separate paid rig is not assumed in the set estimate: transfer to the hero
rig is local labor, and paid auto-rigging a whole body does not prove modular
compatibility. Local rendering has no per-call provider fee but uses compute.
Fitting, skinning, cleanup, animation and visual review are unmeasured agent or
artist time and may dominate cost. For planning only, allow roughly 1–3 hours
for a rigid helmet or weapon including fit, clipping checks and phone-scale
rendering; a deforming torso or robe could take 4–12 hours or more for cleanup,
weight transfer, walk and attack checks and pixel-finish iteration. These are
unvalidated estimates for an available compatible hero rig, not measurements;
a bad mesh, missing rig or failed finish could force a restart. A full set for
a few pennies is unproven.

**Proposed capped trial, subject to separate spend approval and rights/service
clearance:** one Warrior helmet concept, up to three original concept views via
the existing free image route, and up to two TRELLIS multi calls at $0.02 each:
**maximum $0.04 in model fees**, no paid rig or paid image calls. Stop before a
call if current price exceeds the cap. Fit the best helmet to the actual hero,
render front/side/back at phone scale using the latest experimental finish and
show the concept and static result for approval first. After static approval,
check walk and one attack for clipping and show motion for review. The
[finish research](../../skills/gm-sprite-forge/references/smallscaleint-style.md)
remains iterative; do not represent it as settled. Record actual
charges, attempts and cleanup time. If free image generation or a suitable hero
rig is unavailable, stop and report it; do not substitute paid calls. A helmet
is a feasibility probe, not proof that flexible torso/robe pieces or complete
sets will work. Expand only after reviewing those results and pricing a
representative deforming piece separately.
