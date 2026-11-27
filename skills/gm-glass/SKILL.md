---
name: gm-glass
description: Apply the approved OGM Glass system when changing the Open Game Maker web shell, menus, editor chrome, or app screens; it does not govern game-owned art or HUDs.
---

# OGM Glass web work

Read `docs/design/ogm-glass/tokens.json`, `components.md`, `screens.md`, and `glass.css` for the approved artboard and its implementation contract. Load the existing [impeccable skill](../vendor/impeccable/impeccable/SKILL.md) for the web work; the approved artboard and creator decisions control the visual result. Do not create a competing design system or change a game's own art to match app chrome.

Use the shared Glass components and generated tokens for new or changed app surfaces. Keep content and states aligned with the relevant artboard. Run `gm design parity --screen <Home|Editor|Settings|SignIn|NewGame|GameSheet|Admin>` for a covered screen; Editor requires `--dist` for a real game. A missing capture is not a passing comparison. Inspect the side-by-side and heatmap, complete the generated detail checklist with crops, and attach the report to the screen PR. When a real device or build is unavailable, record the exact post-deploy check under `## Local tests` instead of claiming it ran.
