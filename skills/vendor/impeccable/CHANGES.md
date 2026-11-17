# Changes from pbakaus/impeccable@d41d9860b0094dcb68030657da63461212835aaa

- impeccable/SKILL.md: add provenance and worker front matter; describe the preinstalled engine and degraded path.
- `impeccable/scripts/impeccable` and `impeccable/scripts/impeccable.cmd`: fail immediately when `IMPECCABLE_BIN` is unavailable instead of searching or downloading an engine; force telemetry off and reject live, live-* and generate for workers.
- `impeccable/reference/extract.md`, `harden.md`, `optimize.md`: remove trailing whitespace.
