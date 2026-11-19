# Dusk Helm: learnings from Blobs (2026-11-18)

Rules a Dusk Helm worker follows on top of its ticket. Each rule names its source (an hourly log date under
`docs/meta/`, or a skill) and the skill to load. Skills hold the detail; this page only says which rules bit Blobs and
how they apply to an isometric action RPG on the SmallScaleInt set. `(Blobs)` marks a rule that only partly transfers.

Every ticket: `game:dusk-helm` loads gm-core and gm-set-smallscaleint; the `role:*` labels load the rest
(gm-core `references/roles.md`). A ticket with no role starts without its skills (11-08).

## 1. Fidelity ladder and review flow

1. **One ticket climbs the rungs.** `phase:mock` (`model:low`), then `phase:prototype` (`model:medium`), then
   `phase:build` (`model:xhigh`), then `phase:polish` (`model:high`). Approval swaps the labels on the same ticket. Never a
   "Review …", "Continue …" or "Verify …" follow-up ticket. (11-16, 11-18; gm-prototype)
2. **Build only your rung.** A mock round has no production code. A prototype is the approved mock in context (a greybox
   slice or an in-engine diorama). The build carries the approved rung over exactly. Throwaway code from earlier rungs
   is replaced, not polished. (gm-prototype)
3. **Look first, then feel.** A look starts with image mocks of the player's screen (gm-image-mock). Feel (speed,
   timing, controls, knockback) is never a still or a link: offer 2–4 playable variants of one knob with
   `gm decide --playable <id>=<scenario query>`. (11-08; gm-image-mock, gm-new-game-plan `prototype-ladder.md`)
4. **First mock round: four options that differ greatly.** Each differs in palette, time of day, camera framing, HUD
   shape and staging, not four tints of one scene. After Kevin dislikes a look, the next round is **five rendered
   options A–E**. (11-15; gm-image-mock, memory five-rendered-options)
5. **One pick per screen.** Never bundle title, select and play into one A–E set. (11-18; gm-prototype)
6. **Rosters are voted item by item.** Ask how many there are, then offer twice that many cards, each with a name and a
   one-line personality. Never offer pre-bundled sets. (gm-image-mock)
7. **Before a mock becomes a target, check feasibility.** Map every element to a SmallScaleInt card id or an engine
   feature, and mark each one reachable, reachable as a variant, or a gap. A gap goes to Kevin as an option, never
   silently swapped for primitives. A painted mock that the kit cannot draw cost Blobs a whole build. (11-08;
   gm-image-mock)
8. **Each rung's approved output is the next rung's target.** Score against Kevin's real file or the approved media,
   never your own render or a model mock. (11-11; gm-prototype step 2, memory visual-direction-from-concept)
9. **Fold in every note.** "Looks good, but add X" is a change request: do X first. Carry earlier notes forward. A note
   that arrives mid-round joins the current round. (11-14, 11-18; gm-prototype step 3)
10. **One round, one question, then end the turn** in human-review. Never re-polish and re-ask before his verdict. A
    direction Kevin already gave in the ticket is decided: build it, don't ask it again. (11-14, 11-17; gm-prototype step 6)
11. **Ship each round that beats prod.** Mark the PR ready (`Refs #n`) so it merges and publishes that hour. Keep
    iterating on a new branch. After three stills rounds, ship. (11-13, 11-14; gm-prototype step 7)
12. **Merged is not shipped.** A ticket is done when the hosted build shows it. Check the published game the same day.
    Never close a ticket whose post-deploy step has not run. (11-09, 11-18; gm-qa)
13. **Approved looks don't drift.** Change only what the ticket names. Before ready, compare every element you did not
    target against prod. Approved assets on main (logo, cast, music) win over anything baked into a mock. (11-14, 11-18)
14. **Look plateaus.** Measure against the best score so far. After three flat iterations, change technique (renderer,
    library or layout), not a parameter. Then raise one Command with the scored sheet and take your own recommendation.
    (11-11, 11-12; gm-verify, gm-dream-loop)

## 2. Visual and asset rules

15. **Packs first, then variants, then scratch.** Show a labelled lineup (`gm assets sheet`) before choosing. Say when
    you move down a tier. (10-30; gm-core, gm-assets)
16. **Clone, never edit originals.** Use a variant to fix repetition, such as building tints, extra props or a goblin
    recolour. Repeated identical buildings read as low quality. (10-30, 10-31; gm-asset-variants)
17. **Hand-built parts must look pack-made.** Use existing parts from the set first. (11-09, 11-10; gm-asset-variants)
18. **SmallScaleInt is 2D PNG sheets and Unity animation files, with no 3D sources.** Characters are 8-direction sheets
    through `SpriteActor`. Rows and frames are pack facts from the card, never guessed from file names. Pieces taller
    than a cell are depth-sorted sprites. (11-18; gm-set-smallscaleint)
