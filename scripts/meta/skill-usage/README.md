# Skill experiment collection

This work in progress collects evidence locally under `assets-local/experiments/skills/`.
Do not commit that directory: rollout and artifact records can contain local paths.

- `inventory.py` discovers skill instructions and updates `docs/meta/skills/inventory.json` and its Markdown view. A SHA-256 identifies the instruction contents. Unknown provenance, licence and original installation date are left unknown. `first_seen` is the discovery date, not a claim about when a skill was installed.
- `scan.py` reads Codex and Claude rollouts; `scan2.py` reads Aiur event logs. They keep byte offsets and turn aggregates in `state.sqlite3`, then replace `ledger.jsonl` with a deterministic export. Their defaults include files modified since 2026-11-08.
- `metadata.py` retrieves GitHub label-change history for tickets in the ledger and reconstructs labels at each turn, recording the observation time. Re-run it when new turns appear; unavailable issue history stays unknown.
- `artifacts.py --repo <repo> --ticket <number> --commit <sha> --post-id <comment-id> [--turn-id <turn-id>] --skill <skill> [--target <file>] [--score <json>] <file>...` records explicitly attributed visual files. Each file is copied by hash, so overwriting a render does not change an earlier iteration. Use `--skill` once per skill.
- `scan-posts.py` incrementally checks issue comments for review files and imports recoverable media; only explicit ready posts count as iterations, while other references remain unclassified. Unresolved files keep their cursor pending.
- `backfill-posts.py --repo <repo> --ticket <number> <comments.json>` imports candidate paths from an issue-comment JSON export. It marks attribution as historical inference and refuses files modified after the comment; missing or changed files are reported.
- `experiment-report.py` writes a self-contained `report.html`, embedding available images and videos. Missing values remain unknown, and attribution alone does not prove that a skill caused an outcome.
- `collect.sh` runs both scanners and refreshes the report; it is silent on success and serializes invocations with a local lock. After this change merges, the Executor will add it to the host hourly audit and meta-improve pass.

Complete malformed records are recorded as errors with their file and byte offset; collectors return failure until the data gap is resolved. Incomplete trailing lines are retried on the next run. If a file is replaced or truncated, collection refuses to replay it on top of existing aggregates: rebuild the local ledger into a fresh state directory after preserving any artifact records. Do not delete the original logs. Cursor commits and aggregates are transactional, but the JSONL exports are derived files and can be regenerated.

The current implementation does not yet provide complete acting-skill attribution, all requested labels and timing metrics, or an automated comparison of newly introduced skills. It is not evidence of a complete historical backfill.

Run the focused checks with:

```sh
python3 -m unittest discover -s scripts/meta/skill-usage -p 'test_*.py'
```
