# Ladder plan: Blobs

A falling-blob versus puzzle: pairs of coloured blobs fall into a well, four of a colour clear, a clear that drops blobs
into a new clear chains, and chains send garbage to the opponent. A worked example of `../build-order-template.md`.

## Systems

| System | GitHub epic | Aiur feature | Stream lanes | Convergence prototype | Streams |
|---|---|---|---|---|---|
| Blobs play | Example epic | blobs-play | gameplay, UI | Example play prototype | play screen, chains, character select, round end |

## Features

| Feature | Flow node | Labels |
|---|---|---|
| play screen | `play` | game:blobs, role:game-design, role:audio, role:3d, role:assets, role:visual, role:gameplay, role:qa |
| chains | `core loop` | game:blobs, role:game-design, role:audio, role:3d, role:assets, role:visual, role:gameplay, role:qa |
| character select | `character_select` | game:blobs, role:game-design, role:audio, role:3d, role:assets, role:visual, role:gameplay, role:qa |
| round end | `round_end` | game:blobs, role:game-design, role:audio, role:3d, role:assets, role:visual, role:gameplay, role:qa |

## 1. Concepts

Review: pick or reject per concept (A/B/C with images and audio)
Roles: role:game-design, role:audio

| Feature | Concepts | Ticket | Decision |
|---|---|---|---|
| play screen | Four play-screen mocks in the kit; 3–4 music tracks by mood; 2–3 sound-effect sets (land, connect, clear) | Play screen: Blobs |  |
| chains | Two mocks of a clear and chain counter on the picked look; announcer: 2–3 voices saying "Nice!", "3 chain!", "Ready... go!" | Chains: Blobs |  |
| character select | Starting roster of 3, so six character cards (name, one-line personality); six voice samples per pick | Character select: Blobs |  |
| round end | Two round-end screen mocks per picked play-screen look | Round end: Blobs |  |

## 2. Dioramas

Review: "Keep this diorama, or change one of these?" (diorama beside concept)
Roles: role:3d, role:assets

| Feature | Diorama (engine, camera) | Feasibility gaps | Ticket | Decision |
|---|---|---|---|---|
| play screen | Two wells with blobs, frame, background and HUD from kit cards, fixed front camera | Glossy jelly blobs: a material variant of the kit's sphere piece, or the matte kit blob | Play screen: Blobs |  |
| chains | A mid-chain still: popping blobs, the counter and garbage queued over the opponent | Pop burst: kit particles, or a variant of the kit's star sprite | Chains: Blobs |  |
| character select | Each picked character from the kit's rigged models, posed on the play-screen diorama |  | Character select: Blobs |  |
| round end | Win and lose poses over the frozen board |  | Round end: Blobs |  |

## 3. Rendered gameplay clips

Review: pick per clip (phone-ready MP4)
Roles: role:visual

| Feature | Clips (a few seconds each) | Audio on them | Ticket | Decision |
|---|---|---|---|---|
| play screen | A pair moves, rotates, drops and locks; loose blobs settle | Picked music, land sound | Play screen: Blobs |  |
| chains | A four clears; a 3-chain with the counter; garbage falls on the opponent | Clear and chain-step sounds, announcer callouts | Chains: Blobs |  |
| character select | The cursor moves across the roster; the picked character waves and says their line | Select sound, character voice | Character select: Blobs |  |
| round end | The losing well tops out; the winner celebrates | Character win line, round-end sting | Round end: Blobs |  |

## 4. Video to real gameplay

Review: play-then-vote cards beside the approved clip
Roles: role:gameplay, role:qa

| Feature | Playable slice | Scenarios | Ticket | Decision |
|---|---|---|---|---|
| play screen | Move, rotate, drop and lock a pair on a phone; gravity settles loose blobs | `empty`, `tall-stack` | Play screen: Blobs |  |
| chains | Four of a colour clears; drops chain; garbage is sent | `chain-3` (one drop sets off a 3-chain), `sandbox` | Chains: Blobs |  |
| character select | Pick a character, then the match starts with them | `select` | Character select: Blobs |  |
| round end | Best of 3 against a CPU, win and lose | `about-to-win`, `about-to-lose` | Round end: Blobs |  |

## 5. Gameplay iterations

Review: play-then-vote per variant, one feature at a time
Roles: role:gameplay, role:qa

| Feature | Knob | Variants | Ticket | Decision |
|---|---|---|---|---|
| play screen | Fall and soft-drop speed | slow, medium, fast | Play screen: Blobs |  |
| chains | Chain pause length | short, medium, long | Chains: Blobs |  |
| character select | Auto-pick timer | off, 10 s, 20 s | Character select: Blobs |  |
| round end | First-match CPU difficulty | easy, normal, hard | Round end: Blobs |  |

## Standard tickets

| Asset | Ticket | Roles | Blocked by |
|---|---|---|---|
| Skeleton | Skeleton: Blobs | game:blobs, role:gameplay | None |
| Logo | Logo: Blobs | game:blobs, role:visual | Skeleton: Blobs |
| Flow diagram | Flow: Blobs | game:blobs, role:game-design | Skeleton: Blobs |

## Game media

| Asset | Ticket | Roles | Blocked by |
|---|---|---|---|
| Thumbnail | Thumbnail: Blobs | game:blobs, role:visual | Logo: Blobs; Play screen: Blobs |
| Loading image | Loading image: Blobs | game:blobs, role:visual | Play screen: Blobs |
| Trailer | Trailer: Blobs | game:blobs, role:visual, role:audio | Play screen: Blobs; Chains: Blobs; Character select: Blobs; Round end: Blobs |

## Build Order

```text
skeleton → flow diagram
├─ play screen: one ticket (mock → prototype → build → polish)
├─ chains: one ticket (mock → prototype → build → polish)
├─ character select: one ticket (mock → prototype → build → polish)
├─ round end: one ticket (mock → prototype → build → polish)
├─ play screen → thumbnail and loading image
└─ gameplay → trailer
```
