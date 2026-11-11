---
name: gm-design-loop
description: Use for any creator request to make or change part of a game, scene, screen or effect ("add a scene", "make the city...", "change how X looks"). The core loop Game Maker's agents follow: assets first, options before the final build, verify by looking, deliver something the creator can watch on a phone, then persist what was decided. Dogfooded by Claude in this repo.
---

# gm-design-loop

The creator talks; the agent designs. Designing is the product's core loop, so do it the same way every time.

When copying concept art, follow the matching-concept loop in `gm-verify` on every iteration: measure positions and
sizes as fractions of a cell, score and judge the settled capture, fix the top differences, and repeat until it passes
or the documented stall procedure applies. Include the score JSON and side-by-side in ready posts.

## The loop

1. **Restate** the ask in one line, plus the constraints already known: the creator's taste and past decisions
   (memory, the scene list), the game's style, what must not change. Ask only if the choice is genuinely theirs.
2. **Assets first** (`gm-assets`). Search the packs, render a lineup of candidates, and pick from it (show the creator
   when the choice is visible). Missing? Fetch a free pack (tier 2) or clone a variant (`gm-asset-variants`).
   Building a model procedurally is the last resort, and you say so.
3. **Options before the final build.** For a big or visible decision (a scene, a style, a character, a layout) make
   2-5 quick variations (A/B/C) and recommend one. Small changes skip this.
   - One step at a time: the creator signs off a scene before the next starts. Don't build several at once.
4. **Build.** Every moving thing runs on its own loop with its own period. Keep a capture mode (time set from
   outside) so recordings are exact.
   - Characters: a one-shot clip (punch, swipe, hit) plays **once** and holds; never let it loop over a long slot (an
     0.8 s punch over 2 s reads as three punches). Slow clips with a rate for big creatures, crossfade ~0.3 s between
     moves, and fire impacts on the clip's contact frame. Vary the moves and let them react (flinch, knockback).
   - Pace from distance: a walk is ~3.5 m/s, a sprint ~10+, so derive each move's time from its path, never a fixed
     slot (a 5 s slot for a 2 s walk read as "3 times as long as it should"). Route paths along open streets with no
     doglegs, and keep characters on top of rubble and fliers above landmarks for the whole path, not just the key
     frames.
   - Sharing a ShaderMaterial's live uniforms: `{ ...mat.uniforms, own: {...} }`; `clone()` copies them frozen.
   - **Show as you go.** Post a screenshot (or a short clip) with one line at each visible milestone (new sprite,
     first pass of the motion, each fix the creator asked for) so they can steer mid-build instead of after it. Keep
     building while they look; fold their notes in at the next step.
5. **Verify by looking** (`gm-verify`) before anything is sent: stills at desktop and phone sizes, a timeline of the
   motion, and a look at every frame you cite.
6. **Deliver for a phone.** MP4 clips on an artifact page with posters and one line per option, then the specific
   questions (which option, what to change). Deploy only when the creator says so.
7. **Persist decisions** where the next agent will find them: the scene list and taste in memory, product-level
   decisions in the scope. Lessons about the process itself go through `meta-improve`.

## Taste and pushback

Each creator's preferences live in memory (feedback notes). Read them before step 3 and apply them without being
asked again. When the creator pushes back, fix the instance and update the note or skill that would have prevented
it (one line, in place).
