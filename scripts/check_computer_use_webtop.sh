#!/usr/bin/env bash
set -euo pipefail
umask 077

# Opt-in, visible Linux qualification. No process in this script sends input
# to the host display. Runtime sockets and authority keys stay in the container.
[[ ${REDEVEN_COMPUTER_USE_E2E:-} == 1 ]] || { echo 'Set REDEVEN_COMPUTER_USE_E2E=1 for real DeepSeek qualification.' >&2; exit 2; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
SOURCE_STATE=${REDEVEN_COMPUTER_CONFIG_ROOT:-$HOME/.redeven/local-environment}
PLUGIN_DIR=${REDEVEN_COMPUTER_WEBTOP_PLUGIN_DIRECTORY:?Provide a verified Linux ReDevPlugin runtime artifact directory}
IMAGE=${REDEVEN_COMPUTER_WEBTOP_IMAGE:-lscr.io/linuxserver/webtop@sha256:9092b349d525f765b0be912db1ec5a8d5aa97b0f1a3b57da27a7f72e69c90825}
[[ "$IMAGE" == *@sha256:* ]] || { echo 'Webtop image must use an immutable digest.' >&2; exit 2; }
WORK=$(mktemp -d /tmp/redeven-computer-webtop.XXXXXX)
REPORT="$WORK/report"
mkdir -p "$REPORT" "$WORK/bundle" "$WORK/workspace"
CID=
PORT=
CONFIG_HASH=$(shasum -a 256 "$SOURCE_STATE/config.json" | awk '{print $1}')
SECRETS_HASH=$(shasum -a 256 "$SOURCE_STATE/secrets.json" | awk '{print $1}')
cleanup() {
  local status=$? removed=true unchanged=true clean=true remaining attempt
  trap - EXIT INT TERM
  if [[ -n "$CID" ]]; then
    docker stop --time 15 "$CID" >/dev/null 2>&1 || true
    # Both stop and rm can return while --rm removal is still in progress.
    # Verify exact-ID absence with a bounded wait; a failed inventory read is
    # a cleanup failure, never evidence that the container disappeared.
    docker rm --force "$CID" >/dev/null 2>&1 || true
    removed=false
    for attempt in {1..50}; do
      if ! remaining=$(docker ps -aq --no-trunc --filter "id=$CID"); then break; fi
      if [[ -z "$remaining" ]]; then removed=true; break; fi
      sleep .2
    done
    [[ "$removed" == true ]] || status=1
  fi
  node "$SCRIPT_DIR/smoke_flower_deepseek.mjs" scan-source-secret "$SOURCE_STATE" "$REPORT" "$ROOT_DIR" || { clean=false; status=1; }
  [[ "$CONFIG_HASH" == "$(shasum -a 256 "$SOURCE_STATE/config.json" | awk '{print $1}')" && "$SECRETS_HASH" == "$(shasum -a 256 "$SOURCE_STATE/secrets.json" | awk '{print $1}')" ]] || { unchanged=false; status=1; }
  rm -rf "$WORK/bundle" "$WORK/seed" "$WORK/workspace"
  if ! node - "$REPORT/cleanup.json" "$removed" "$unchanged" "$clean" "$PORT" <<'JS'
const fs = require('node:fs');
const net = require('node:net');
const [file, removed, unchanged, clean, port] = process.argv.slice(2);
const evidence = { container_removed: removed === 'true', source_state_unchanged: unchanged === 'true', secret_leak_found: clean !== 'true', temporary_provider_state_removed: removed === 'true', host_input_used: false };
const finish = (released) => { evidence.ports_released = released; fs.writeFileSync(file, JSON.stringify(evidence, null, 2)); if (!released) process.exitCode = 1; };
if (!port) finish(true);
else { const server = net.createServer(); server.on('error', () => finish(false)); server.listen(Number(port), '127.0.0.1', () => server.close(() => finish(true))); }
JS
  then status=1; fi
  echo "Linux Webtop evidence: $REPORT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker pull "$IMAGE" > "$REPORT/image.log" 2>&1
ARCH=$(docker image inspect "$IMAGE" --format '{{.Architecture}}')
[[ "$ARCH" == arm64 || "$ARCH" == amd64 ]] || { echo 'Unsupported Linux architecture.' >&2; exit 2; }
node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-runtime-directory --root "$PLUGIN_DIR" --target "linux/$ARCH" --require-release false
cp -a "$PLUGIN_DIR/." "$WORK/bundle/"
COMMIT=$(git -C "$ROOT_DIR" rev-parse HEAD)
"$SCRIPT_DIR/build_assets.sh" > "$REPORT/assets.log" 2>&1
GOWORK=off GOOS=linux GOARCH="$ARCH" CGO_ENABLED=0 go -C "$ROOT_DIR" build -ldflags "-X main.Version=v0.0.0-dev -X main.Commit=$COMMIT" -o "$WORK/bundle/redeven" ./cmd/redeven
REDEVEN_FLOWER_SMOKE_ROOT=/qualification node "$SCRIPT_DIR/smoke_flower_deepseek.mjs" prepare-provider "$SOURCE_STATE" "$WORK/seed" "$REPORT/provider.json"
NODE_VERSION=$(cat "$ROOT_DIR/.node-version")
NODE_ARCHIVE_OVERRIDE=
if [[ -n "${REDEVEN_NODE_ARCHIVE:-}" ]]; then
  cp "$REDEVEN_NODE_ARCHIVE" "$WORK/workspace/node-archive.tar.gz"
  NODE_ARCHIVE_OVERRIDE=/qualification/workspace/node-archive.tar.gz
fi
CID=$(docker run --rm -d --label "redeven.qualification=$WORK" --shm-size=2g \
  -p 127.0.0.1::3000 -e TZ=Asia/Shanghai \
  -v "$WORK:/qualification" -v "$ROOT_DIR:/source:ro" "$IMAGE")
PORT=$(docker port "$CID" 3000/tcp | cut -d: -f2)
node - "$REPORT/manifest.json" "$COMMIT" "$CID" "$IMAGE" "$PORT" <<'JS'
const fs = require('node:fs'); const [file, commit, container_id, image, port] = process.argv.slice(2);
fs.writeFileSync(file, JSON.stringify({ commit, container_id, image, port: Number(port), state: '/config/qualification-state', gowork: 'off', host_input_used: false }, null, 2));
JS
echo "Linux Webtop: http://127.0.0.1:$PORT"
docker exec -e "NODE_VERSION=$NODE_VERSION" -e "NODE_ARCH=$ARCH" -e "NODE_ARCHIVE_OVERRIDE=$NODE_ARCHIVE_OVERRIDE" "$CID" bash -ceu '
  sed -i "/^deb-src /d" /etc/apt/sources.list
  apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=1 update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=1 install -y -qq curl ca-certificates libnss3-tools openbox xdotool imagemagick xauth x11-utils xterm python3-tk
  archive="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz"
  cd /tmp
  if [[ -n "$NODE_ARCHIVE_OVERRIDE" ]]; then cp "$NODE_ARCHIVE_OVERRIDE" "$archive";
  else curl -fsSL --connect-timeout 15 --max-time 180 "https://nodejs.org/dist/v${NODE_VERSION}/$archive" -o "$archive"; fi
  curl -fsSL --connect-timeout 15 --max-time 60 "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o node-sums
  grep " $archive\$" node-sums | sha256sum -c -
  tar -xzf "$archive" -C /opt
  export PATH="/opt/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin:$PATH"
  node /source/internal/envapp/ui_src/node_modules/playwright/cli.js install --with-deps chromium
  REDEVEN_NODE_ARCHIVE="/tmp/$archive" node /source/scripts/stage_computer_resources.mjs /qualification/bundle/computer
  mkdir -p /config/qualification-state/local-environment
  cp /qualification/seed/config.json /qualification/seed/secrets.json /config/qualification-state/local-environment/
  rm -rf /qualification/seed
  /qualification/bundle/redeven local-authority device-ca generate --state-root /config/qualification-state
  mkdir -p /config/.pki/nssdb
  certutil -N -d sql:/config/.pki/nssdb --empty-password
  certutil -A -d sql:/config/.pki/nssdb -n Redeven-Qualification-CA -t "C,," -i /config/qualification-state/local-environment/local-ui-tls/device-ca.pem
' > "$REPORT/setup.log" 2>&1
node - "$REPORT/build-hashes.json" "$WORK/bundle" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [file, bundle] = process.argv.slice(2);
const hashes = {};
for (const relative of ['redeven', 'computer/manifest.json', '.redevplugin-release-artifacts-verified.json']) {
  const target = path.join(bundle, relative);
  hashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}
fs.writeFileSync(file, JSON.stringify(hashes, null, 2));
JS
docker exec -d "$CID" bash -ceu 'exec /qualification/bundle/redeven run --mode local --state-root /config/qualification-state --local-ui-bind 127.0.0.1:23998 --presentation machine > /qualification/report/runtime.log 2>&1'
docker exec "$CID" bash -ceu '
  for attempt in {1..100}; do
    if curl --fail --silent --cacert /config/qualification-state/local-environment/local-ui-tls/device-ca.pem https://127.0.0.1:23998/_redeven_proxy/api/ai/threads >/dev/null; then exit 0; fi
    sleep .2
  done
  exit 1
'
docker exec -e DISPLAY=:1 -e REDEVEN_COMPUTER_USE_E2E=1 -e REDEVEN_COMPUTER_X11_E2E=1 \
  -e REDEVEN_COMPUTER_WEBTOP_URL=https://127.0.0.1:23998 \
  -e REDEVEN_COMPUTER_EVIDENCE_DIR=/qualification/report/computer \
  -e REDEVEN_COMPUTER_CONFIG_ROOT=/config/qualification-state/local-environment \
  "$CID" "/opt/node-v${NODE_VERSION}-linux-${ARCH}/bin/node" \
  /source/internal/envapp/ui_src/scripts/checkDesktopComputerStage.mjs > "$REPORT/flower.log" 2>&1
