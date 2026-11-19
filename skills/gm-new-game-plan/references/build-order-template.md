# Ladder plan: <game>

Copy to `games/<name>/design/ladder.md` and fill it in from the spec and the flow diagram (rules in
`prototype-ladder.md`). Keep the five stage headings, their order and their Review and Roles lines; every stage table
has one row per feature in Features, with the same feature ticket title in every stage. Check it with
`node .claude/skills/gm-new-game-plan/scripts/check-ladder.ts games/<name>/design/ladder.md`.

## Features

| Feature | Flow node | Labels |
|---|---|---|
| <feature> | `<node>` | game:<slug>, role:<role> |

## 1. Concepts

Review: pick or reject per concept (A/B/C with images and audio)
Roles: role:game-design, role:audio

| Feature | Concepts | Ticket | Decision |
|---|---|---|---|
| <feature> | <looks, characters, music, sound effects, voices> | <ticket> |  |

## 2. Dioramas

Review: "Keep this diorama, or change one of these?" (diorama beside concept)
Roles: role:3d, role:assets

| Feature | Diorama (engine, camera) | Feasibility gaps | Ticket | Decision |
|---|---|---|---|---|
| <feature> |  |  | <ticket> |  |

## 3. Rendered gameplay clips

Review: pick per clip (phone-ready MP4)
Roles: role:visual

| Feature | Clips (a few seconds each) | Audio on them | Ticket | Decision |
|---|---|---|---|---|
| <feature> |  |  | <ticket> |  |

## 4. Video to real gameplay

Review: play-then-vote cards beside the approved clip
Roles: role:gameplay, role:qa

| Feature | Playable slice | Scenarios | Ticket | Decision |
|---|---|---|---|---|
| <feature> |  |  | <ticket> |  |

## 5. Gameplay iterations

Review: play-then-vote per variant, one feature at a time
Roles: role:gameplay, role:qa

| Feature | Knob | Variants | Ticket | Decision |
|---|---|---|---|---|
| <feature> |  |  | <ticket> |  |

## Standard tickets

| Asset | Ticket | Roles | Blocked by |
|---|---|---|---|
| Flow diagram | <flow ticket> | game:<slug>, role:game-design | <skeleton ticket> |

## Game media

| Asset | Ticket | Roles | Blocked by |
|---|---|---|---|
| Thumbnail | <composed art-only scene; follow the Thumbnail rule in SKILL.md> | game:<slug>, role:visual | <logo and graphics/look tickets> |
| Loading image | <loading image ticket> | game:<slug>, role:visual | <graphics/look tickets> |
| Trailer | <trailer ticket> | game:<slug>, role:visual, role:audio | <gameplay tickets> |

Record these as GitHub native blocked-by edges, not just prose. Refresh the affected media when the style or core gameplay changes.

## Build Order

```text
skeleton
├─ flow diagram
├─ <feature>: one ticket (mock → prototype → build → polish)
├─ logo + graphics/look → thumbnail
├─ graphics/look → loading image
└─ gameplay → trailer
```
