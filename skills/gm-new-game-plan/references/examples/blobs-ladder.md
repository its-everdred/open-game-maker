# Ladder plan: Blobs

A falling-blob versus puzzle: pairs of coloured blobs fall into a well, four of a colour clear, a clear that drops blobs
into a new clear chains, and chains send garbage to the opponent. A worked example of `../build-order-template.md`.

## Features

| Feature | Flow node |
|---|---|
| play screen | `play` |
| chains | `core loop` |
| character select | `character_select` |
| round end | `round_end` |

## 1. Concepts

Review: pick or reject per concept (A/B/C with images and audio)
Roles: role:game-design, role:audio

| Feature | Concepts | Ticket | Decision |
|---|---|---|---|
| play screen | Four play-screen mocks in the kit; 3–4 music tracks by mood; 2–3 sound-effect sets (land, connect, clear) | 1 Concepts: play screen, Blobs |  |
| chains | Two mocks of a clear and chain counter on the picked look; announcer: 2–3 voices saying "Nice!", "3 chain!", "Ready... go!" | 1 Concepts: chains, Blobs |  |
| character select | Starting roster of 3, so six character cards (name, one-line personality); six voice samples per pick | 1 Concepts: characters, Blobs |  |
| round end | Two round-end screen mocks per picked play-screen look | 1 Concepts: round end, Blobs |  |

## 2. Dioramas

Review: "Keep this diorama, or change one of these?" (diorama beside concept)
Roles: role:3d, role:assets

| Feature | Diorama (engine, camera) | Feasibility gaps | Ticket | Decision |
|---|---|---|---|---|
| play screen | Two wells with blobs, frame, background and HUD from kit cards, fixed front camera | Glossy jelly blobs: a material variant of the kit's sphere piece, or the matte kit blob | 2 Dioramas: play screen, Blobs |  |
| chains | A mid-chain still: popping blobs, the counter and garbage queued over the opponent | Pop burst: kit particles, or a variant of the kit's star sprite | 2 Dioramas: chains, Blobs |  |
| character select | Each picked character from the kit's rigged models, posed on the play-screen diorama |  | 2 Dioramas: characters, Blobs |  |
| round end | Win and lose poses over the frozen board |  | 2 Dioramas: round end, Blobs |  |

## 3. Rendered gameplay clips

Review: pick per clip (phone-ready MP4)
Roles: role:visual

| Feature | Clips (a few seconds each) | Audio on them | Ticket | Decision |
|---|---|---|---|---|
| play screen | A pair moves, rotates, drops and locks; loose blobs settle | Picked music, land sound | 3 Clips: play screen, Blobs |  |
| chains | A four clears; a 3-chain with the counter; garbage falls on the opponent | Clear and chain-step sounds, announcer callouts | 3 Clips: chains, Blobs |  |
| character select | The cursor moves across the roster; the picked character waves and says their line | Select sound, character voice | 3 Clips: character select, Blobs |  |
| round end | The losing well tops out; the winner celebrates | Character win line, round-end sting | 3 Clips: round end, Blobs |  |

## 4. Video to real gameplay

Review: play-then-vote cards beside the approved clip
Roles: role:gameplay, role:qa

| Feature | Playable slice | Scenarios | Ticket | Decision |
|---|---|---|---|---|
| play screen | Move, rotate, drop and lock a pair on a phone; gravity settles loose blobs | `empty`, `tall-stack` | 4 Slice: play screen, Blobs |  |
| chains | Four of a colour clears; drops chain; garbage is sent | `chain-3` (one drop sets off a 3-chain), `sandbox` | 4 Slice: chains, Blobs |  |
| character select | Pick a character, then the match starts with them | `select` | 4 Slice: character select, Blobs |  |
| round end | Best of 3 against a CPU, win and lose | `about-to-win`, `about-to-lose` | 4 Slice: round end, Blobs |  |

## 5. Gameplay iterations

Review: play-then-vote per variant, one feature at a time
Roles: role:gameplay, role:qa

| Feature | Knob | Variants | Ticket | Decision |
|---|---|---|---|---|
| play screen | Fall and soft-drop speed | slow, medium, fast | 5 Tune: fall speed, Blobs |  |
| chains | Chain pause length | short, medium, long | 5 Tune: chain pause, Blobs |  |
| character select | Auto-pick timer | off, 10 s, 20 s | 5 Tune: select timer, Blobs |  |
| round end | First-match CPU difficulty | easy, normal, hard | 5 Tune: CPU, Blobs |  |

## Build Order

```text
skeleton
├─ play screen: 1 concepts ─ 2 diorama ─ 3 clips ─ 4 slice ─ 5 fall speed
├─ chains: 1 concepts ─ 2 diorama (also play screen 2) ─ 3 clips ─ 4 slice (also play screen 4) ─ 5 chain pause
├─ character select: 1 characters ─ 2 diorama (also play screen 2) ─ 3 clips ─ 4 slice ─ 5 select timer
└─ round end: 1 concepts ─ 2 diorama ─ 3 clips ─ 4 slice (also chains 4) ─ 5 CPU
```
