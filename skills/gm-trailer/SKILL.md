---
name: gm-trailer
description: Load for any game trailer ticket or refresh. Turns a game's own content into an exciting, varied gameplay trailer - inventory, shot list, scripted real-gameplay capture, cuts paced to the game's music, camera framing without stretching - and self-checks variety, pace and dead frames before anyone sees it.
---

# Game trailer

The format is fixed elsewhere: one `public/media/trailer-landscape.mp4`, 16:9 at 1280×720, 15–30 s, gameplay only
(no menus, title or end cards), H.264 Main 4.1, AAC, faststart, with its frame record
([gm-new-game-plan/references/game-media.md](../gm-new-game-plan/references/game-media.md); `gm trailer --check`
enforces it). This skill is what makes it worth watching. A trailer that passes the format gate can still be flat:
four long snippets, no hook, menus-length pauses, cuts that ignore the music and half the game missing (Blobs round
3: four shots averaging 3.5 s, "left out" list longer than the shot list). Craft and examples:
[`references/direction.md`](references/direction.md); the cut list format: [`references/cut-list.md`](references/cut-list.md).

## Steps

1. **Inventory first.** Read the game's design doc, flow diagram and source and list everything a player can see:
   every location or biome, how the player moves through them, each encounter or battle type, the abilities and
   attack animations (several, not one), bosses, characters and party members, and the signature moments (a
   transformation, a big clear, a reveal). This list is the `inventory` in the cut list, and every item must be shown.
2. **Shot list on an arc.** Hook (the most striking two seconds, first), world (traversal through each location,
   in the order a player meets them), action (encounters and abilities, escalating), climax (bosses), button (the
   biggest hit as the last frame). One idea per shot; never two shots of the same thing in a row.
3. **Music sets the cuts.** Use the game's own tracks: a calmer one under the world, the battle or boss theme under
   the action. Time every shot in beats (2–4 beats while exploring, 1–2 in action, 4 at a reveal); `assemble.py`
   puts every cut on a beat. Layer the game's own sound effects at the frames they happened.
4. **Capture real play, scripted.** Drive the real build with keyboard or touch input from the game's own entry
   points (scenarios, saves, debug scene entry); never mock a frame. `scripts/capture.mjs` loads the game once and
   advances it one frame per step (smooth footage on a loaded host), reads the canvas each frame and logs sound cues
   by frame; you write the shots module that plays each take. Record more than you need and pick the liveliest
   window of each take.
5. **Frame like a camera.** Every crop is 16:9 and scaled uniformly (nearest-neighbour for pixel art), never
   stretched. Use the game's own camera moves (scrolling, follow, shake) and add pans across the frame and punch-ins
   on impacts; a HUD or menu panel may be cropped out when the action reads without it.
6. **Assemble and self-check.** From the game directory, with the cut list in `review/<ticket>/cut.json`:

   ```sh
   python3 -I .claude/skills/gm-trailer/scripts/assemble.py review/<ticket>/cut.json --out review/<ticket>/trailer-landscape.mp4
   python3 -I .claude/skills/gm-trailer/scripts/selfcheck.py review/<ticket>/cut.json review/<ticket>/trailer-landscape.mp4
   ```

   Fix every FAIL (too few shots, a shot over 4 s, average over 2.5 s, an inventory item missing, too little action,
   a cut that changes nothing, frozen or black frames).
7. **Look and listen before posting.** Read the contact sheet the self-check writes (one still per shot) and
   sampled frames across the whole video; confirm each location and battle appears, nothing is stretched or
   covered, the hits land on the beat and the mix is clean. Then `gm trailer --check` and post it phone-first.
