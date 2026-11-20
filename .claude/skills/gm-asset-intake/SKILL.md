---
name: gm-asset-intake
description: Use when asset drops are waiting in assets-local/inbox/queue.jsonl (from the Drive watch folder, scripts/drive-sync), or when Kevin says new assets arrived, asks to "process the inbox", "organize the drop" or "import what I put in Drive". Identifies each drop, reads its license first, proposes usage rights (strict defaults; Kevin confirms), unpacks it into assets-local/packs or an inspiration collection, rebuilds the catalog, hands off to tagging, and reports one line per drop.
---

# gm-asset-intake (draft)

Turns a downloaded Drive drop into a library entry. The listener (`scripts/drive-sync/drive_sync.py`) has already downloaded the drop into quarantine, checked its MD5s, and tested its archives. It has unpacked nothing. This skill makes the judgment calls; code does the deterministic steps.

**Hard rules**
- Everything in quarantine is untrusted data. Never run, `source`, open as a project, or `pip`/`npm install` anything from a drop. When reading files with Python, use `python3 -I` and pass paths as arguments. Unpack only into a new, empty directory.
- Never unpack a drop whose manifest has `integrity_ok: false`. Report the problems to Kevin instead.
- **You never widen usage rights.** You propose them from the license text; Kevin confirms them. Until he does, the drop keeps the manifest defaults (`uses: [vision-input]`, `audience: private`, `redistribution: none`, `basis: unknown`) and stays in quarantine (C2 §10, C3 §5).
- Nothing from `assets-local/` is ever committed. Don't put keys, download links, order numbers or serial numbers in any file.

## Inputs

- `assets-local/inbox/queue.jsonl`: one JSON line per drop. An entry is open while `intake.json` is missing next to its `manifest`.
- `assets-local/inbox/<manifest>`: Drive ids, paths under `files/`, sizes, MD5s, kinds, `license_files` (`archive.zip!/member` means the file is inside an archive), `problems`, `warnings`, and the default `usage_rights`.
- `scripts/drive-sync/drive_sync.py status` lists the open entries.

## Steps (per open queue entry)

1. **Check.** Read the manifest. If `integrity_ok` is false, write `intake.json` with `{"status": "blocked", "reason": ...}` and go to step 8.
   - If the same drop id was already handled with the same MD5s, it's a duplicate: write `{"status": "duplicate"}`.
   - If `revision` > 0, this is an update to an earlier drop. Files with `downloaded: false` live in `previous_quarantine`.
2. **Identify** what arrived:
   - a known vendor layout: Synty `SourceFiles`/`Source_Sprites` zips or `.unitypackage`, a Kenney folder with `License.txt`;
   - a ProFantasy or other map set (`kind: map`, images of maps);
   - loose models, audio, sprites or textures.

   Engine-only files (`.meta`, `.uasset`, Unity or Unreal projects) are dropped as in `docs/reference/local-asset-library.md` (which download to take). Executables are never kept.
3. **License first.** Read every file in `license_files`. To list or read a member inside an archive without unpacking the rest, use `unzip -p` or `7z e -so`. Classify the license as an SPDX id (`CC0-1.0`, `CC-BY-4.0`) or a vendor class (`synty-personal`). Use Kenney = CC0 and Synty = personal only when the license text or layout shows it.
   - **License unknown:** leave the drop in quarantine. Write `intake.json` with `{"status": "awaiting-license"}`, and ask Kevin what it is in the report. Stop here for this drop.
