# Changes from apekshik/anykit@9ab61cac00a5eb3afdd87d5ee989134930c307b8

- SKILL.md: upstream `agent/KIT.md` with skill front matter and a project-rules section added on top; the KIT.md text below it is unchanged.
- scripts/normalize.py: upstream `kit/tools/normalize.py`, unmodified.

Not vendored: `generate/fal.mjs`, `kit/gen.mjs`, `app.py`, `client.py`, `agent/` harness and `pipeline/` (the hosted
fal app, its own fal client and spend log). fal calls go through `skills/gm-sprite-forge/scripts/fal3d.py` and its
single ledger instead. AnyScene and AnyShot (same author) were reviewed and not vendored: AnyScene's prop step is the
same Tripo-plus-Meshy pick as this kit, and AnyShot directs cameras, not models.
