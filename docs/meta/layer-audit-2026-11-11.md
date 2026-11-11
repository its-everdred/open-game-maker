# Layer audit, 2026-11-11

Kevin: build each feature at the right level of abstraction.
- **aiur:** any project.
- **Open Game Maker core:** any game.
- **Open-Games:** this game or pack.

## In the wrong place: move

| What | Where now | Belongs in | Move |
|---|---|---|---|
| Skill/agent analytics: `scripts/meta/skill-usage/` (core #708, fixes #720) | core | aiur | aiur ports it as built-in analytics (skills mapped/read/run per turn, tokens, kills, artifacts per ticket); core then deletes its copy. #720 moves to aiur. |
| Executor Command listener (`executor/command-listener.sh`) | host script | aiur | `aiur commands --wait-new` / an Executor wake on new Commands |
| Release pin and upgrade (`aiur-keep-current.sh`, the `.aiur-pin` logic in auto-update.sh, `aiur-release-build.sh`, the swap) | host scripts | aiur | `aiur upgrade [--pin <sha>]` keeps a fix until main contains it |
| `fresh-thread.sh`, `retry.sh` | host scripts | aiur | `aiur redispatch --fresh-thread`; built-in RPC retry |
| Worker defaults: decide-don't-ask, act on low-risk recommendations, never add your own blockers, never idle (draft PR on stop), gh timeout retry, push checkpoints rather than early PRs | both `.aiur/prompt.md` | aiur | aiur default worker prompt / aiur-agent skill |
| Game Maker worker rules in Open-Games' prompt: forge-venv Python, capture slots and app-shell capture, SwiftShader fallback, per-bundle asset budgets, register assets as you go, the scoped visual gate | Open-Games `.aiur/prompt.md` (untracked) | core skills | gm-verify, gm-build and gm-assets; `executor/shell-local/run.sh` becomes `gm capture shell` |
| Concept media index (`assets-local/review/blobs/MEDIA.md`) | uncommitted library | core convention + game file | gm-design-loop: every game keeps `games/<game>/design/MEDIA.md`; Blobs commits its own |

## In the right place: keep

- **core:** gm look score/judge (#706), gm test watchdog (#712), lazy asset phases (#714), look check `--changed` (#716), HUD capture (#717), gm-dream-loop and the bake-off skills (#707), style-check.py.
- **aiur:** probe-timer and stall-guard fixes (#7964, #7966).
- **skills repo:** meta-improve step 7 (capability gaps).
- **Open-Games:** goo renderer and motion, cast models, backdrops, select screen, Blobs targets.
