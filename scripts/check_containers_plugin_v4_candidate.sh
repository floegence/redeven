#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
PLUGIN_DIR="$ROOT_DIR/plugins/official/containers"
CANDIDATE="$ROOT_DIR/spec/redevplugin/candidate-containers-plugin/4.0.0/plugin.redevplugin"
CAPABILITY_DIR="$ROOT_DIR/spec/redevplugin/candidate-containers-capability/capabilities/redeven.container_resources.v4/v4.0.0"
SOURCE_CONTRACT="$ROOT_DIR/spec/capabilities/container-resources-v4.contract.json"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

cd "$PLUGIN_DIR"
npm ci --no-audit --no-fund
npm test
npm run build

cd "$ROOT_DIR"
node scripts/build_containers_v4_contract.mjs --verify
GOWORK=off go run github.com/floegence/redevplugin/cmd/redevplugin@v0.6.20 \
  package "$PLUGIN_DIR/dist" "$TEMP_DIR/plugin.redevplugin" >/dev/null
cmp "$TEMP_DIR/plugin.redevplugin" "$CANDIDATE"
GOWORK=off go run github.com/floegence/redevplugin/cmd/redevplugin@v0.6.20 \
  validate "$CANDIDATE" >/dev/null

if unzip -Z1 "$CANDIDATE" | grep -Fxq 'signatures/package.sig'; then
  echo "Containers v4 candidate unexpectedly contains official signature evidence" >&2
  exit 1
fi

unzip -p "$CANDIDATE" manifest.json | node -e '
  let source = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { source += chunk; });
  process.stdin.on("end", () => {
    const manifest = JSON.parse(source);
    if (manifest.schema_version !== "redevplugin.manifest.v7"
      || manifest.plugin?.version !== "4.0.0"
      || manifest.plugin?.min_runtime_version !== "0.6.20"
      || manifest.plugin?.ui_protocol_version !== "plugin-ui-v7") {
      throw new Error("Containers v4 candidate version matrix is invalid");
    }
    if (Object.hasOwn(manifest, "capability_bindings") || Object.hasOwn(manifest, "methods")) {
      throw new Error("Unsigned Containers v4 candidate must fail closed without capability routes");
    }
  });
'

cmp "$SOURCE_CONTRACT" "$CAPABILITY_DIR/redeven.container_resources.v4.schema.json"
GOWORK=off go run ./scripts/redevplugin_candidate_client \
  "$SOURCE_CONTRACT" "$TEMP_DIR/redeven.container_resources.v4.client.ts"
cmp "$TEMP_DIR/redeven.container_resources.v4.client.ts" \
  "$CAPABILITY_DIR/redeven.container_resources.v4.client.ts"

node - "$SOURCE_CONTRACT" "$CAPABILITY_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [contractPath, capabilityDir] = process.argv.slice(2);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
if (contract.contract_id !== 'redeven.container_resources.v4'
  || contract.contract_version !== '4.0.0'
  || contract.capability_version !== '3.0.0'
  || contract.methods.length !== 52) {
  throw new Error('Containers v4 candidate capability identity or method count is invalid');
}
for (const method of contract.methods) {
  if (method.name === 'endpoints.list') continue;
  for (const schema of [method.target_schema, method.request_schema]) {
    if (schema?.properties?.engine && !schema.properties.endpoint_id) {
      throw new Error(`${method.name} does not bind endpoint identity`);
    }
  }
  if (method.preflight_only && method.response_schema?.properties?.plan_digest
    && !method.response_schema.required?.includes('plan_digest')) {
    throw new Error(`${method.name} does not require an authoritative plan digest`);
  }
}
const expectedPermissionByMethod = new Map([
  ['containers.create.preflight', 'containers.execute'],
  ['containers.create', 'containers.execute'],
  ['images.pull', 'containers.images.write'],
  ['images.tag', 'containers.images.write'],
  ['volumes.create.preflight', 'containers.execute'],
  ['volumes.create', 'containers.execute'],
]);
for (const method of contract.methods) {
  const expectedPermission = expectedPermissionByMethod.get(method.name)
    ?? (method.effect === 'delete' || method.name.includes('.remove') || method.name.includes('.prune')
      ? 'containers.delete'
      : method.effect === 'read' ? 'containers.read' : 'containers.execute');
  if (method.required_permissions?.length !== 1
    || method.required_permissions[0] !== expectedPermission) {
    throw new Error(`${method.name} does not use the established Containers permission groups`);
  }
}
for (const [methodName, permission] of [
  ['compose.projects.down', 'containers.delete'],
  ['pods.remove', 'containers.delete'],
  ['pods.create', 'containers.execute'],
]) {
  const method = contract.methods.find((item) => item.name === methodName);
  if (!method?.required_permissions?.includes(permission)
    || !method.confirmation?.plan_hash_required
    || !method.confirmation.request_hash_fields.includes('endpoint_id')) {
    throw new Error(`${methodName} does not preserve the signed permission and preflight boundary`);
  }
}
const podPorts = contract.methods.find((item) => item.name === 'pods.list')
  ?.response_schema?.properties?.pods?.items?.properties?.ports;
if (podPorts?.items?.properties?.port?.maximum !== 65535
  || podPorts.items.properties.host_port?.minimum !== 0) {
  throw new Error('Pod inventory does not expose the bounded published-port projection');
}
const expected = new Set([
  'redeven.container_resources.v4.schema.json',
  'redeven.container_resources.v4.client.ts',
  'redeven.container_resources.v4.compatibility.json',
  'redeven.container_resources.v4.notices.json',
]);
const entries = fs.readdirSync(capabilityDir);
if (entries.length !== expected.size || entries.some((entry) => !expected.has(entry))) {
  throw new Error('Unsigned Containers v4 capability candidate contains signing or publication metadata');
}
const client = fs.readFileSync(path.join(capabilityDir, 'redeven.container_resources.v4.client.ts'), 'utf8');
for (const symbol of ['RedevenContainerResourcesV4Client', 'listEndpoints', 'endpointStatus', 'listComposeProjects', 'downComposeProject', 'listPods', 'createPod', 'removePod']) {
  if (!client.includes(symbol)) throw new Error(`Generated v4 client is missing ${symbol}`);
}
NODE

echo "Containers plugin 4.0.0 unsigned fail-closed candidate verified"
