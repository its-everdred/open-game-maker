# Prototype ladder

A new game is built as a ladder of playable prototypes and a set of domain tracks that evolve beside it, never as one
build that ships everything at once. Each rung is something the creator can play; each track stage ends in a decision
the creator makes from real media. Later work builds on what was decided, and a later decision can reopen an earlier
stage.

Why: a one-shot build lets every lane guess at once. An approved painted mock was never reachable in-game and the build
shipped primitive geometry; nobody had checked whether the kit and the engine could reach the mock, or compared the
build with it.

## Two axes

- **Gameplay rungs (P1..Pn).** Each rung is a playable build that answers one question about how the game feels. Rungs
  evolve one codebase: P2 adds to P1, never replaces it.
- **Domain tracks.** Visuals, characters and audio (and story or UI when the game needs them). Each track climbs
  stages from cheap pictures to real in-game assets. A stage ends in an aiur Command with media; the creator's answer
  is the input of the next stage.

Tracks borrow from rungs: an in-game visual stage dresses the latest rung, and the sound-effect stage scores a capture
of it. Rungs borrow from tracks only what has been decided; until then they use the kit's plain pieces (never
primitives, see gm-core).

## Gameplay rungs

Each rung:

1. **Proves one thing**, written as the rung's question ("does moving and dropping a pair feel good on a phone?").
2. **Is tried from a link.** The rung ends with a play link the app shows the creator, plus a short phone-portrait MP4
   (gm-verify) for when they cannot play right now. The agent never opens the game for them.
3. **Has scenarios.** A scenario is a saved starting state the creator opens by URL, `?scenario=<id>`, read from
   `games/<name>/scenarios/<id>.json` (board contents, upcoming pieces, seed, opponent, which UI is on). The skeleton
   ticket adds the loader; each rung adds the scenarios that let the creator reach its moment in seconds instead of
   playing up to it. A sandbox scenario lets the creator set the state up themselves (place pieces, pick the next
   ones) when the moment is theirs to design.
4. **Shows the player view only.** No debug overlays or orbit cameras in the link; a debug view, if any, is a separate
   scenario that is never sent as evidence.
5. **Ends in a feel Command** when a knob matters: 2–4 variants of the one value the rung is about (fall speed, rotate
   rules, chain timing), each a playable option the review deck runs in the card (`gm checkpoint open --playable
   <id>=<scenario query>`, a few seconds each with an optional `--lead-in`), recommendation first. Never a link.

### Worked example: a falling-block versus puzzle

| Rung | Proves | Scenarios | Feel Command |
|---|---|---|---|
| P1 Move blobs | Moving, rotating, dropping and locking a blob pair on a phone; gravity settles loose blobs | `empty`, `tall-stack` | Fall and soft-drop speed: three presets |
| P2 Combos | Four of a colour clear; a clear that drops blobs into a new clear chains; the chain counter reads | `chain-3` (one drop sets off a 3-chain), `sandbox` (place blobs, pick the next pairs) | Chain pause length: short, medium, long |
| P3 Short game | Title, character select, settings and a short best-of-3 against a CPU, with garbage sent on chains, win and lose | `match-start`, `about-to-win`, `about-to-lose` | CPU difficulty for the first match |

A game adds rungs where a risky mechanic needs its own proof (here, garbage might be its own rung between P2 and P3).
Three to five rungs is typical; each is one or two tickets.

## Domain tracks and their stages

Every stage below ends in a Command unless marked. Options follow the standing rules: kit-based, four that differ
greatly (rosters: twice the starting count, voted per item), player view only, `gm options check` against
`design/feedback.json` before they go out, audio previews before anything is minted.

### Visuals

| Stage | Work | Command: question (media) |
|---|---|---|
| V1 Image mocks | `gm-image-mock`: four generated stills of the play screen in the kit | "Which screen is closest to your game?" (4 mocks, per-option like or dislike and notes) |
| V2 Feasibility and kit diorama | Feasibility note (below), then the picked mock rebuilt from real kit pieces in the game's engine and camera, look-checked against V1 | "This is the picked look built from the kit. Keep it, or change one of these?" (diorama stills beside the mock; 2–4 variants of what the kit could not match) |
| V3 In-game board | The V2 look applied to the latest rung (board, pieces, play area), look-checked against V2 | "Does the board read well while playing?" (phone MP4 of the rung plus stills) |
| V4 Backgrounds | Questions, each with mocks or dioramas: does the player choose the background? is it tied to a character? does it change play (special blobs in a spooky forest)? | One Command per question; an answer that changes play reopens a rung (see Reopening) |
| V5 Finish | Boards, pieces, UI, menus and settings at final quality, on the last rung | "Ready, or what still looks off?" (phone MP4 of a full short game, still per screen) |

**Feasibility step (V2, and again whenever a visual target changes).** Before any build, list every element of the
approved mock (board frame, piece shape and material, background layers, HUD, character staging, effects) and map
each to kit cards (`gm assets search`, card ids) and engine features (lighting, outline, particles, camera). Mark each
one reachable, reachable with a variant (`gm-asset-variants`, a clone of an owned asset), or not reachable. Anything not
reachable goes into the V2 Command as its own question with the closest kit option, never silently replaced by
primitives or a weaker look.

### Characters

