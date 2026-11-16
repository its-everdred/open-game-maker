after_create: |
  set -eu
  %%CLONE%%
  ticket="${AIUR_HOOK_TICKET_IDENTIFIER:?}"
  git checkout -b "${AIUR_TICKET_BRANCH:-aiur/${ticket}}" "origin/$THIS_BASE_BRANCH"
  mkdir -p .gm/context
  case "$ticket" in ''|*[!0-9]*) rm -f .gm/context/ticket ;; *) printf '%s\n' "$ticket" > .gm/context/ticket ;; esac
  rm -f .gm/context/bundle.json .gm/context/bundle.missing .gm/context/design.json .gm/context/design.missing
  secret="$(cat "${OGM_HOOK_SECRET_FILE:?}" 2>/dev/null || true)"
  if [ -n "$secret" ] && curl -fsS --max-time 20 -H "Authorization: Bearer ${secret}" \
      "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/bundle" \
      -o .gm/context/bundle.json; then
    if ! curl -fs --max-time 20 -H "Authorization: Bearer ${secret}" \
      "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/design" \
      -o .gm/context/design.json || ! node -e '
        try {
          const s = JSON.parse(require("node:fs").readFileSync(".gm/context/design.json", "utf8"));
          const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
          if (!Number.isInteger(s.rev) || s.rev < 0 || !(s.buildId === null || typeof s.buildId === "string") ||
              !record(s.doc) || !Number.isInteger(s.doc.schemaVersion) || !record(s.doc.globals) || !record(s.doc.entities)) process.exit(1);
        } catch { process.exit(1); }
      '; then
      rm -f .gm/context/design.json
      echo "design snapshot unavailable" > .gm/context/design.missing
    fi
    want="$(node -p "require('./.gm/context/bundle.json').skillPackVersion")"
    have="$(node -p "require('./skills.lock').pack" 2>/dev/null || echo none)"
    kind="$(node -p "require('./.gm/context/bundle.json').kind || ''")"
    if [ "$kind" = feature ]; then
      echo "bundle inputs incomplete" > .gm/context/bundle.missing
    fi
    if [ "$want" != "$have" ] || [ "$kind" = feature ]; then
      url="$(node -p "require('./.gm/context/bundle.json').skillPackUrl")"
      if curl -fsS --max-time 60 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" "$url" -o .gm/context/skills.tgz; then
        for dir in .claude .claude/skills .codex .codex/skills .agents .agents/skills; do
          [ ! -L "$dir" ] || { echo "unsafe skill directory" >&2; exit 1; }
        done
        mkdir -p .claude/skills .codex/skills .agents/skills
        rm -rf .claude/skills/gm-*
        tar -xzf .gm/context/skills.tgz -C .claude/skills
        for skill in .claude/skills/gm-*; do
          [ -f "$skill/SKILL.md" ] || continue
          name="${skill##*/}"
          for target in .codex/skills .agents/skills; do
            if [ -L "$target/$name" ]; then
              [ "$(readlink "$target/$name")" = "../../.claude/skills/$name" ] || { echo "unsafe skill discovery link" >&2; exit 1; }
            elif [ -e "$target/$name" ]; then
              echo "unsafe skill discovery entry" >&2; exit 1
            else
              ln -s "../../.claude/skills/$name" "$target/$name"
            fi
          done
        done
      fi
    fi
    if [ "$kind" = feature ] && [ ! -f .claude/skills/gm-prototype/SKILL.md ]; then
      echo "bundle inputs incomplete" > .gm/context/bundle.missing
      echo "required gm-prototype skill is unavailable" >&2
      exit 1
    fi
    node -e '
      const ok = (a) => /^a_[0-9a-f-]{36}$/.test(a.blob) && /^\.gm\/inbox\/attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(a.path);
      for (const a of require("./.gm/context/bundle.json").attachments || []) if (ok(a)) console.log(a.blob + " " + a.path);
    ' | while read -r blob path; do
      mkdir -p .gm/inbox/attachments
      curl -fsS --max-time 60 -H "Authorization: Bearer ${secret}" \
        "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/attachments/${blob}" \
        -o "$path" || rm -f "$path"
    done
  else
    rm -f .gm/context/bundle.json
    echo "bundle unavailable" > .gm/context/bundle.missing
    echo "design snapshot unavailable" > .gm/context/design.missing
  fi
