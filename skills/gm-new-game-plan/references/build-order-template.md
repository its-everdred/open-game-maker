# Ladder plan: <game>

Copy to `games/<name>/design/ladder.md` and fill it in from the spec and the flow diagram (rules in
`prototype-ladder.md`). Keep the five stage headings, their order and their Review and Roles lines; add one row per
feature. Check it with `node .claude/skills/gm-new-game-plan/scripts/check-ladder.ts games/<name>/design/ladder.md`.

Features (flow nodes): <feature>: `flow: <node>`; ...

## 1. Concepts

Review: pick or reject per concept (A/B/C with images and audio)
Roles: role:game-design, role:audio

| Feature | Concepts | Ticket | Decision |
|---|---|---|---|
| <feature> | <looks, characters, music, sound effects, voices> | | |

## 2. Dioramas

Review: "Keep this diorama, or change one of these?" (diorama beside concept)
Roles: role:3d, role:assets

| Feature | Diorama (engine, camera) | Feasibility gaps | Ticket | Decision |
|---|---|---|---|---|
| <feature> | | | | |

## 3. Rendered gameplay clips

Review: pick per clip (phone-ready MP4)
Roles: role:visual

| Feature | Clips (a few seconds each) | Audio on them | Ticket | Decision |
|---|---|---|---|---|
| <feature> | | | | |

## 4. Video to real gameplay

Review: play-then-vote cards beside the approved clip
Roles: role:gameplay, role:qa

| Feature | Playable slice | Scenarios | Ticket | Decision |
|---|---|---|---|---|
| <feature> | | | | |

## 5. Gameplay iterations

Review: play-then-vote per variant, one feature at a time
Roles: role:gameplay, role:qa

| Feature | Knob | Variants | Ticket | Decision |
|---|---|---|---|---|
| <feature> | | | | |

## Build Order

```text
skeleton
└─ <feature>: 1 concepts ─ 2 diorama ─ 3 clips ─ 4 slice ─ 5 iterations
```
