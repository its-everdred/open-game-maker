# <Game title> flow

Status: draft | in review (<command ids>) | approved (<decision ids>)

## Core loop

```mermaid
flowchart LR
  act[Player acts] --> result[Game answers] --> reward[Reward or threat] --> act
```

## Session loop

```mermaid
flowchart LR
  start[Round starts] --> core[Core loop] --> ends{Round ends}
  ends -->|win| score[Score and rewards] --> next{Match over?}
  ends -->|lose| score
  next -->|no| start
  next -->|yes| results[Match results]
```

## Meta loop

```mermaid
flowchart LR
  session[Session] --> unlock[What carries over] --> choose[Choice before the next session] --> session
```

## Navigation

```mermaid
flowchart TD
  title["<img src='screens/title.target.png'/><img src='screens/title.live.png'/><br/>title"]
  mode["<img src='screens/mode.target.png'/><img src='screens/mode.live.png'/><br/>mode"]
  play["<img src='screens/play.target.png'/><img src='screens/play.live.png'/><br/>play"]
  pause["<img src='screens/pause.target.png'/><br/>pause"]
  round_end["<img src='screens/round_end.target.png'/><br/>round_end"]
  room["<img src='screens/room.target.png'/><br/>room"]

  title -->|Play| mode
  mode -->|Solo| play
  mode -.->|Online| room
  room -.->|All ready| play
  play -->|Pause| pause
  pause -->|Resume| play
  pause -->|Quit| title
  play -->|Round over| round_end
  round_end -->|Again| play
  round_end -->|Menu| title
  mode -->|Back| title
  room -.->|Leave| mode
```

## Screens

| Node | Target | Live | Tickets |
| --- | --- | --- | --- |
| title | screens/title.target.png (decision id) | screens/title.live.png (build) | #n |

## Open choices

| Id | Question | Options (media) | Recommended | Decision |
| --- | --- | --- | --- | --- |
| flow-1 | Mode or character first? | A: render/a.png, B: render/b.png | A, reason | pending |