before_run: |
  ticket="${AIUR_HOOK_TICKET_IDENTIFIER:-}"
  recovered_bundle=no
  secret="$(cat "${OGM_HOOK_SECRET_FILE:-/nonexistent}" 2>/dev/null || true)"
  mkdir -p .gm/context
  if [ ! -f .gm/context/bundle.json ] && [ -n "$ticket" ] && [ -n "$secret" ] && [ -n "${OGM_INTERNAL_URL:-}" ]; then
    status="$(curl -sS --max-time 20 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" \
      "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/bundle" -o .gm/context/bundle.retry -w '%{http_code}' || true)"
    if [ "$status" = 200 ]; then
      mv .gm/context/bundle.retry .gm/context/bundle.json
    else
      rm -f .gm/context/bundle.retry
      if [ "$status" != 404 ]; then
        echo "required skill bundle is unavailable" >&2
        exit 1
      fi
    fi
  fi
  if [ -f .gm/context/bundle.missing ] && [ -f .gm/context/bundle.json ]; then
    recovered_bundle=yes
    design_status="$(curl -sS --max-time 20 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" \
      "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/design" -o .gm/context/design.json -w '%{http_code}' || true)"
    if [ "$design_status" != 200 ] && [ "$design_status" != 404 ]; then
      rm -f .gm/context/design.json
      echo "design snapshot unavailable" > .gm/context/design.missing
      exit 1
    fi
    if [ "$design_status" = 404 ] || ! node -e '
        try {
          const s = JSON.parse(require("node:fs").readFileSync(".gm/context/design.json", "utf8"));
          const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
          if (!Number.isInteger(s.rev) || s.rev < 0 || !(s.buildId === null || typeof s.buildId === "string") ||
              !record(s.doc) || !Number.isInteger(s.doc.schemaVersion) || !record(s.doc.globals) || !record(s.doc.entities)) process.exit(1);
        } catch { process.exit(1); }
      '; then
      rm -f .gm/context/design.json
      echo "design snapshot unavailable" > .gm/context/design.missing
    else
      rm -f .gm/context/design.missing
    fi
    node -e '
      const ok = (a) => /^a_[0-9a-f-]{36}$/.test(a.blob) && /^\.gm\/inbox\/attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(a.path);
      for (const a of require("./.gm/context/bundle.json").attachments || []) { if (!ok(a)) process.exit(1); console.log(a.blob + " " + a.path); }
    ' > .gm/context/attachments.retry || exit 1
    while read -r blob path; do
      mkdir -p .gm/inbox/attachments
      if ! curl -fsS --max-time 60 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" \
        "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/attachments/${blob}" -o "$path"; then
        rm -f "$path"
        exit 1
      fi
    done < .gm/context/attachments.retry
    rm -f .gm/context/attachments.retry
  fi
  if [ -f .gm/context/bundle.json ] && [ "$(node -p "require('./.gm/context/bundle.json').kind || ''")" = feature ] && { [ ! -f .claude/skills/gm-prototype/SKILL.md ] || [ "$recovered_bundle" = yes ]; }; then
    url="$(node -p "require('./.gm/context/bundle.json').skillPackUrl")"
    if [ -z "$secret" ] || ! curl -fsS --max-time 60 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" "$url" -o .gm/context/skills.tgz; then
      echo "required gm-prototype skill is unavailable" >&2
      exit 1
    fi
    for dir in .claude .claude/skills .codex .codex/skills .agents .agents/skills; do
      [ ! -L "$dir" ] || { echo "unsafe skill directory" >&2; exit 1; }
    done
    mkdir -p .claude/skills .codex/skills .agents/skills
    rm -rf .claude/skills/gm-*
    tar -xzf .gm/context/skills.tgz -C .claude/skills || exit 1
    for skill in .claude/skills/gm-*; do
      [ -f "$skill/SKILL.md" ] || continue
      name="${skill##*/}"
      for target in .codex/skills .agents/skills; do
        if [ -L "$target/$name" ]; then
          [ "$(readlink "$target/$name")" = "../../.claude/skills/$name" ] || { echo "unsafe skill discovery link" >&2; exit 1; }
        elif [ -e "$target/$name" ]; then
          echo "unsafe skill discovery entry" >&2; exit 1
        else
          ln -s "../../.claude/skills/$name" "$target/$name"
        fi
      done
    done
    if [ ! -f .claude/skills/gm-prototype/SKILL.md ]; then
      echo "required gm-prototype skill is unavailable" >&2
      exit 1
    fi
  fi
  if [ -f .gm/context/bundle.json ] && [ "$(node -p "require('./.gm/context/bundle.json').kind || ''")" = feature ]; then
    for dir in .claude .claude/skills .codex .codex/skills .agents .agents/skills; do
      [ ! -L "$dir" ] || { echo "unsafe skill directory" >&2; exit 1; }
    done
    mkdir -p .codex/skills .agents/skills
    for target in .codex/skills .agents/skills; do
      if [ -L "$target/gm-prototype" ]; then
        [ "$(readlink "$target/gm-prototype")" = '../../.claude/skills/gm-prototype' ] || { echo "unsafe skill discovery link" >&2; exit 1; }
      elif [ -e "$target/gm-prototype" ]; then
        echo "unsafe skill discovery entry" >&2; exit 1
      else
        ln -s '../../.claude/skills/gm-prototype' "$target/gm-prototype"
      fi
    done
  fi
  if [ "$recovered_bundle" = yes ]; then rm -f .gm/context/bundle.missing; fi
  rm -f .gm/context/preview.json
  if [ -n "$secret" ]; then
    umask 077
    printf %s "$secret" | OGM_PREVIEW_GAME="$(basename "$(dirname "$OGM_HOOK_SECRET_FILE")")" OGM_PREVIEW_TICKET="$ticket" OGM_PREVIEW_GRANTS="$(dirname "$OGM_HOOK_SECRET_FILE")/preview-grants" node -e '
      const fs = require("node:fs"), crypto = require("node:crypto");
      const ticket = process.env.OGM_PREVIEW_TICKET;
      if (!/^[1-9]\d{0,15}$/.test(ticket)) process.exit(1);
      const game = process.env.OGM_PREVIEW_GAME;
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(game)) process.exit(1);
      const grant = crypto.randomUUID();
      const expires = Date.now() + 2 * 60 * 60 * 1000;
      const workspace = crypto.createHash("sha256").update(process.cwd()).digest("hex");
      fs.mkdirSync(process.env.OGM_PREVIEW_GRANTS, { recursive: true, mode: 0o700 });
      fs.writeFileSync(process.env.OGM_PREVIEW_GRANTS + "/" + workspace + ".json", JSON.stringify({ ticket, grant, game, expires }), { mode: 0o600 });
      const payload = Buffer.from(JSON.stringify({ ticket, grant, game, expires })).toString("base64url");
      const signature = crypto.createHmac("sha256", fs.readFileSync(0, "utf8")).update("preview:" + payload).digest("base64url");
      fs.writeFileSync(".gm/context/preview.json", JSON.stringify({ token: payload + "." + signature }), { mode: 0o600 });
    ' || rm -f .gm/context/preview.json
  fi
