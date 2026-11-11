# Skill self-scoring experiment

Status: intended registration, not registered in Aiur. The experiment is exploratory and post-hoc: historical rollout and artifact availability and aggregate turn counts were inspected while implementing the collectors. Do not describe this as a blind pre-registration.

## Hypothesis

Skills that self-score each iteration against a concept reach parity in fewer iterations and tokens. Compare similar ticket types and record which skills were mapped, read and acting; association does not establish causation.

## Design and window

Use a `before_after` design. The before window starts on 2026-11-08 and ends when open-game-maker #706 merges. The after window begins at that merge and ends when Blobs v1 ships. Assign turns to windows by their start time. Record the actual merge SHA and timestamp once known; neither is known yet. Changes in model, effort, ticket difficulty, target and asset availability are potential confounders.

## Measures

- Iterations to judge-pass: count visual iterations on a ticket until the first judge pass; tickets without a pass are censored, not zero.
- Tokens per iteration: total observed input and output tokens attributed to an iteration. Report missing accounting separately.
- Wall time: elapsed time from the first iteration to judge-pass, and per-iteration elapsed time where timestamps exist.
- Final score per tier: the last available judge score for silhouette, light and colour, materials, and detail. Retain missing tiers as unknown.

The primary outcomes are iterations to judge-pass and tokens per iteration, both expected to decrease. Wall time and final tier scores are descriptive secondary outcomes; a lower iteration count does not count as improvement if quality deteriorates. Compare ticket types only when role labels, targets and measures are available. Track incomplete records, missing images, aborts and changes to the scoring method.

## Registration limitation

On 2026-11-10, `aiur-main experiments create --from <file> --draft --no-freeze --json` rejected the intended design because `design.change.time` and both window boundaries require timestamps, while the #706 merge has not happened. The installed metric catalog exposes only the delivery-speed pack, not the four measures above. No experiment was created. After #706 merges and an appropriate metric pack exists, register the actual boundary and measures through the Aiur CLI, preserving this note and disclosing the post-hoc history. Do not invent a merge date or substitute unrelated delivery metrics.
