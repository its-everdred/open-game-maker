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
    planner_branch="$(node -p "require('./.gm/context/bundle.json').plannerBase?.branch || ''")"
    planner_sha="$(node -p "require('./.gm/context/bundle.json').plannerBase?.sha || ''")"
    if [ -n "$planner_branch" ] || [ -n "$planner_sha" ]; then
      node -e 'const b=require("./.gm/context/bundle.json").plannerBase; if (!b || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(b.branch) || b.branch.includes("..") || b.branch.includes("//") || !/^[a-f0-9]{40}$/.test(b.sha)) process.exit(1)' || exit 1
      git fetch --no-tags origin "refs/heads/$planner_branch"
      git merge-base --is-ancestor "$planner_sha" FETCH_HEAD
      git checkout -B "${AIUR_TICKET_BRANCH:-aiur/${ticket}}" "$planner_sha"
      printf '%s\n' "$planner_sha" > .gm/context/planner-base.applied
    fi
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
    have="$(node -p "JSON.parse(require('node:fs').readFileSync('./skills.lock', 'utf8')).pack" 2>/dev/null || echo none)"
    kind="$(node -p "require('./.gm/context/bundle.json').kind || ''")"
    if [ "$kind" = feature ] || [ "$kind" = new_game ]; then
      echo "bundle inputs incomplete" > .gm/context/bundle.missing
    fi
    if [ "$want" != "$have" ] || [ "$kind" = feature ] || [ "$kind" = new_game ]; then
      url="$(node -e 'const v=require("./.gm/context/bundle.json").skillPackVersion; const b=new URL(process.env.OGM_INTERNAL_URL); if(typeof v!=="string" || !/^[A-Za-z0-9._+-]{1,120}$/.test(v) || b.protocol!=="http:" || b.hostname!=="127.0.0.1" || b.username || b.password) process.exit(1); process.stdout.write(new URL("/internal/skills/"+encodeURIComponent(v)+".tgz",b).href)')" || exit 1
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
    if [ "$kind" = new_game ] && { [ ! -f .claude/skills/gm-new-game-plan/scripts/context.mjs ] || [ ! -f .claude/skills/gm-new-game-plan/scripts/relay.mjs ] || [ ! -f .claude/skills/gm-new-game-plan/scripts/child.mjs ]; }; then
      echo "bundle inputs incomplete" > .gm/context/bundle.missing
      echo "required gm-new-game-plan skill is unavailable" >&2
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
  for dir in .gm .gm/context; do
    [ ! -L "$dir" ] || { echo "unsafe workspace context" >&2; exit 1; }
  done
  mkdir -p .gm/context
  exec {context_fd}<.gm/context || exit 1
  context_path="/proc/$$/fd/${context_fd}"
  [ "$(readlink "$context_path")" = "$(pwd -P)/.gm/context" ] || { echo "unsafe workspace context" >&2; exit 1; }
  export OGM_CONTEXT_PATH="$context_path"
  rm -f $context_path/preview.json
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
      fs.writeFileSync(process.env.OGM_CONTEXT_PATH + "/preview.json", JSON.stringify({ token: payload + "." + signature }), { mode: 0o600, flag: "wx" });
    ' || rm -f $context_path/preview.json
  fi
  preview_token="$(node -p "require('$context_path/preview.json').token || ''" 2>/dev/null || true)"
  workspace_hash="$(node -p "require('node:crypto').createHash('sha256').update(process.cwd()).digest('hex')")"
  safe_curl() {
    OGM_SAFE_NAME="$1" node -e '
      const fs = require("node:fs"), crypto = require("node:crypto"), cp = require("node:child_process");
      const base = process.env.OGM_CONTEXT_PATH, name = process.env.OGM_SAFE_NAME;
      if (!/^[a-z][a-z0-9.-]*$/.test(name)) process.exit(1);
      const tmp = base + "/.curl-" + crypto.randomUUID();
      let fd;
      try {
        fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        const args = process.argv.slice(1).concat(["-o", "/proc/" + process.pid + "/fd/" + fd]);
        const run = cp.spawnSync("curl", args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
        if (run.stdout) process.stdout.write(run.stdout);
        if (run.stderr) process.stderr.write(run.stderr);
        if (run.status !== 0) process.exitCode = 1;
        else fs.renameSync(tmp, base + "/" + name);
      } catch { process.exitCode = 1; }
      finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(tmp, { force: true }); }
    ' -- "${@:2}"
  }
  safe_marker() {
    OGM_SAFE_NAME="$1" OGM_SAFE_CONTENT="$2" node -e '
      const fs=require("node:fs"), c=require("node:crypto"), d=process.env.OGM_CONTEXT_PATH, n=process.env.OGM_SAFE_NAME;
      if (!/^[a-z][a-z0-9.-]*$/.test(n)) process.exit(1);
      const t=d+"/.write-"+c.randomUUID();
      try { fs.writeFileSync(t,process.env.OGM_SAFE_CONTENT,{mode:0o600,flag:"wx"}); fs.renameSync(t,d+"/"+n); }
      finally { fs.rmSync(t,{force:true}); }
    '
  }
  safe_attachment() {
    OGM_ATTACHMENT_BLOB="$1" OGM_ATTACHMENT_PATH="$2" OGM_ATTACHMENT_SECRET="$secret" OGM_ATTACHMENT_TOKEN="$preview_token" OGM_ATTACHMENT_WORKSPACE="$workspace_hash" OGM_ATTACHMENT_TICKET="$ticket" node -e '
      const fs=require("node:fs"), c=require("node:crypto"), cp=require("node:child_process");
      const blob=process.env.OGM_ATTACHMENT_BLOB, path=process.env.OGM_ATTACHMENT_PATH;
      if (!/^a_[0-9a-f-]{36}$/.test(blob) || !/^\.gm\/inbox\/attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(path)) process.exit(1);
      const flags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;
      const gm=fs.openSync(process.env.OGM_CONTEXT_PATH + "/..", flags), gd="/proc/self/fd/"+gm;
      let inbox, dest, tmp, output;
      try {
        if (fs.readlinkSync(gd)!==process.cwd()+"/.gm") throw Error("unsafe gm directory");
        try { fs.mkdirSync(gd+"/inbox",{mode:0o700}); } catch(e) { if(e.code!=="EEXIST") throw e; }
        inbox=fs.openSync(gd+"/inbox",flags); const id="/proc/self/fd/"+inbox;
        if (fs.readlinkSync(id)!==process.cwd()+"/.gm/inbox") throw Error("unsafe inbox");
        try { fs.mkdirSync(id+"/attachments",{mode:0o700}); } catch(e) { if(e.code!=="EEXIST") throw e; }
        dest=fs.openSync(id+"/attachments",flags); const dd="/proc/self/fd/"+dest;
        if (fs.readlinkSync(dd)!==process.cwd()+"/.gm/inbox/attachments") throw Error("unsafe attachments");
        tmp=dd+"/.download-"+c.randomUUID();
        output=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
        const url=process.env.OGM_INTERNAL_URL+"/internal/jobs/by-ticket/"+process.env.OGM_ATTACHMENT_TICKET+"/attachments/"+blob;
        const run=cp.spawnSync("curl",["-fsS","--max-time","60","--retry","3","--retry-connrefused","--retry-delay","1","-H","Authorization: Bearer "+process.env.OGM_ATTACHMENT_SECRET,"-H","X-OGM-Preview-Token: "+process.env.OGM_ATTACHMENT_TOKEN,"-H","X-OGM-Workspace: "+process.env.OGM_ATTACHMENT_WORKSPACE,url,"-o","/proc/"+process.pid+"/fd/"+output],{encoding:"utf8"});
        if (run.status!==0) throw Error("attachment unavailable");
        fs.renameSync(tmp,dd+"/"+path.slice(path.lastIndexOf("/")+1));
      } catch { process.exitCode=1; }
      finally { if (output!==undefined) fs.closeSync(output); if (tmp) fs.rmSync(tmp,{force:true}); if (dest!==undefined) fs.closeSync(dest); if (inbox!==undefined) fs.closeSync(inbox); fs.closeSync(gm); }
    '
  }
  if [ ! -f $context_path/bundle.json ] && [ -n "$ticket" ] && [ -n "$secret" ] && [ -n "${OGM_INTERNAL_URL:-}" ]; then
    status="$(safe_curl bundle.retry -sS --max-time 20 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" -H "X-OGM-Preview-Token: ${preview_token}" -H "X-OGM-Workspace: ${workspace_hash}" \
      "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/bundle" -w '%{http_code}')" || status=000
    if [ "$status" = 200 ]; then
      mv $context_path/bundle.retry $context_path/bundle.json || exit 1
    else
      rm -f $context_path/bundle.retry
      if [ "$status" != 404 ]; then
        echo "required skill bundle is unavailable" >&2
        exit 1
      fi
      if [ -f $context_path/planner-base.applied ]; then
        echo "planner bundle unavailable" >&2
        exit 1
      fi
      guard_status="$(safe_curl planner-guard.json -sS --max-time 20 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" \
        "${OGM_INTERNAL_URL}/internal/jobs/by-ticket/${ticket}/planner-guard" -w '%{http_code}' || true)"
      if [ "$guard_status" = 200 ]; then
        node -e 'const a=require(process.env.OGM_CONTEXT_PATH + "/planner-guard.json"); if (!a || typeof a.plannerChild !== "boolean" || a.plannerChild) process.exit(1)' || { echo "planner bundle unavailable" >&2; exit 1; }
      elif [ "$guard_status" != 404 ]; then
        echo "planner bundle status unavailable" >&2
        exit 1
      fi
      rm -f $context_path/planner-guard.json
    fi
  fi
  if [ -f $context_path/bundle.json ]; then
    planner_branch="$(node -p "require('$context_path/bundle.json').plannerBase?.branch || ''")"
    planner_sha="$(node -p "require('$context_path/bundle.json').plannerBase?.sha || ''")"
    if [ -n "$planner_branch" ] || [ -n "$planner_sha" ]; then
      node -e 'const b=require(process.env.OGM_CONTEXT_PATH + "/bundle.json").plannerBase; if (!b || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(b.branch) || b.branch.includes("..") || b.branch.includes("//") || !/^[a-f0-9]{40}$/.test(b.sha)) process.exit(1)' || exit 1
      applied="$(cat $context_path/planner-base.applied 2>/dev/null || true)"
      if [ "$applied" != "$planner_sha" ]; then
        if ! git merge-base --is-ancestor "$planner_sha" HEAD 2>/dev/null; then
          [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$THIS_BASE_BRANCH")" ] || { echo "planner base requires a fresh workspace" >&2; exit 1; }
          git diff --quiet && git diff --cached --quiet || { echo "planner base requires a clean workspace" >&2; exit 1; }
          git fetch --no-tags origin "refs/heads/$planner_branch" || exit 1
          git merge-base --is-ancestor "$planner_sha" FETCH_HEAD || exit 1
          git checkout -B "${AIUR_TICKET_BRANCH:-aiur/${ticket}}" "$planner_sha" || exit 1
        fi
        OGM_PLANNER_SHA="$planner_sha" node -e 'const fs=require("node:fs"), c=require("node:crypto"), d=process.env.OGM_CONTEXT_PATH, t=d+"/.base-"+c.randomUUID(); try { fs.writeFileSync(t,process.env.OGM_PLANNER_SHA+"\n",{mode:0o600,flag:"wx"}); fs.renameSync(t,d+"/planner-base.applied"); } finally { fs.rmSync(t,{force:true}); }' || exit 1
      fi
      rm -f $context_path/planner-answers.json
      if [ -z "$secret" ] || [ -z "${OGM_INTERNAL_URL:-}" ] || ! safe_curl planner-answers.json -fsS --max-time 20 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" -H "X-OGM-Preview-Token: ${preview_token}" -H "X-OGM-Workspace: ${workspace_hash}" \
        "${OGM_INTERNAL_URL}/internal/jobs/by-ticket/${ticket}/planner-answers"; then
        rm -f $context_path/planner-answers.json
        echo "planner answers unavailable" >&2
        exit 1
      fi
      node -e 'const a=require(process.env.OGM_CONTEXT_PATH + "/planner-answers.json"); if (!a || !Array.isArray(a.answers)) process.exit(1)' || exit 1
    fi
  fi
  if [ -f $context_path/bundle.missing ] && [ -f $context_path/bundle.json ]; then
    recovered_bundle=yes
    design_status="$(safe_curl design.json -sS --max-time 20 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" \
      "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/design" -w '%{http_code}' || true)"
    if [ "$design_status" != 200 ] && [ "$design_status" != 404 ]; then
      rm -f $context_path/design.json
      safe_marker design.missing $'design snapshot unavailable\n' || exit 1
      exit 1
    fi
    if [ "$design_status" = 404 ] || ! node -e '
        try {
          const s = JSON.parse(require("node:fs").readFileSync(process.env.OGM_CONTEXT_PATH + "/design.json", "utf8"));
          const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
          if (!Number.isInteger(s.rev) || s.rev < 0 || !(s.buildId === null || typeof s.buildId === "string") ||
              !record(s.doc) || !Number.isInteger(s.doc.schemaVersion) || !record(s.doc.globals) || !record(s.doc.entities)) process.exit(1);
        } catch { process.exit(1); }
      '; then
      rm -f $context_path/design.json
      safe_marker design.missing $'design snapshot unavailable\n' || exit 1
    else
      rm -f $context_path/design.missing
    fi
    node -e '
      const fs=require("node:fs"), c=require("node:crypto"), d=process.env.OGM_CONTEXT_PATH;
      const ok = (a) => /^a_[0-9a-f-]{36}$/.test(a.blob) && /^\.gm\/inbox\/attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(a.path);
      const rows=[]; for (const a of require(d + "/bundle.json").attachments || []) { if (!ok(a)) process.exit(1); rows.push(a.blob + " " + a.path); }
      const t=d+"/.attachments-"+c.randomUUID();
      try { fs.writeFileSync(t,rows.join("\n")+"\n",{mode:0o600,flag:"wx"}); fs.renameSync(t,d+"/attachments.retry"); }
      finally { fs.rmSync(t,{force:true}); }
    ' || exit 1
    while read -r blob path; do
      [ -n "$blob" ] || continue
      safe_attachment "$blob" "$path" || exit 1
    done < $context_path/attachments.retry
    rm -f $context_path/attachments.retry
  fi
  kind="$(node -p "require('$context_path/bundle.json').kind || ''" 2>/dev/null || true)"
  if { [ "$kind" = feature ] && [ ! -f .claude/skills/gm-prototype/SKILL.md ]; } || { [ "$kind" = new_game ] && { [ ! -f .claude/skills/gm-new-game-plan/scripts/context.mjs ] || [ ! -f .claude/skills/gm-new-game-plan/scripts/relay.mjs ] || [ ! -f .claude/skills/gm-new-game-plan/scripts/child.mjs ]; }; } || { [ "$recovered_bundle" = yes ] && { [ "$kind" = feature ] || [ "$kind" = new_game ]; }; }; then
    url="$(node -e 'const v=require(process.env.OGM_CONTEXT_PATH+"/bundle.json").skillPackVersion; const b=new URL(process.env.OGM_INTERNAL_URL); if(typeof v!=="string" || !/^[A-Za-z0-9._+-]{1,120}$/.test(v) || b.protocol!=="http:" || b.hostname!=="127.0.0.1" || b.username || b.password) process.exit(1); process.stdout.write(new URL("/internal/skills/"+encodeURIComponent(v)+".tgz",b).href)')" || exit 1
    if [ -z "$secret" ] || ! safe_curl skills.tgz -fsS --max-time 60 --retry 3 --retry-connrefused --retry-delay 1 -H "Authorization: Bearer ${secret}" "$url"; then
      if [ "$kind" = new_game ]; then echo "required gm-new-game-plan skill is unavailable" >&2
      else echo "required gm-prototype skill is unavailable" >&2; fi
      exit 1
    fi
    for dir in .claude .claude/skills .codex .codex/skills .agents .agents/skills; do
      [ ! -L "$dir" ] || { echo "unsafe skill directory" >&2; exit 1; }
    done
    mkdir -p .claude/skills .codex/skills .agents/skills
    rm -rf .claude/skills/gm-*
    tar -xzf $context_path/skills.tgz -C .claude/skills || exit 1
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
    if [ "$kind" = feature ] && [ ! -f .claude/skills/gm-prototype/SKILL.md ]; then
      echo "required gm-prototype skill is unavailable" >&2
      exit 1
    fi
    if [ "$kind" = new_game ] && { [ ! -f .claude/skills/gm-new-game-plan/scripts/context.mjs ] || [ ! -f .claude/skills/gm-new-game-plan/scripts/relay.mjs ] || [ ! -f .claude/skills/gm-new-game-plan/scripts/child.mjs ]; }; then
      echo "required gm-new-game-plan skill is unavailable" >&2
      exit 1
    fi
  fi
  if [ -f $context_path/bundle.json ] && [ "$(node -p "require('$context_path/bundle.json').kind || ''")" = feature ]; then
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
  if [ "$recovered_bundle" = yes ]; then rm -f $context_path/bundle.missing; fi
  # The game's approved work this ticket should build on, inlined with gm-core in the first prompt (#1311).
  case "$ticket" in ''|*[!0-9]*) ;; *) [ ! -x node_modules/.bin/gm ] || timeout 300 node_modules/.bin/gm context "$ticket" --limit 5 --inject .claude/skills >&2 || true ;; esac
