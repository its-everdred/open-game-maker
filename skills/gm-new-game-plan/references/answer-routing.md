# Answer routing: keeping a Build Order fluid

A creator's answer to a Command often reaches beyond the ticket that asked. Nothing may go stale because of it.

## Who acts

1. **The asking worker** acts on everything inside its own ticket's files and skills.
2. Anything outside it, it writes as `Out of ticket:` lines in its workpad and emits a `decision.followup` event (answer id, a privacy-safe summary of the feedback, the affected domain).
3. **The Executor** reads every answer and every followup and edits the order. Neither redoes the other's part.

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
