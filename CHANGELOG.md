# Changelog

## Unreleased

### Renamed: checkpoint → Command (#571)

Game Maker uses aiur's word for a question to the creator.

- `gm checkpoint open|wait` is now `gm command request|wait`. `gm checkpoint` still works for this release, hidden from
  `gm help`, and prints the new name; it is removed in the next release.
- API: `/api/v1/jobs/:jobId/checkpoints/...` is now `/api/v1/jobs/:jobId/commands/...`; the health detail
  `checkpoint_decisions` is now `command_decisions`. `POST /api/v1/jobs/:id/decide` takes and returns `commandId`;
  build-chat messages carry `kind: 'command'` with a `command` field keyed `command_id`; error codes `checkpoint_*`
  are now `command_*`. Deploy the web app with the API: a page built before the rename shows a Command as plain text
  and cannot answer it.
- `OGM_CHECKPOINT_POLL_MS` is now `OGM_COMMAND_POLL_MS`; a host env file that still sets the old name falls back to the
  default (5000 ms).
- Workspace files: `.gm/outbox/checkpoint.jsonl` is now `.gm/outbox/command.jsonl` (line type `command.request`) and
  `.gm/inbox/checkpoints/` is now `.gm/inbox/commands/`. For this release the API still reads `checkpoint.open` lines
  and also writes answers to `.gm/inbox/checkpoints/`, and `gm command wait` reads an answer left there, so a job
  running across the upgrade keeps its Command.
- Database: the `checkpoints` table is now `commands`; migration `20261109125710_command_rename` carries stored rows
  over. Commands raised before the upgrade keep their `gm-checkpoint:` marker in aiur and still correlate.
