# Answer routing: keeping a Build Order fluid

A creator's answer to a Command often reaches beyond the ticket that asked. Nothing may go stale because of it.

## Who acts

1. **The asking worker** acts on everything inside its own ticket's files and skills.
2. Anything outside it, it writes as `Out of ticket:` lines in its workpad and emits a `decision.followup` event (answer id, a privacy-safe summary of the feedback, the affected domain).
3. **The Executor** reads every answer and every followup and edits the order. Neither redoes the other's part.

## Work that waits on an answer starts by itself

A ticket that cannot go on until the creator answers is parked on that decision, not left for the Executor to notice:
`gm build park <ticket> --on <decision-id|key>`. Give the Command a key (`gm decide --key <game>/<topic>`) to park
tickets before it is raised. Follow-up work an answer will need is filed (or left closed) ahead of time and parked the
same way with `--when <option>`. When the answer arrives, each waiting ticket gets it as a `gm-decision-answer` comment
and is queued; a follow-up for an option that was not picked is closed. A worker that starts from such a ticket reads
that comment first.

## What the Executor does with a followup

1. Record any rejection in the game's ledger first (`gm options reject`).
2. Reopen the owning stage ticket, or create one (`<domain>: <change>`), with the summarised reason and the decision id under `Decisions:`.
3. Add blocker edges from the tickets that consume it, and append `Context update (dec_…)` to each of them.
4. **Pair-confirm:** when the change affects a paired asset (a character and its voice, a stage and its music), create a confirm ticket blocked by both sides. Its worker raises one Command showing each pair together (the character image beside its voice clip).
5. Message running workers (`aiur-main message`) and queue the new or reopened tickets.
6. Cap re-plan rounds at 2 per answer, then ask the creator.

## Premise sweep

Every ticket lists the decisions, specs and files it was written from (`Decisions: D-02, D-05`, `Spec: <path>`, `Owns: <path>`, `context-sha: <sha>`). Before a ticket dispatches, and on every Executor cycle, run `gm plan premises --tickets <file> --decisions <file>` from the game's folder, with the tickets from `gh issue list --state open --limit 1000 --json number,title,body,state` and the decisions from `GET /internal/games/<id>/design-decisions`. Paths are relative to the repository root. It needs no model: it prints JSON naming each open ticket whose decisions were revised, superseded, mooted (a later ledger rejection took the answer back) or unknown, or whose spec or owned files changed after `context-sha`, plus the tickets that name no premise (`unchecked`); it exits 1 when any is flagged, and the report is on stdout either way. Rewrite only the flagged tickets: refresh, close as moot, or reopen them. Late tickets always start from current context.

## Example

Audio answer: "the voice doesn't match the character's look; recreate the character".

1. The audio worker lacks the visual skills, so it emits a followup.
2. The Executor reopens the character's visual stage and blocks the voice wiring on it.
3. It files `confirm: <character> look + voice`. That ticket shows the new character with its voice in one deck.