before_remove: |
  git status --short
  ticket="${AIUR_HOOK_TICKET_IDENTIFIER:-}"
  secret="$(cat "${OGM_HOOK_SECRET_FILE:-/nonexistent}" 2>/dev/null || true)"
  root="$(pwd -P)"
  if [ -n "${OGM_HOOK_SECRET_FILE:-}" ]; then
    OGM_PREVIEW_GRANTS="$(dirname "$OGM_HOOK_SECRET_FILE")/preview-grants" node -e '
      const fs = require("node:fs"), crypto = require("node:crypto");
      const workspace = crypto.createHash("sha256").update(process.cwd()).digest("hex");
      fs.rmSync(process.env.OGM_PREVIEW_GRANTS + "/" + workspace + ".json", { force: true });
    ' || true
  fi
  # Build what the workspace holds now; a stale dist/ from an earlier run never leaves it.
  if [ -n "$ticket" ] && [ -n "$secret" ]; then
    rm -rf dist
    pnpm run build >&2 || { rm -rf dist; echo "build failed: nothing uploaded" >&2; }
  fi
  # Only paths that resolve inside the workspace leave it; links inside dist/ are kept as links and refused upstream.
  if [ -n "$ticket" ] && [ -n "$secret" ] && [ -d dist ] && [ "$(realpath dist)" = "$root/dist" ]; then
    stage="$(mktemp -d)"
    cp -PR dist/. "$stage/"
    for file in manifest.json design/design.json achievements.json; do
      if [ -f "$file" ] && [ "$(realpath "$file")" = "$root/$file" ]; then
        mkdir -p "$stage/$(dirname "$file")" && cp "$file" "$stage/$file"
      fi
    done
    if tar --format=ustar -czf "$stage.tgz" -C "$stage" .; then
      status="$(curl -sS --max-time 120 --retry 3 --retry-connrefused -o /dev/null -w '%{http_code}' -X POST \
        -H "Authorization: Bearer ${secret}" -H "x-gm-sha: $(git rev-parse HEAD)" -H "content-type: application/gzip" \
        --data-binary @"$stage.tgz" "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/build")"
      echo "build upload: HTTP ${status:-000}" >&2
    fi
    rm -rf "$stage" "$stage.tgz"
  fi
