#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
PLUGIN_DIR="$ROOT_DIR/plugins/official/containers"
CANDIDATE="$ROOT_DIR/spec/redevplugin/candidate-containers-plugin/2.1.0/plugin.redevplugin"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

cd "$PLUGIN_DIR"
npm ci --no-audit --no-fund
npm test
npm run build

cd "$ROOT_DIR"
GOWORK=off go run github.com/floegence/redevplugin/cmd/redevplugin@v0.6.18 \
  package "$PLUGIN_DIR/dist" "$TEMP_DIR/plugin.redevplugin" >/dev/null
cmp "$TEMP_DIR/plugin.redevplugin" "$CANDIDATE"
GOWORK=off go run github.com/floegence/redevplugin/cmd/redevplugin@v0.6.18 \
  validate "$CANDIDATE" >/dev/null
if unzip -Z1 "$CANDIDATE" | grep -Fxq 'signatures/package.sig'; then
  echo "Containers candidate unexpectedly contains official signature evidence" >&2
  exit 1
fi
unzip -p "$CANDIDATE" manifest.json | node -e '
  let source = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { source += chunk; });
  process.stdin.on("end", () => {
    const manifest = JSON.parse(source);
    const expected = {
      schema_version: "redevplugin.manifest.v6",
      version: "2.1.0",
      min_runtime_version: "0.6.18",
      ui_protocol_version: "plugin-ui-v6",
    };
    if (manifest.schema_version !== expected.schema_version
      || manifest.plugin?.version !== expected.version
      || manifest.plugin?.min_runtime_version !== expected.min_runtime_version
      || manifest.plugin?.ui_protocol_version !== expected.ui_protocol_version) {
      throw new Error("Containers candidate version matrix is invalid");
    }
  });
'

echo "Containers plugin 2.1.0 unsigned candidate verified"
