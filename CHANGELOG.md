# Changelog

## Unreleased

### Renamed: checkpoint → Command (#571)

Game Maker uses aiur's word for a question to the creator.

- `gm checkpoint open|wait` is now `gm command request|wait`. `gm checkpoint` still works for this release, hidden from
  `gm help`, and prints the new name; it is removed in the next release.
- API: `/api/v1/jobs/:jobId/checkpoints/...` is now `/api/v1/jobs/:jobId/commands/...`; the health detail
  `checkpoint_decisions` is now `command_decisions`.
- `OGM_CHECKPOINT_POLL_MS` is now `OGM_COMMAND_POLL_MS`; a host env file that still sets the old name falls back to the
  default (5000 ms).
- Workspace files: `.gm/outbox/checkpoint.jsonl` is now `.gm/outbox/command.jsonl` (line type `command.request`) and
  `.gm/inbox/checkpoints/` is now `.gm/inbox/commands/`.
- Database: the `checkpoints` table is now `commands`; migration `20261109125710_command_rename` carries stored rows
  over. Commands raised before the upgrade keep their `gm-checkpoint:` marker in aiur and still correlate.
