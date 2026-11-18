#!/usr/bin/env bash
# ops/bin/ogm-voice-host (#879): the live stack starts the voice host beside the Node services, so its env check must
# name what is missing without printing a value, start must refuse a broken env, and ensure must bring a dead host back.

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
cleanup() {
  OGM_ENV_DIR=$scratch/env "$repo/ops/bin/ogm-voice-host" stop --repo "$scratch/stack" > /dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT

free_port() { node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
port=$(free_port)
internal=$(free_port)
token=tok-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
secret=int-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')

mkdir -p "$scratch/env"
export OGM_ENV_DIR=$scratch/env OGM_VOICE_LOG=$scratch/voice.log
vh() { "$repo/ops/bin/ogm-voice-host" "$@" --repo "$scratch/stack"; }

# A release stand-in: answers /healthz with the provider it was started with, as the real host does.
rel=$scratch/stack/services/voice-host/_build/prod/rel/voice_host/bin
mkdir -p "$rel"
cat > "$rel/voice_host" << 'EOF'
#!/usr/bin/env bash
[[ $1 == start ]] || exit 2
exec node -e '
  require("http").createServer((q, s) => s.end(JSON.stringify({ service: "voice-host", provider: process.env.OGM_VOICE_PROVIDER })))
    .listen(Number(process.env.OGM_VOICE_INTERNAL_PORT), "127.0.0.1");'
EOF
chmod +x "$rel/voice_host"

# The env as the host has it today: a key and a port, nothing the host needs to boot, and the API's URLs empty.
cat > "$OGM_ENV_DIR/voice-host.env" << EOF
ELEVENLABS_API_KEY=key-must-not-print
OGM_VOICE_PORT=$port
OGM_VOICE_INTERNAL_PORT=$internal
OGM_VOICE_PROVIDER=elevenlabs_agents
EOF
cat > "$OGM_ENV_DIR/api.env" << EOF
OGM_VOICE_TOKEN_SECRET=$token
OGM_VOICE_INTERNAL_SECRET=$secret
OGM_VOICE_HOST_INTERNAL_URL=
OGM_VOICE_WS_URL=
EOF

set +e
vh check-env > "$scratch/check.out" 2> "$scratch/check.err"
status=$?
set -e
assert_eq 1 "$status" 'an incomplete env should fail the check'
for missing in 'voice-host.env: OGM_VOICE_TOKEN_SECRET is empty' 'voice-host.env: OGM_API_INTERNAL_URL is empty' \
  'voice-host.env: OGM_VOICE_LLM is empty (provider elevenlabs_agents)' \
  'voice-host.env: OGM_VOICE_CLEANUP_ROOT is empty (provider elevenlabs_agents)' \
  'OGM_VOICE_INTERNAL_SECRET differs between api.env and voice-host.env' 'api.env: OGM_VOICE_WS_URL is empty' \
  "api.env: OGM_VOICE_HOST_INTERNAL_URL is not http://127.0.0.1:$internal"; do
  assert_grep "$missing" "$scratch/check.err"
done
for value in key-must-not-print "$token" "$secret"; do
  assert_not_grep "$value" "$scratch/check.err"
  assert_not_grep "$value" "$scratch/check.out"
done

set +e
vh start > "$scratch/start.out" 2> "$scratch/start.err"
status=$?
set -e
assert_eq 1 "$status" 'start should refuse a broken env instead of crash-looping the release'
assert_grep 'fix the env files first' "$scratch/start.err"
[[ -z $(ss -ltnH "sport = :$internal") ]] || fail 'a refused start must not leave a listener'

# The runbook's settings: both secrets shared with the API, the API's loopback URL, a model and a cleanup root.
cat >> "$OGM_ENV_DIR/voice-host.env" << EOF
OGM_VOICE_TOKEN_SECRET=$token
OGM_VOICE_INTERNAL_SECRET=$secret
OGM_API_INTERNAL_URL=http://127.0.0.1:4300
OGM_VOICE_LLM=gemini-2.5-flash
OGM_VOICE_CLEANUP_ROOT=$scratch/cleanup
EOF
sed -i "s#^OGM_VOICE_HOST_INTERNAL_URL=.*#OGM_VOICE_HOST_INTERNAL_URL=http://127.0.0.1:$internal#; s#^OGM_VOICE_WS_URL=.*#OGM_VOICE_WS_URL=wss://<tailnet-host>:8443/ws/voice#" "$OGM_ENV_DIR/api.env"
vh check-env > "$scratch/check2.out"
assert_grep "env ok (provider elevenlabs_agents, ports $port and $internal)" "$scratch/check2.out"

vh start > "$scratch/start2.out"
assert_grep '"provider":"elevenlabs_agents"' "$scratch/start2.out"
vh health > "$scratch/health.out"
assert_grep '"service":"voice-host"' "$scratch/health.out"
for value in key-must-not-print "$token" "$secret"; do
  assert_not_grep "$value" "$scratch/start2.out"
  assert_not_grep "$value" "$scratch/health.out"
done

vh start > "$scratch/start3.out"
assert_grep 'already running' "$scratch/start3.out"

vh stop > /dev/null
set +e
vh health > /dev/null 2>&1
status=$?
set -e
assert_eq 1 "$status" 'health should fail once the host is down'

vh ensure > "$scratch/ensure.out"
assert_grep 'down; restarting' "$scratch/ensure.out"
vh health > /dev/null || fail 'ensure should bring the host back'

set +e
"$repo/ops/bin/ogm-voice-host" nonsense > /dev/null 2>&1
status=$?
set -e
assert_eq 64 "$status" 'an unknown action is a usage error'

printf 'ok voice-host\n'
