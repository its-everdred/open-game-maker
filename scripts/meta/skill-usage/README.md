# Worker skill usage

Which skills aiur workers actually load, by work type (first run 2026-11-08: Blobs look tickets loaded no gm-* skill).

Run from an empty output dir:
1. `python3 -I scan.py`: Claude and Codex worker transcripts, written to `usage.json`.
2. `python3 -I scan2.py`: aiur agent-event logs, the only record of OpenRouter workers, written to `events.json`.
3. `gh issue list -R its-everdred/open-games --state all -L 400 --json number,title,labels -q '.[]|{n:.number,t:.title,l:[.labels[].name]}' > og-titles.jsonl` (the same for open-game-maker into `core-titles.jsonl`).
4. `python3 -I report.py > report.txt`: a table of work type by skill, plus the visual tickets with their gm skills.
