# Prototype ladder

Every new game is prototyped in five stages, in this order, with a creator review at the end of each one. Each stage
turns the previous stage's approved output into something closer to the real game: pictures and sounds, then a
diorama built from the kit, then rendered gameplay clips, then playable slices, then tuned variants.

Why: a one-shot build lets every lane guess at once. An approved painted mock was never reachable in-game and the build
shipped primitive geometry; nobody had checked whether the kit and the engine could reach the mock, or compared the
build with it. A stage that is only judged against the stage before it can never drift that far.

## The five stages

| # | Stage | What's made | Review (a Command in the deck, media on every option) | Roles |
|---|---|---|---|---|
| 1 | **Concepts** | Image, audio and art concepts: looks, characters, music, sound effects, voices (`gm-image-mock`, `gm-audio`, `gm-voiceover`) | Pick or reject per concept: A/B/C with images and audio | role:game-design, role:audio |
| 2 | **Dioramas** | Each picked image rebuilt as a diorama from real pack assets in the game's engine and camera; stills beside the concept, plus a feasibility list of what the kit can't match | "Keep this diorama, or change one of these?" (diorama beside concept) | role:3d, role:assets |
| 3 | **Rendered gameplay clips** | The approved diorama animated into short scripted gameplay videos (a few seconds each: a move, a clear, a chain, a round end) through the real renderer, with the picked audio | Pick per clip (phone-ready MP4) | role:visual |
| 4 | **Video to real gameplay** | The approved clips implemented as playable slices that look and sound like the clips; the video-to-game study and compare scripts make the side-by-side | Play-then-vote cards beside the approved clip (`gm decide --playable`) | role:gameplay, role:qa |
| 5 | **Gameplay iterations** | Tuned snippets (feel, speed, difficulty, modes) as playable variants | Play-then-vote per variant, one feature at a time | role:gameplay, role:qa |

The role labels stamp each stage ticket's skills once roles land (#656); a stage ticket carries every role in its
row.

## Rules

- **In order, per feature.** A feature is a piece of the game the creator reviews on its own: a screen or a moment from
  the flow diagram (`references/flow-diagram.md`), such as the play screen, a chain, character select or the round end.
  No stage starts for a feature before the previous stage's review for that feature is answered. Features move
  independently: the play screen can be at stage 4 while character select is at stage 2.
- **A rejection loops back within the same stage.** The stage makes new options from the creator's words (recorded with
  `gm options reject`, so the rejected option never returns) and asks again. It never skips ahead or falls back a stage.
- **The approved output is the next stage's acceptance target.** A diorama is judged against its concept, a clip against
  its diorama, and stage 4 and 5 screens against the stage 3 clip and the stage 2 diorama, never against the stage 1
  concept.
- **The flow diagram places every screen.** Each screen node in the session loop gets its feature ladder; a stage covers
  the screens on it, and each stage ticket names its node (`flow: round_end`).
- **Silence is a provisional default, never approval.** Commands get a provisional default after about five minutes, so
  a quiet creator never stops the ladder; the default is recorded as such and a later answer reopens what it touched.

## Stage by stage

### 1. Concepts

- Looks: four generated stills of the screen in the chosen kit that differ greatly (`gm-image-mock`). Characters: first
  ask how many the game starts with, then twice that many image cards, each with a name and a one-line personality,
  voted per item.
- Audio: 3–4 library music tracks by mood (`gm assets search --kind audio`), 2–3 sound-effect sets, an announcer and
  character voices (`gm-voiceover`: six samples per character, the same two lines in character, expressive). Library
  first; generation is samples only until the creator picks.
- `gm options check` against `design/feedback.json` before any option set goes out.

### 2. Dioramas

- **Feasibility first.** List every element of the picked concept (board frame, piece shape and material, background
  layers, HUD, character staging, effects) and map each to kit cards (`gm assets search`, card ids) and engine features
  (lighting, outline, particles, camera). Mark each one reachable, reachable with a variant (`gm-asset-variants`, a clone
  of an owned asset), or not reachable.
- Build the diorama from real pack assets in the game's engine and camera (characters from the kit's rigged models,
  posed on it). Anything not reachable becomes its own option in the Command with the closest kit choice, never
  silently replaced by primitives or a weaker look.
- The Command shows each diorama still beside its concept.

### 3. Rendered gameplay clips

- Script each clip in the real renderer from the approved diorama: a few seconds of one moment (a move, a clear, a
  chain, a round end, a character's win line). It is a rendered scene, not a playable build: positions are keyed, not
  simulated.
- Lay the picked audio on it: music, sound effects synced to land, connect and clear, announcer callouts, character
  lines on their events. Check sync frame by frame at the event marks.
- Encode phone-ready MP4s (gm-verify) and look at every one; the Command is one card per clip.

### 4. Video to real gameplay

- Implement each approved clip as a playable slice in the game's one codebase (a later slice adds to the earlier ones,
  never replaces them).
