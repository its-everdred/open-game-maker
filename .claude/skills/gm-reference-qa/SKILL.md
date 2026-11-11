---
name: gm-reference-qa
description: Review a 3D asset against its reference and report specific defects with severity and evidence.
license: MIT
---

# Reference QA

Adapted from `arjun988/blender-skills` QA Review, commit `904f095d8f36a6e72adaebb08d07f884a074743d` (MIT).
Use this after an asset or look-development milestone. Load `gm-verify` and `gm-dream-loop` for the scored comparison.

Capture a settled, reference-matched view and a three-quarter view. Add an orthographic or profile view when proportions
matter, and a wireframe when topology is in question. For a game runtime, capture actual engine stills as well as Blender
renders; do not depend on Blender MCP being installed. Record camera, scale, triangle and texture budgets with the stills.

Compare the same subject, pose, framing and game state where possible. List specific visible defects as blockers, major
or minor, worst first, with a concrete next action for each. Broken normals, wrong scale or a failed budget are blockers;
wrong silhouette or readability is major. Do not infer defects from mismatched crops. A screenshot review gives a
ship / ship with notes / no-ship verdict, not a numeric fidelity score. Re-capture and re-check after fixes; do not claim
a visual pass without inspecting the evidence. Keep licensed assets local and follow the broker's reference policy.
