# Game verification

QA journeys can exercise a virtual standard gamepad with a step such as
`{"do":"pad","buttons":[0],"axes":[-1,0],"holdMs":150}`. Buttons are standard
gamepad button indices (0–16); axes are values from -1 to 1 (up to four).
The step holds those inputs, then releases them. The first pad step needs a
button to claim the controller. `holdMs` defaults to 100 and must be at least
50 milliseconds. See `skills/gm-qa/SKILL.md` for journey setup and limitations.

For shell captures, `gm look shell --dist <game/dist> --out <directory>
--scenario <name>` starts a declared scenario inside the game iframe.
