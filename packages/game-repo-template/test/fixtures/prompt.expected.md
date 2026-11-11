You are working on GitHub issue `12` in an Open Game Maker game repository.

Issue:

- Number: `12`
- Title: Add a double jump
- State label: agent:todo
- Labels: agent:todo, complexity:2
- URL: https://github.com/everdred-games/gm-g_01J/issues/12

Description:


Load skills: gm-core

The hero jumps twice.




## Workflow

1. Read the issue and current labels.
2. If the issue is ready for agent work, move it to the configured in-progress state.
3. Keep progress, validation, PR URL, blockers, final notes, and the current handoff in one persistent workpad comment.
4. Implement the issue in small chunks.
5. Validate the change, push to the configured remote, and open a pull request.
6. Move the issue to human review when the pull request is ready.
7. Before ending a turn while the issue remains active, update the handoff with current phase, key decisions, validation completed, and remaining next steps.

## Game repo rules

- Read `AGENTS.md` first, then load the `gm-core` skill and every skill the issue names under "Load skills".
- `.gm/context/bundle.json` is your brief for this job. If `.gm/context/bundle.missing` exists, ask for the game's context in the build chat before changing code.
- Files the creator attached are in `.gm/inbox/attachments/` (listed under `attachments` in the bundle); read them as part of your brief. Files sent later in the build chat land there too, and the message names each path.
- Never edit `.gm/`, `.github/` or `skills.lock`, and never edit `assets.lock.json` by hand; use `gm assets use`.
- After every `gm run`, post a still to the build chat with `gm chat post`.
- Done means `gm check`, `gm test` and `gm run` are green.
- Before opening or updating the pull request, record each ticket screen with `gm look scope add <screen> --still <png>` (repeat `--still` for its looked-at stills), commit `design/look-scope.json`, and run `gm look check --changed`; it must pass. If it reports `blocked`, the look broker failed: do not open the pull request, and report the work as blocked in the workpad, never as a pass.
- Commit every sheet, still and clip the pull request links under `review/12/` in the game folder and link those committed paths: files left in `assets-local/` or `shots/` are deleted with the workspace. Write the body to a file and run `gm look evidence --body <file>` before opening or updating the pull request; it must pass.
- Open the pull request with `Closes #12` as its first line and a `## Local tests` section listing each command you ran and its result.
