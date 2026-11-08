# `gm checkpoint`

Prepare a creator direction checkpoint, then copy the printed `emit_event` call into the agent tool:

```text
gm checkpoint open --job <id> --question "Which look?" --option a=Chunky --option b=Flat --recommend a
gm checkpoint open --job <id> --question "Which look?" --option a=Chunky --option b=Flat --media a=<chat-message-id>
gm checkpoint open --job <id> --question "Which fall speed?" --option slow=Slow --option fast=Fast \
  --playable 'slow=scenario=sandbox&speed=slow' --playable 'fast=scenario=sandbox&speed=fast' --seconds fast=6
gm checkpoint wait <checkpoint-id> --timeout 600
```

`open` writes `.gm/outbox/checkpoint.jsonl`. `wait` reads `.gm/inbox/checkpoints/<id>.json`; it exits 3 on timeout
and 4 when the checkpoint is moot. A checkpoint is non-blocking unless `open` receives `--blocking`.

A gameplay-feel question (speed, a chain's pause, controls) gives each option a `--playable <id>=<scenario query>`: the
review deck plays the game's build (`--branch`, default `main`) with that query for `--seconds` (default 8), after an
optional `--lead-in <id>=<move>`, then asks for a verdict. The question is one line of at most 120 characters, and
neither it nor a label may contain a link.

Without a build job (no `--job`, `GM_JOB` or `.gm/context/job.json`: a host checkout or an aiur workspace of an
existing game), `open` writes no outbox line and `--media` is refused. Each option's slice rides in the printed
call's `context` as a `gm-playable` marker, so once the call is made the Command shows in that game's review deck as
playable cards. `wait` does not apply; the answer arrives through aiur.
