# Creator preferences

Each JSON file records an attributable preference. `quote` is the creator's exact wording, `date` is its date, and `source` links to its record. `owner_ticket` identifies the implementing ticket. `scope` is `all`, `game:<slug>`, `role:<role>`, or `lane:<lane>`. A `review-only` check states why automation cannot verify the rule.

Use the same `topic` for mutually exclusive answers to one decision and a normalized `value` for each answer. For overlapping parent and child topics, classify the relationship by listing the other preference ID in `conflicts_with` or `compatible_with`. Unclassified overlaps fail the check; ask the creator when the relationship is unclear. Contradictory preferences whose scopes can apply together require an explicit resolution. A newer entry that clearly replaces an older one lists its ID in `supersedes`; the older entry must have `status: "superseded"` and point back with `superseded_by`. Otherwise report both quotes and dates for a creator decision; do not silently choose a winner.

After editing entries, run `gm prefs sync` from the core checkout. It updates the generated gm-core section and the CLI's packaged snapshot. `gm prefs check` and `gm check` reject stale copies.