19. **Scenes must read as real gameplay** (from the SmallScaleInt showcase rounds). Houses are whole, with meeting walls,
    one roof and doors in walls, never scattered kit pieces. Nothing covers the hero's path or important props. Hits get
    real reactions. Nothing attacks thin air. No teleports or ice-skating. (11-02, 11-03; gm-verify checklist)
20. **No pop-in.** Every appearance, disappearance and change of direction has a cause and a transition (loot, enemies,
    doors, area changes). (10-31)
21. **Seamless transitions.** Render the live view underneath at full opacity and fade only the top layer. No cut, no
    dimming cross-fade, and audio starts at once. (10-31; memory seamless-transitions)
22. **Mocks use `image_gen.imagegen`, never hand-coded SVG.** This includes logos. Mark every output AI-generated.
    (11-13; gm-image-mock)
23. **No paid-pack files go to the cloud.** SmallScaleInt is a paid pack. Describe the kit in words in each mock prompt.
    Reference only Kevin's own art and free-licence images. (gm-image-mock, project rules)
24. **Never stretch an image.** A resizable frame, panel or button is a 9-slice. A new shape gets art generated at that
    ratio. (11-17; gm-verify, core #837)
25. **Map sources are agent-only.** Never ask Kevin to pick a map, map pack or tileset. Derive a game-owned layout from
    an inspiration graph and render it with the SmallScaleInt set. (gm-map-inspiration)
26. **Thumbnail, loading image and trailer are standard tickets.** The thumbnail is art only: no logo or text, an open
    centre, and only the game's own cast. The trailer is one 16:9 clip of gameplay only. Refresh both after a big change
    of style or gameplay. (11-15..11-18; gm-new-game-plan)

## 3. UI, HUD and touch

27. **The host owns pause, settings, the play-view menu button and the touch buttons.** The game never draws its own
    pause or settings menu or its own touch buttons. It declares actions: one `move` stick and at most five buttons,
    most-used first. The first button is the 64 px primary. (gm-ui-hud, gm-input)
28. **Play view has no top bar.** Only the host's translucent menu button sits at top right; keep that corner free.
    (11-09; memory play-view-no-top-bar)
29. **Keep a 140 × 200 px zone clear in each lower corner on phones.** No HUD, prompt or target goes there. Frame the
    camera so the hero, threats and goals stay out of it. Keep the HUD to 25% of the screen or less, with the centre
    clear. (gm-ui-hud)
30. **"Maximize the board, never cover it" (Blobs)** becomes: the world fills the screen (`data-gm-play-area` on the
    canvas), and no HUD panel covers the hero, threats or goals at any size. Kevin's Blobs complaint was the
    over-correction: write the hard constraint first, then the objective. (11-16, 11-17; gm-verify `gm look shell`)
31. **Readable by default.** Phone text is at least 16 CSS px times `textScale`, on a solid plate. Numbers pair with an
    icon. Use `user-select:none` on html and body, because long-press text selection was a Blobs bug. (11-17; gm-ui-hud)
32. **No needless text.** An icon button gets no label (`aria-label` instead), with no taglines or helper lines.
    (10-31, 11-01; project rule)
33. **Standard button sizes.** Select-screen targets should be large and centred. Blobs shipped an oversized,
    off-centre X. (11-15, 11-18)
34. **Fairness across aspect ratios is gameplay.** Check encounter visibility, threat cues, aiming and puzzles in narrow
    portrait, not only in menus. (gm-new-game-plan)

## 4. Audio

35. **Audio concepts come at stage 1, from the library.** Offer 3–4 music tracks by mood and 2–3 SFX sets, each as audio
    on its option. Prefer recorded sources: Kevin called synthesized pops "terrible". (11-09; gm-audio,
    gm-new-game-plan)
36. **Every screen has sound.** Silent menus slipped through when the evidence covered only title to play. Check music
    and sound per screen, and stop title audio on exit. (11-12, 11-15; gm-audio)
37. **Mix rules.** Route everything through one SDK graph with four buses. Music sits about -12 dB under SFX, peaks stay
    below -1 dBFS, and music ducks under voice. Vary repeated cues. (gm-audio)
38. **Every approved pick needs an implementing step.** Blobs' music pick sat with no ticket. On the ladder, the build
    rung of the same ticket wires the pick in. (11-15)
39. **Voices: sample before you mint.** Offer six expressive voices per character, each saying the same two lines,
    before any full set. Captions never depend on hearing. (gm-image-mock voice samples, gm-ui-hud)

## 5. Verification and evidence

40. **Look before you post.** Code, logs and passing commands are not visual evidence. Answer the binary checklist in
    the PR from the sheet. (10-30; gm-verify)
41. **Four touch sizes, in the app shell.** Use 390x844, 844x390, 820x1180 and 1180x820, plus desktop, with
    `gm look shell --dist … --tap …`. A bare-URL or non-touch still proves nothing about a phone. If the shell fails,
    write one `Executor: shell stills <dist> TAP='<taps>'` line, quoting the taps. (11-08, 11-14; gm-verify)
42. **Playtest every mode.** Declare each class (and each difficulty, if it is a menu path) as a mode in
    `gm.manifest.json`. Implement `qa.invariants` per state rule, and run `gm qa playtest dusk-helm --all-modes` from the
    prototype rung on. A one-mode pass missed a duplicate board and broken rules in Blobs. (11-17; gm-verify step 8)
43. **Rebuild before stills.** Rebase on main, run a clean-clone production build, and confirm the title renders at
    390x844 before asking for stills. Stale dists booted blank. (11-13, 11-14)
44. **Video for the phone.** Use H.264 Main at level 4.1 or lower and 1280 px wide or less. Level 6.2 clips would not
    play on Kevin's phone. Caption the moment that matters in every review clip, slow it there, and pair it with a
    before/after. (10-31, 11-09, 11-18; gm-verify)
45. **Close-ups for options.** Each compared item must be at least 150 px. Phone-scale faces made five options look
    identical. (11-15; gm-prototype step 4)
46. **Run the whole suite before ready**, not a selection: `pnpm --filter @game/dusk-helm test`. (11-14)
47. **Unchecked is not a pass.** iPhone Safari, sound and gamepad stay listed as unchecked unless someone played them.
    A broker error is a blocker, not a pass. (gm-verify, gm-qa)
48. **Journeys prove devices.** Write `phone-touch`, `laptop-keys` and `hud-clear` journeys in
    `games/dusk-helm/qa/journeys/`, copying the Blobs set in gm-qa. (gm-input, gm-ui-hud, gm-qa)

## 6. Process and Commands

49. **Only taste goes to Kevin.** Engineering, tooling, CI and scope calls are yours. Host-only steps go to the
    Executor with an `Executor:` workpad line, and you keep working meanwhile. (11-08, 11-10; gm-prototype step 8)
50. **Show, don't tell.** Every option carries its media (image, clip, audio or playable slice). Use a 2–5 word title,
    labels A/B/C, one option per card, and one line each saying what the option does in play. A word-only question
    goes to the Executor as `Executor: product question:`. (11-08, 11-09; open-games prompt)
51. **Picks are non-blocking.** Raise the `decision.requested` Command only once every option has media. Build your
    recommendation and ship it meanwhile. Silence is a provisional default, never approval. (11-15; open-games prompt,
    gm-new-game-plan)
52. **Decide, don't ask.** Before any question, `git grep` the game's decisions and tests. If you would write a
    recommendation, take it and note it in the workpad. (11-10, 11-12; open-games prompt)
53. **Never idle and never self-block.** Add no blocked-by edge or `agent:blocked` to your own ticket. Push checkpoints
    to the branch; an open PR parks the ticket in ci-wait. (11-11)
54. **`Closes #n` only when the ticket is finished.** A ticket with a creator review closes only on Kevin's approval;
    until then use `Refs #n`. Never file a verify-only or document-only follow-up. (11-15)
55. **No backwards compatibility.** Rename ids, save formats and wire formats in place, with no migrations or shims,
    until Kevin says otherwise. (11-09; memory no-backwards-compat)
56. **Privacy.** Private spec text, Kevin's words and references to other games never go into the repo, issues or PRs.
    Cite section numbers only. Screen inspiration from other games stays in private notes. (gm-new-game-plan)
57. **Evidence location.** Write review media to `assets-local/review/dusk-helm/<ticket>/`, which Codex workers can
    write. Commit the files the PR links under `games/dusk-helm/review/<ticket>/`. (11-09; open-games prompt, gm-verify)

## Blobs-only (do not carry over)

These are Blobs decisions, not rules: the goo shape and physics, the KayKit stage, the Blobs/Blocks/Both mode names,
the portrait plaque row, and the Puyo rules. The board-fill numbers transfer only as the world canvas fill
(rule 30).

## Conflicts found (the newer rule is used above)

- gm-new-game-plan files **one ticket per stage per feature**, while gm-prototype and Kevin (11-16) climb **one ticket
  through all rungs**. This page follows gm-prototype. gm-new-game-plan's ladder section needs a cleanup.
- gm-image-mock "Show" still says to raise picks with `blocking: true`. The open-games prompt (11-15) says non-blocking.
  This page uses non-blocking. gm-image-mock needs a cleanup.
- gm-voiceover allows only local Chatterbox drafts, while gm-image-mock samples voices through the mock broker. The
  route for #29 is the Executor's call.
