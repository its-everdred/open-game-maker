# Open Game Maker 2000

Kevin's voice-first game maker. This repo holds research, the scope, prototypes and the skills Game Maker's agents will
use. Work here the way those agents will work: dogfood the skills.

- **Creator requests** (a scene, a screen, a look): follow `gm-design-loop`, with `gm-assets` (packs first, lineups),
  `gm-asset-variants` (clone, never edit originals) and `gm-verify` (look before sending; MP4 for the phone).
- **No needless text** in what you build: a button whose icon is clear gets no label (put the words in `aria-label`),
  and no taglines, captions or helper sentences unless Kevin asks for them.
- **Scripted edits to JS** (python/sed splices): never put a `//` comment inside a replacement unless the line ends
  there; use `/* */` mid-line. A swallowed tail is still valid syntax, so `node --check` won't catch it (it dropped a
  scene's arguments and an iframe's attributes here); render or run the change before moving on.
- **Sprite Forge skills** (`agent-sprite-forge` plugin, project scope in `.claude/settings.json`: generate2dsprite,
  generate2dmap, video2dsprite, generate2dmedia, codeart2d): run their scripts with
  `gm py --` (provision with `gm py setup` on the host). No API key is configured, so `route_media.py` falls
  back to the signed-in Codex CLI; never add a provider key (it counts as consent to spend) and ask Kevin before any
  generation. Never send paid-pack assets to it as references (no cloud processing of paid assets).
- **Self-improvement:** keep the hourly `meta-improve` listener running (a silent background shell, `scripts/listen.sh`
  in the skill, that wakes the agent only after Kevin has written; start it at the start of a session, no cron). Lessons persist in skills, scripts and memory; `docs/meta/` is the hourly record.
- **Branch and safety:** commit research to `research` as you go; never commit `assets-local/`, keys, download links or
  serials. Origin is an SSH URL with no key here: push over HTTPS with gh credentials,
  `git -C <repo> -c credential.helper='!gh auth git-credential' push "$(git -C <repo> remote get-url origin | sed 's#git@github.com:#https://github.com/#')" research`
  (one commit at a time if it disconnects). Deploy the web app (`apps/web/tools/deploy.sh`) only when Kevin says so; Netlify credits
  are limited.
