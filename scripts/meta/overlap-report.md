# Hourly overlap report

The hourly `scripts/meta/skill-usage/collect.sh` also runs the overlap collector when
`assets-local/experiments/overlaps/config.json` exists. It writes one JSON report per instance under
`assets-local/experiments/overlaps/reports/`; absent configuration produces a warning rather than a false zero.
Create the local, untracked configuration with one entry per game instance:

```json
{"instances": [{"name": "games", "launch_dir": "<game-instance-root>", "wakes": "<executor-wakes.ndjson>", "dispositions": "<dispositions.ndjson>", "coverage_complete": false}]}
```

Use absolute paths for all three paths. Create the dispositions file empty before the first run; the collector will not
silently create a missing journal or dispositions file.

If the reviewer and creator-delivery history have been reconciled for the full week, set `coverage_complete: true` and
`coverage_verified_at` to the verification's ISO-8601 time. The collector expires that assertion after two hours;
without a fresh verification it reports unknown metrics. Missing inputs or a failed registry read fail the collection
without replacing the prior reports; inspect each report's `generated_at` before relying on it.

Run `aiur-main feature show --json > <features.json>` in the game instance, then run
`node scripts/meta/overlap-report.ts --features <features.json> --wakes <executor-wakes.ndjson> --dispositions <dispositions.ndjson>`
for each game repository in the hourly meta pass. The wake journal is Aiur's durable Executor wake journal; select the
one for that repository. The report lists each feature's proposals and actions from the last hour and counts confirmed
duplicate implementations and overlapping questions that reached the creator in the last seven days. The question
target is zero.

The reviewer reports candidates, not confirmed duplicate implementations. During each hourly pass, the meta agent
reviews each candidate and records one JSON object per wake ID in the dispositions file, replacing that object's entry
when its status changes:

```json
{"wake_id": 42, "classification": "duplicate_implementation", "finding_id": "attack-9-12", "reviewed_at": "2026-11-26T12:00:00Z", "finding_evidence": "both implement attack routing", "feature": "combat", "acted_at": "2026-11-26T12:05:00Z", "action_evidence": "folded #12 into #9; carried src/attack.ts"}
```

Classifications are `duplicate_implementation`, `overlapping_question_reached_creator`, `not_duplicate`, or
`unknown`. Count a question as reaching the creator only with delivery evidence, not merely an overlap warning. Omit
`acted_at` and `action_evidence` until an action occurred; when present, evidence must identify the owner and any files
or assets carried over. Confirmed duplicates and repeated questions require `finding_evidence`; repeated questions also
require `reached_at` with the delivery timestamp. Set `feature` for records whose wake does not name one. Unclassified records remain visible and
are never counted as confirmed duplicates. A missing journal or disposition file fails the command; an empty journal
does not establish that the reviewer was running. Weekly metrics remain `null` until reviewer and delivery coverage for
the full week has been verified and `--coverage-complete` is supplied; any feature with unclassified proposals remains
`null` even then. Verify the creator-delivery history separately: if any repeated question has no corresponding wake,
do not assert complete coverage. The separately named confirmed counts are lower bounds when coverage is incomplete.
Hourly raised and acted totals are also `null` without verified coverage; their observed counts remain available.
Use the same `finding_id` for repeated wakes about one duplicate implementation; for repeated questions, `delivery_id`
identifies the actual repeat sent to the creator. Counts deduplicate those IDs within each feature.
