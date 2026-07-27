#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
PLUGIN_DIR="$ROOT_DIR/plugins/official/containers"
CANDIDATE="$ROOT_DIR/spec/redevplugin/candidate-containers-plugin/3.0.0/plugin.redevplugin"
CAPABILITY_DIR="$ROOT_DIR/spec/redevplugin/candidate-containers-capability/capabilities/redeven.container_resources.v3/v3.0.0"
SOURCE_CONTRACT="$ROOT_DIR/spec/capabilities/container-resources-v3.contract.json"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

cd "$PLUGIN_DIR"
npm ci --no-audit --no-fund
npm test
npm run build

cd "$ROOT_DIR"
GOWORK=off go run github.com/floegence/redevplugin/cmd/redevplugin@v0.6.20 \
  package "$PLUGIN_DIR/dist" "$TEMP_DIR/plugin.redevplugin" >/dev/null
cmp "$TEMP_DIR/plugin.redevplugin" "$CANDIDATE"
GOWORK=off go run github.com/floegence/redevplugin/cmd/redevplugin@v0.6.20 \
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
    if (manifest.schema_version !== "redevplugin.manifest.v7"
      || manifest.plugin?.version !== "3.0.0"
      || manifest.plugin?.min_runtime_version !== "0.6.20"
      || manifest.plugin?.ui_protocol_version !== "plugin-ui-v7") {
      throw new Error("Containers candidate version matrix is invalid");
    }
    if (Object.hasOwn(manifest, "capability_bindings") || Object.hasOwn(manifest, "methods")) {
      throw new Error("Unsigned Containers candidate must fail closed without capability bindings or method routes");
    }
  });
'

cmp "$SOURCE_CONTRACT" "$CAPABILITY_DIR/redeven.container_resources.v3.schema.json"
GOWORK=off go run ./scripts/redevplugin_candidate_client \
  "$SOURCE_CONTRACT" "$TEMP_DIR/redeven.container_resources.v3.client.ts"
cmp "$TEMP_DIR/redeven.container_resources.v3.client.ts" \
  "$CAPABILITY_DIR/redeven.container_resources.v3.client.ts"
node - "$SOURCE_CONTRACT" "$CAPABILITY_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [contractPath, capabilityDir] = process.argv.slice(2);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
if (contract.contract_id !== 'redeven.container_resources.v3'
  || contract.contract_version !== '3.0.0'
  || contract.capability_version !== '2.0.0'
  || contract.methods.length !== 34) {
  throw new Error('Containers v3 candidate capability identity or method count is invalid');
}
for (const [method, preflight] of [
  ['images.prune', 'images.prune.preflight'],
  ['volumes.prune', 'volumes.prune.preflight'],
]) {
  const operation = contract.methods.find((item) => item.name === method);
  const plan = contract.methods.find((item) => item.name === preflight);
  if (!plan?.preflight_only || operation?.confirmation?.preflight_method !== preflight || !operation.confirmation.plan_hash_required) {
    throw new Error(`${method} does not use its exact authoritative preflight plan`);
  }
  for (const field of ['engine', 'resource_identities']) {
    if (!Object.hasOwn(operation.request_schema.properties ?? {}, field)
      || !Object.hasOwn(plan.request_schema.properties ?? {}, field)
      || !operation.confirmation.request_hash_fields.includes(field)) {
      throw new Error(`${method} does not bind the exact prune resource set`);
    }
  }
  if (!(operation.request_schema.required ?? []).includes('resource_identities')) {
    throw new Error(`${method} permits a broad prune without exact identities`);
  }
}
for (const operation of contract.methods.filter((item) => item.confirmation?.preflight_method)) {
  const preflight = contract.methods.find((item) => item.name === operation.confirmation.preflight_method);
  if (!preflight) throw new Error(`${operation.name} references a missing confirmation preflight`);
  const preflightFields = new Set(Object.keys(preflight.request_schema.properties ?? {}));
  const incompatibleFields = Object.keys(operation.request_schema.properties ?? {})
    .filter((field) => !preflightFields.has(field));
  if (incompatibleFields.length > 0) {
    throw new Error(`${operation.name} cannot be replayed through ${preflight.name}: ${incompatibleFields.join(', ')}`);
  }
  if (Object.hasOwn(operation.request_schema.properties ?? {}, 'plan_digest')
    || (operation.target_fields ?? []).includes('plan_digest')) {
    throw new Error(`${operation.name} must rely on the Host confirmation plan hash instead of a plugin-supplied digest`);
  }
}
const expected = new Set([
  'redeven.container_resources.v3.schema.json',
  'redeven.container_resources.v3.client.ts',
  'redeven.container_resources.v3.compatibility.json',
  'redeven.container_resources.v3.notices.json',
]);
const entries = fs.readdirSync(capabilityDir);
if (entries.length !== expected.size || entries.some((entry) => !expected.has(entry))) {
  throw new Error('Unsigned Containers capability candidate contains signing or publication metadata');
}
const client = fs.readFileSync(path.join(capabilityDir, 'redeven.container_resources.v3.client.ts'), 'utf8');
for (const symbol of ['RedevenContainerResourcesV3Client', 'removeImagePreflight', 'pruneImagesPreflight', 'pruneVolumesPreflight', 'statsSnapshot', 'statsWatch', 'createVolume']) {
  if (!client.includes(symbol)) throw new Error(`Generated v3 client is missing ${symbol}`);
}
if (client.includes('secret_like_count') || !client.includes('protected_count')) {
  throw new Error('Generated v3 client exposes a count key that conflicts with Host redaction');
}
NODE

echo "Containers plugin 3.0.0 unsigned fail-closed candidate verified"