- **Scenarios.** The creator reaches the slice's moment in seconds from `?scenario=<id>`, read from
  `games/<name>/scenarios/<id>.json` (board contents, upcoming pieces, seed, opponent, which UI is on). The skeleton
  ticket adds the loader; each slice adds its scenarios. A sandbox scenario lets the creator set the state up
  themselves. Player view only: a debug view, if any, is a separate scenario never sent as evidence.
- **Side-by-side.** Film the slice with the same moment as its clip and run the video-to-game study and compare
  scripts, so the slice is checked frame against clip, sound included.
- The Command is a play-then-vote card per slice beside its approved clip (`gm decide --playable <id>=<scenario
  query>`, a few seconds each with an optional `--lead-in`), never a link.

### 5. Gameplay iterations

- One feature at a time, 2–4 playable variants of the one value it is about (fall speed, rotate rules, chain timing,
  CPU difficulty, a mode), recommendation first.
- The build reads each knob from its URL (`?scenario=sandbox&speed=slow`, plus `lead_in=<move>` when given), so the
  scenario loader exposes the knob before the Command opens.
- Each variant keeps the approved stage 4 slice's scenarios and still matches the stage 3 clip and stage 2 diorama; a
  tuning that breaks the look is a stage 4 fix.

## Tickets

- **One ticket per stage per feature.** Title it by stage, feature and game ("3 Clips: chains, Blobs"). Each ticket
  ends in exactly one review Command with media; stages 4 and 5 also leave a play link with scenarios and a phone MP4.
- **Plan the whole ladder up front, research just in time.** Write the game's ladder plan from
  `references/build-order-template.md` into `games/<name>/design/ladder.md` and file every stage ticket as soon as the
  spec lands, so the Build Order shows the whole game. Deep-dive a stage ticket (research-spike step 3) when the decision
  it builds on exists: researching stage 3 before stage 2 is decided researches a guess. Stage 1 tickets are researched
  up front.
- **Gates are decisions.** Stage n+1 of a feature is blocked by stage n's Command for that feature (the decision id is in
  its "relies on" list).
- **Check the plan.** `node .claude/skills/gm-new-game-plan/scripts/check-ladder.ts games/<name>/design/ladder.md`
  fails unless the Features table is filled in and the plan holds the five stages in order, each with its review
  Command and roles, a row for every feature (and none that is not in Features) and a ticket on every row.
- **Skeleton first** (gm-new-game-plan): it adds the scenario loader and the stage evidence folders, so every later
  ticket owns its own files.

Worked example: `references/examples/blobs-ladder.md`, a falling-blob versus puzzle.

## Acceptance per stage

| Stage | Accepted when |
|---|---|
| 1 Concepts | Options that differ greatly (four looks, 2x roster, 3–4 tracks); each looked at or listened to; `gm options check` passes |
| 2 Dioramas | Every concept element mapped to card ids and engine features, or named as a gap in the Command; `request-mock.py --kind look --ref <shot> --ref <concept>` answered "matches" on every point; no primitive, placeholder or debug view |
| 3 Clips | Rendered in the real renderer; look-checked against the diorama; audio peaks below -1 dBFS and lands on the event marks frame by frame; phone MP4 looked at |
| 4 Real gameplay | `gm check`, `gm test`, `gm run` green; each scenario opens to its stated state; the compare script's side-by-side against the clip looked at; iPhone Safari and sound listed unchecked until the creator plays it |
| 5 Iterations | Each variant opens from its scenario query with its knob applied; keeps the stage 4 slice's scenarios; still matches the clip and diorama |

Numeric checks (pixel counts, luminance, file sizes) never count as looking. A look check that fails is fixed, or the
gap goes back to the creator as a question; it never ships as "close enough".

## Reopening an earlier stage

Every stage ticket lists the decision ids it relies on. When a decision is superseded (a late answer, a feasibility gap
found late, a stage 5 answer that changes play):

1. Record the new decision with `supersedes`; record the rejected option with `gm options reject` so the reopened stage
   never offers it again.
2. Find every stage ticket whose "relies on" list holds the old id; they are stale.
3. File a revision ticket for the earliest stale stage ("2 Dioramas rev 2: play screen"), gated as before; later stale
   stages of that feature wait on it. Merged work stays until its revision lands; revert only what the new decision
   forbids.
4. Message running agents on stale tickets (`aiur-main message`).