| Stage | Work | Command: question (media) |
|---|---|---|
| C1 Character pictures | First ask how many characters the game starts with; then twice that many image cards, each with a name and one-line personality | "Which of these belong in the game?" (one card per character, voted per item) |
| C2 Kit characters | Each pick built from the kit's rigged models (gm-set-kaykit `RiggedCharacter`), posed on the V2/V3 board; look-checked against its C1 card | "Is this them?" (stills and a short idle/celebrate clip per character) |
| C3 Voices | Six voice samples per character, each saying the same two lines in character (gm-image-mock, Voice samples) | "Which voice is theirs?" (audio per option) |
| C4 Personality and phrases | A phrase sheet per character: 8–12 short lines across moods, three of them voiced as previews | "Keep, cut or rewrite these lines?" (text plus three audio previews) |
| C5 When phrases fire | An event map (chain of 3+, sent garbage, hit by garbage, near loss, win, lose) shown as a rung capture with the lines placed on it | "Do these lines land at the right moments?" (MP4 with voice lined up on the events) |

### Audio

| Stage | Work | Command: question (media) |
|---|---|---|
| A1 Soundtrack direction | 3–4 library tracks by mood (gm-audio, `gm assets search --kind audio`); can start on day one | "Which music fits?" (clip per track) |
| A2 Sound effects | Once a rung has the actions (P2 here): 2–3 effect sets laid on one gameplay capture, synced to land, connect, clear and each chain step | "Which set sounds right?" (the same MP4 per set) |
| A3 Announcer | Callouts ("Nice!", "3 chain!", "Ready... go!") timed on the same capture, 2–3 voices | "Which announcer?" (MP4 per option) |
| A4 Mix in-game | The picks wired into the rung through the SDK audio graph, music ducked under voice | "How does it sound on your phone?" (play link; sound stays unchecked until the creator listens) |

Story and UI tracks follow the same shape when the game needs them: words or pictures first, real assets next, in-game
last.

## Tickets

- **One ticket per stage per track, one or two per rung.** Title it by stage and game ("V2 Kit diorama, Blob Duel").
  Each ticket ends in exactly one of: a decision Command with media (track stages), or a playable link with scenarios
  and a phone MP4 (rungs).
- **Plan the whole ladder up front, research just in time.** File every rung and stage as soon as the spec lands, so
  the Build Order shows the whole game. Deep-dive a stage ticket (research-spike step 3) when the decision it builds on
  exists, not before: researching V3 before V2 is decided researches a guess.
- **Gates are decisions.** Stage n+1 is blocked by stage n's Command (the decision id is in its "relies on" list).
  Provisional defaults still apply after about five minutes, so a quiet creator never stops the ladder; the default
  is recorded as such and a later answer reopens what it touched.
- **Cross edges.** An in-game stage depends on the rung it dresses (V3 on P1, V5 on P3); A2 and C5 depend on the rung
  whose capture they score. Rungs depend on each other in order and never on a track Command unless the rung needs
  that decision to be playable.
- **Skeleton first** (gm-new-game-plan): it adds the scenario loader and the stage evidence folders, so every later
  ticket owns its own files.

Versus puzzle Build Order, level by level:

```text
skeleton
├─ P1 move blobs ─ P2 combos ─ P3 short game
├─ V1 mocks ─ V2 feasibility+diorama ─ V3 board (also P1) ─ V4 backgrounds ─ V5 finish (also P3)
├─ C1 pictures ─ C2 kit characters (also V2) ─ C3 voices ─ C4 phrases ─ C5 triggers (also P2)
└─ A1 music ── A2 effects (also P2) ─ A3 announcer ─ A4 mix (also P3, C5)
```

## Acceptance per stage

| Stage kind | Accepted when |
|---|---|
| Image mocks (V1, C1) | Four (or 2x roster) options that differ greatly; each looked at, or checked with the `gm-image-mock` look request; `gm options check` passes |
| Feasibility (V2) | Every mock element mapped to card ids and engine features, or named as a gap in the Command |
| Kit and in-game visuals (V2, V3, V5, C2) | `request-mock.py --kind look --ref <shot> --ref <approved target>` answered "matches" on every point, answers saved with the evidence; gm-verify checklist with no primitive, placeholder or debug view |
| Rungs (P1..Pn) | `gm check`, `gm test`, `gm run` green; each scenario link opens to its stated state; phone-portrait MP4 and stills looked at; iPhone Safari listed unchecked until the creator plays it |
| Audio and voice (A1–A4, C3–C5) | Previews rendered before any full set is minted; cues peak below -1 dBFS (gm-audio); synced clips checked frame by frame at the event marks |

Numeric checks (pixel counts, luminance, file sizes) never count as looking. A look check that fails is fixed, or the
gap goes back to the creator as a question; it never ships as "close enough".

## Reopening an earlier stage

Every stage ticket lists the decision ids it relies on. When a decision is superseded (a late answer, a V4 answer that
changes play, a feasibility gap found late):

1. Record the new decision with `supersedes`; record the rejected option with `gm options reject` so the reopened stage
   never offers it again.
2. Find every stage and rung whose "relies on" list holds the old id; they are stale.
3. File a revision ticket for the earliest stale stage ("V3 rev 2"), gated as before; downstream stale stages wait on
   it. Merged work stays until its revision lands; revert only what the new decision forbids.
4. Message running agents on stale tickets (`aiur-main message`).

Examples from the versus puzzle: the creator picks "background changes play" in V4, so a spooky-forest board adds
special blobs, which reopens P2 (a new rung P2b with a `forest-chain` scenario) and V3 (the forest board). A voice
change in C3 after C4 keeps the phrase text and regenerates only its audio. A V3 look check that cannot match V2 on the
real board reopens V2 with the gap named, instead of shipping a weaker look.