before_remove: |
  %%PUBLISH_HOST%%
  set -o pipefail
  git status --short
  ticket="${AIUR_HOOK_TICKET_IDENTIFIER:-}"
  secret="$(cat "${OGM_HOOK_SECRET_FILE:-/nonexistent}" 2>/dev/null || true)"
  root="$(pwd -P)"
  workspace_hash="$(node -p "require('node:crypto').createHash('sha256').update(process.cwd()).digest('hex')")"
  preview_token=""
  if [ -n "$ticket" ] && [ -n "$secret" ] && [ -n "${OGM_HOOK_SECRET_FILE:-}" ]; then
    preview_token="$(printf %s "$secret" | OGM_PREVIEW_GAME="$(basename "$(dirname "$OGM_HOOK_SECRET_FILE")")" OGM_PREVIEW_TICKET="$ticket" OGM_PREVIEW_GRANTS="$(dirname "$OGM_HOOK_SECRET_FILE")/preview-grants" node -e '
      const fs=require("node:fs"), c=require("node:crypto"), ticket=process.env.OGM_PREVIEW_TICKET, game=process.env.OGM_PREVIEW_GAME;
      if(!/^[1-9]\d{0,15}$/.test(ticket)||!/^[A-Za-z0-9_-]{1,200}$/.test(game)) process.exit(1);
      const grant=c.randomUUID(), expires=Date.now()+7200000, workspace=c.createHash("sha256").update(process.cwd()).digest("hex");
      fs.mkdirSync(process.env.OGM_PREVIEW_GRANTS,{recursive:true,mode:0o700});
      fs.writeFileSync(process.env.OGM_PREVIEW_GRANTS+"/"+workspace+".json",JSON.stringify({ticket,grant,game,expires}),{mode:0o600});
      const payload=Buffer.from(JSON.stringify({ticket,grant,game,expires})).toString("base64url");
      process.stdout.write(payload+"."+c.createHmac("sha256",fs.readFileSync(0,"utf8")).update("preview:"+payload).digest("base64url"));
    ' || true)"
  fi
  workspace_root="$root"
  source_clean() {
    [ "$(git -C "$workspace_root" rev-parse HEAD)" = "$sha" ] &&
      git -C "$workspace_root" diff --quiet HEAD -- &&
      [ -z "$(git -C "$workspace_root" status --porcelain --untracked-files=all -- . \
        ':(exclude).claude/skills/gm-*' ':(exclude).codex/skills/gm-*' ':(exclude).agents/skills/gm-*')" ]
  }
  skill_fingerprint() {
    node -e '
      const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
      const hash = crypto.createHash("sha256");
      function visit(file) {
        const stat = fs.lstatSync(file);
        hash.update(JSON.stringify([file, stat.mode, stat.size]));
        if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file));
        else if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
        else if (stat.isFile()) hash.update(fs.readFileSync(file));
        else throw new Error("unsupported skill file");
      }
      for (const dir of [".claude/skills", ".codex/skills", ".agents/skills"]) {
        if (!fs.existsSync(dir)) continue;
        if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(path.dirname(dir)).isSymbolicLink()) throw new Error("unsafe skill directory");
        for (const name of fs.readdirSync(dir).filter((n) => n.startsWith("gm-")).sort()) visit(path.join(dir, name));
      }
      process.stdout.write(hash.digest("hex"));
    '
  }
  # Only the host wrapper sees daemon credentials; game commands run with the fleet's network-off profile.
  game_pnpm() {
    local runtime result denied
    local -a sandbox_args=()
    if [ -n "${stage:-}" ]; then
      denied="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$stage")"
      sandbox_args=(-c "permissions.gamebuilder.filesystem.${denied}=\"deny\"")
    fi
    runtime="$(mktemp -d "$root/.gm-publish-tmp.XXXXXXXX")" || return 1
    result=0
    env -i PATH="$PATH" HOME="$HOME" CODEX_HOME="${CODEX_HOME:-}" \
      TMPDIR="$runtime" XDG_RUNTIME_DIR="$runtime" COREPACK_HOME="${COREPACK_HOME:-}" \
      OGM_ASSETS_ROOT="${asset_stage:-}" OGM_BLOB_ROOT="${asset_stage:-}/blob-store" \
      GM_ASSET_CACHE_DIR="${cache_stage:-}" GM_VERIFY_SOFTWARE_GL="${GM_VERIFY_SOFTWARE_GL:-}" \
      codex sandbox "${sandbox_args[@]}" -P gamebuilder --sandbox-state-disable-network -C "$root" -- pnpm "$@" || result=$?
    rm -rf "$runtime"
    return "$result"
  }
  # Build what the workspace holds now; a stale dist/ from an earlier run never leaves it.
  if [ -n "$ticket" ] && [ -n "$secret" ]; then
    sha="$(git rev-parse HEAD)"
    context="$(curl -fsS --max-time 20 -H "Authorization: Bearer ${secret}" -H "X-OGM-Preview-Token: ${preview_token}" -H "X-OGM-Workspace: ${workspace_hash}" -H "x-gm-sha: $sha" \
      "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/publish-context")" || context=''
    game_path="$(printf '%s' "$context" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const p=JSON.parse(s).path;if(p===null || p==="")return;if(typeof p==="string" && !p.startsWith("/") && !p.split("/").includes("..")){process.stdout.write(p);return}}catch{}process.stdout.write("__INVALID__")})')"
    visibility="$(printf '%s' "$context" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const v=JSON.parse(s).visibility;if(v==="public" || v==="private")process.stdout.write(v)}catch{}})')"
    game_root="$root"
    if [ -n "$game_path" ]; then
      game_root=''
      if [ "$game_path" != '__INVALID__' ] && [ -f "$root/$game_path/package.json" ]; then
        candidate="$(realpath "$root/$game_path")"
        case "$candidate" in "$root"|"$root"/*) game_root="$candidate" ;; esac
      fi
    elif [ ! -f "$root/manifest.json" ] && [ ! -f "$root/gm.manifest.json" ]; then
      game_root=''
    fi
    if [ -z "$game_root" ] || [ -z "$visibility" ]; then
      echo "game publish context unavailable: nothing uploaded" >&2
      exit 0
    fi
    cd "$game_root"
    root="$game_root"
    source_result=passed
    if ! source_clean; then
      source_result=failed
      echo "game source is not clean at the recorded commit: nothing uploaded" >&2
    fi
    skill_hash="$(cd "$workspace_root" && skill_fingerprint)" || source_result=failed
    rm -rf dist
    mkdir -p "$root/.gm"
    if [ "$(realpath "$root/.gm")" != "$root/.gm" ]; then
      echo "game scratch directory is not contained: nothing uploaded" >&2
      exit 0
    fi
    asset_stage="$(mktemp -d "$root/.gm/publish-assets.XXXXXXXX")"
    cache_stage="$(mktemp -d "$root/.gm/publish-cache.XXXXXXXX")"
    assets_ready=0
    asset_stage_result=not-run
    if [ "$source_result" = passed ]; then asset_stage_result=failed; fi
    if [ "$source_result" = passed ] && [ -n "$publish_helper" ] && [ -f "$publish_helper" ] &&
      node "$publish_helper" "$root" "$asset_stage" "$publish_assets" "$publish_blobs" "$visibility" >&2; then
      assets_ready=1
      asset_stage_result=passed
    elif [ "$source_result" = passed ]; then
      echo "game asset staging failed: nothing uploaded" >&2
    fi
    test_result=not-run
    test_mode_result=not-run
    test_config_result=not-run
    test_artifact_hash=''
    test_build_hash=''
    stage=''
    snapshot_result=not-run
    integrity_result=not-run
    production_hash=''
    build_result=not-run
    if [ "$assets_ready" = 1 ]; then build_result=failed; fi
    if [ "$assets_ready" = 1 ] && game_pnpm run build >&2; then
      build_result=passed
      snapshot_result=failed
      if [ -d dist ] && [ "$(realpath dist)" = "$root/dist" ]; then
        stage="$(mktemp -d)"
        if cp -PR dist/. "$stage/"; then
          snapshot_result=passed
          for file in manifest.json design/design.json achievements.json; do
            if [ -f "$file" ] && [ "$(realpath "$file")" = "$root/$file" ]; then
              mkdir -p "$stage/$(dirname "$file")" && cp -P "$file" "$stage/$file" || snapshot_result=failed
            fi
          done
        fi
      fi
      if [ "$snapshot_result" = passed ]; then
        if ! production_hash="$(tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -cf - -C dist . | sha256sum | cut -d ' ' -f 1)"; then snapshot_result=failed; fi
      fi
      test_script="$(node -e 'try{process.stdout.write(require("./package.json").scripts?.test || "")}catch{}')"
      needs_test_build="$(node -e 'process.stdout.write(/^\s*gm\s+test(?:\s|$)/u.test(process.argv[1]) ? "1" : "0")' "$test_script")"
      if [ "$needs_test_build" = 1 ]; then
        if node -e 'const words=process.argv[1].trim().split(/\s+/); if(words.shift()!=="gm" || words.shift()!=="test")process.exit(1); while(words.length){const word=words.shift();if(word==="--json")continue;const m=/^--(inputs|ticks|deadline|out)(?:=([A-Za-z0-9_./:-]+))?$/.exec(word);if(!m)process.exit(1);const value=m[2] ?? words.shift();if(!value || value.startsWith("-") || !/^[A-Za-z0-9_./:-]+$/.test(value))process.exit(1)}' "$test_script"; then
          test_config_result=passed
        else
          test_config_result=failed
          echo "gm test must use the default dist directory and simple arguments" >&2
        fi
      fi
      if [ "$snapshot_result" = passed ] && [ "$needs_test_build" = 1 ] && [ "$test_config_result" = passed ]; then
        test_mode_result=failed
        if game_pnpm exec vite build --mode test --base=./ >&2; then
          test_archive="$(mktemp)"
          if tar --format=ustar -czf "$test_archive" -C dist .; then
            test_artifact_hash="$(sha256sum "$test_archive" | cut -d ' ' -f 1)"
            test_build_hash="$(tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -cf - -C dist . | sha256sum | cut -d ' ' -f 1)"
            test_mode_result=passed
          fi
          rm -f "$test_archive"
        fi
      fi
      if [ "$snapshot_result" = passed ] && [ "$test_mode_result" != failed ] && [ "$test_config_result" != failed ]; then
        test_result=failed
        if game_pnpm run test >&2; then test_result=passed; fi
      fi
      if [ "$test_result" = passed ]; then
        integrity_result=passed
        if [ "$needs_test_build" = 1 ]; then
          after_hash="$(tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -cf - -C dist . | sha256sum | cut -d ' ' -f 1)" || integrity_result=failed
          if [ -z "$test_build_hash" ] || [ "$after_hash" != "$test_build_hash" ]; then integrity_result=failed; fi
        else
          if ! after_hash="$(tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -cf - -C dist . | sha256sum | cut -d ' ' -f 1)"; then integrity_result=failed; fi
          if [ -z "$production_hash" ] || [ "$after_hash" != "$production_hash" ]; then integrity_result=failed; fi
        fi
      fi
      if [ "$test_result" != passed ] || [ "$snapshot_result" != passed ] || [ "$integrity_result" = failed ]; then
        rm -rf dist
        echo "game checks failed: nothing uploaded" >&2
      fi
    else
      rm -rf dist
      if [ "$build_result" = failed ]; then echo "build failed: nothing uploaded" >&2; fi
    fi
    if [ "$source_result" = passed ] && { ! source_clean || [ "$(cd "$workspace_root" && skill_fingerprint)" != "$skill_hash" ]; }; then
      source_result=failed
      echo "game source changed during checks: nothing uploaded" >&2
    fi
    artifact_hash=''
    if [ "$source_result" = passed ] && [ "$test_result" = passed ] && [ "$snapshot_result" = passed ] && [ "$integrity_result" = passed ]; then
      if tar --format=ustar -czf "$stage.tgz" -C "$stage" .; then
        artifact_hash="$(sha256sum "$stage.tgz" | cut -d ' ' -f 1)"
      fi
    fi
    checks="$(node -e 'const [gitSha,build,mode,test,snapshot,integrity,hash,testHash,needsTestBuild,config,assets,source]=process.argv.slice(1);const checks=[];for(const [name,result] of [["source integrity",source],["asset staging",assets],["pnpm run build",build],["production snapshot",snapshot],["test configuration",config],["test-mode build",mode],["pnpm run test",test],["production build integrity",integrity]])if(result!=="not-run")checks.push({name,result});console.log(JSON.stringify({gitSha,surface:"game",sizes:test==="passed" && needsTestBuild==="1"?["390x844","1180x820"]:[],checks,...(hash?{artifactSha256:hash}:{}),...(testHash?{testArtifactSha256:testHash}:{})}))' "$sha" "$build_result" "$test_mode_result" "$test_result" "$snapshot_result" "$integrity_result" "$artifact_hash" "$test_artifact_hash" "${needs_test_build:-0}" "$test_config_result" "$asset_stage_result" "$source_result")"
    answer="$(curl -fsS --max-time 20 -X POST -H "Authorization: Bearer ${secret}" -H "X-OGM-Preview-Token: ${preview_token}" -H "X-OGM-Workspace: ${workspace_hash}" -H "x-gm-sha: $sha" -H "content-type: application/json" --data-binary "$checks" "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/publish-checks")" || answer=''
    check_id="$(printf '%s' "$answer" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const r=JSON.parse(s);if(r.result==="passed" && typeof r.id==="string")process.stdout.write(r.id)}catch{}})')"
    if [ -n "$check_id" ] && [ -n "$artifact_hash" ]; then
      status="$(curl -sS --max-time 120 --retry 3 --retry-connrefused -o /dev/null -w '%{http_code}' -X POST \
        -H "Authorization: Bearer ${secret}" -H "X-OGM-Preview-Token: ${preview_token}" -H "X-OGM-Workspace: ${workspace_hash}" -H "x-gm-sha: $sha" -H "x-gm-check-id: $check_id" -H "content-type: application/gzip" \
        --data-binary @"$stage.tgz" "${OGM_INTERNAL_URL:-http://127.0.0.1:0}/internal/jobs/by-ticket/${ticket}/build")"
      echo "build upload: HTTP ${status:-000}" >&2
    else
      echo "game checks not recorded: nothing uploaded" >&2
    fi
    if [ -n "$stage" ]; then rm -rf "$stage" "$stage.tgz"; fi
    rm -rf "$asset_stage" "$cache_stage"
  fi
  if [ -n "${OGM_HOOK_SECRET_FILE:-}" ]; then
    OGM_PREVIEW_GRANTS="$(dirname "$OGM_HOOK_SECRET_FILE")/preview-grants" OGM_WORKSPACE_HASH="$workspace_hash" node -e 'require("node:fs").rmSync(process.env.OGM_PREVIEW_GRANTS+"/"+process.env.OGM_WORKSPACE_HASH+".json",{force:true})' || true
  fi