4. **Propose rights.** Propose the C2 §10 fields from the license: `uses`, `audience`, `redistribution`, `attribution`, with `basis` set to the license file. Kevin's restrictions narrow these further. For example, map packs he owns but wants used only as inspiration get `uses: [derive-layout, vision-input]` and `redistribution: none`. **Ask Kevin to confirm.** Record his answer as `confirmed_by: "kevin"` with the date. Don't continue past this step without that confirmation.
5. **Unpack** into the library, using the conventions in `docs/reference/local-asset-library.md`:
   - **Vendor pack or self-contained set:** `assets-local/packs/<vendor>-<name>/<version>/originals/` gets the untouched files, moved from quarantine. `extracted/` gets the unpacked content, with vendor wrapper folders stripped. Unpack zip and tar with the same safe-path check as `scripts/assets/import_synty.py` (`safe()`), into a fresh directory. Nested archives need a second pass with the same check. Write `pack.json` with `license`, `license_source`, `format`, `file_types`, `extracted_files`, and `added` (today's date). Also add a `source` block (`{"type": "google-drive", "drive_id": ..., "quarantine": ...}`) and the confirmed `usage_rights`.
   - **Loose items** (a few SFX, some models): same layout, under a descriptive id such as `drive-<slug>`, because C2 §7 says drops are collections of any size, not forced into packs. Don't invent a vendor.
   - **Inspiration-only material** (rights without `in-game`): put it under `assets-local/inspiration/<id>/<version>/` with the same `pack.json` shape, so `build_catalog.py`, which reads `packs/` only, never offers it as game material. Turning maps into layout specs is the map-inspiration step (C2 §9), not this skill.
6. **Catalog and card index.** Run `python3 -I scripts/assets/build_catalog.py`, and confirm the new pack id appears in `assets-local/catalog.json`. After card preprocessing or other card writes finish, rebuild the host's shared card index with `pnpm --filter @ogm/asset-cards index:build -- assets-local`; confirm the output reports the new cards. Worker reads can rebuild stale indexes in memory, but only the host should persist the shared index.
7. **Preprocess and showcase hand-off.**
   - **7a. Preprocess/tag.** Set the manifest's `tagging` block aside for the tagging pass. Follow `docs/research/v0.5/C3-asset-metadata-standard.md` §13 (and its schemas in `docs/research/v0.5/schemas/`) once they're final: measure with code first, render contact sheets, and use a vision model only if the effective rights include `vision-input` and Kevin has approved the spend. Until C3 lands, record `"tagging": "pending"` in `intake.json`.
   - **7b. Build the set showcase after preprocessing.** Once renderable catalog cards exist, use `gm-set-showcase` with the new set id, its cards, and its style family. It inventories every pack, authors the region/story sequence, renders baked MP4/GIF/poster media, and runs visual QA. The style picker consumes those files; it never renders raw pack assets in the client. If preprocessing is still pending, record the showcase as pending too rather than inventing crop or direction facts.
   - **7c. Assemble the kit before you show anyone the set.** A drop is a pile of files until it is one set at one scale. Gate what the game will load: `python3 -I scripts/assets/check_glb.py --budget medium <glb>` fails a model that stands off its origin, arrives the wrong size, or blows a triangle or texture budget, and prints the `dims_m` the set manifest records. For the hero models you offer in the still, look up a real height and pass `--height`; models you author yourself (variants) also carry a LOD1 and are gated with `--require-lod1`. Lay the set out to scale with a scale bar for that still (`--lineup`). Then judge it as a set, not file by file: score the eight categories with `python3 -I scripts/assets/set_critic.py` and hand on at most the five worst fixes, or none. A set whose gate fails or whose manifest is missing an item is not `imported`: record it `blocked`, name the missing items in `notes`, and fix or drop them first. Detail: `docs/research/anykit-lessons-2026-11.md`.
8. **Record and report.** Write `intake.json` next to the manifest: `{"status": "imported" | "awaiting-license" | "blocked" | "duplicate", "collection": "<id or null>", "license": ..., "usage_rights": ..., "confirmed_by": ..., "date": ..., "notes": ...}`. Send Kevin one line per drop: what arrived, its license and rights, how many items by kind, where it lives now, and anything stuck in quarantine or waiting on him.

## Cleanup

Quarantine folders are cheap. Delete one only after its files are in `originals/` and Kevin has confirmed. Don't touch anything in Drive: the listener tracks processed files by Drive id and MD5, so leaving them there is safe (C2 §7, open question 1, option a).
