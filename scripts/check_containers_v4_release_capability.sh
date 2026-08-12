#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
RELEASE_ROOT="$ROOT_DIR/spec/redevplugin/official-containers-capability-v4"
BUNDLE_ROOT="$RELEASE_ROOT/bundle"
SOURCE_CONTRACT="$ROOT_DIR/spec/capabilities/container-resources-v4.contract.json"
PUBLIC_KEY="$RELEASE_ROOT/host-capability.public.json"
PIN="$BUNDLE_ROOT/host-capability.pin.json"

GOWORK=off GOTOOLCHAIN=go1.26.5+auto go run github.com/floegence/redevplugin/cmd/redevplugin@v0.7.26 \
  host-capability verify "$BUNDLE_ROOT" "$PIN" "$PUBLIC_KEY" >/dev/null

cmp "$ROOT_DIR/spec/redevplugin/candidate-containers-capability/capabilities/redeven.container_resources.v4/v4.0.0/redeven.container_resources.v4.client.ts" \
  "$BUNDLE_ROOT/capabilities/redeven.container_resources.v4/v4.0.0/redeven.container_resources.v4.client.ts"

node - "$ROOT_DIR" "$RELEASE_ROOT" <<'NODE'
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [root, releaseRoot] = process.argv.slice(2);
const config = readJSON(path.join(releaseRoot, 'publisher-config.json'));
const publicKey = readJSON(path.join(releaseRoot, 'host-capability.public.json'));
const bundleRoot = path.join(releaseRoot, 'bundle');
const pin = readJSON(path.join(bundleRoot, 'host-capability.pin.json'));
const request = readJSON(path.join(releaseRoot, 'signing', 'request.json'));
const response = readJSON(path.join(releaseRoot, 'signing', 'response.json'));

if (config.schema_version !== 'redevplugin.host_capability_publisher_config.v1'
  || config.min_redevplugin_version !== '0.6.23'
  || config.artifact_base_ref !== 'capabilities/redeven.container_resources.v4/v4.0.0'
  || !/^[a-f0-9]{40}$/u.test(config.source_commit)) {
  throw new Error('Containers v4 capability publisher config is invalid');
}
if (publicKey.schema_version !== 'redevplugin.ed25519_signing_key.v1'
  || publicKey.publisher_id !== 'com.redeven.official'
  || publicKey.key_id !== 'redeven_official_signing_2026') {
  throw new Error('Containers v4 capability public identity is invalid');
}
if (pin.publisher_id !== publicKey.publisher_id
  || pin.signature_key_id !== publicKey.key_id
  || pin.contract_id !== 'redeven.container_resources.v4'
  || pin.contract_version !== '4.0.0'
  || pin.artifact_sha256 !== '0137cd99569a48d3ef4061b19b2fda021ed02cf268094b79c29a40f74bce0b92') {
  throw new Error('Containers v4 capability pin is invalid');
}
if (request.schema_version !== 'redevplugin.host_capability_signer_request.v1'
  || response.schema_version !== 'redevplugin.host_capability_signer_response.v1'
  || request.request_id !== response.request_id
  || request.signing_preimage_sha256 !== response.signing_preimage_sha256
  || request.manifest_sha256 !== response.manifest_sha256
  || request.key_id !== response.key_id) {
  throw new Error('Containers v4 capability signing exchange is not exact');
}

const source = spawnSync('git', ['show', `${config.source_commit}:spec/capabilities/container-resources-v4.contract.json`], {
  cwd: root,
  encoding: null,
});
const bundleContract = readJSON(path.join(bundleRoot, pin.artifact_ref));
if (source.status !== 0 || !deepEqual(normalize(JSON.parse(source.stdout.toString('utf8'))), normalize(bundleContract))) {
  throw new Error('Containers v4 capability source commit does not bind the published schema');
}

const files = walk(bundleRoot).map((file) => path.relative(bundleRoot, file)).sort();
if (files.length !== 8
  || !files.includes('host-capability.pin.json')
  || !files.includes('host-capability.public.json')) {
  throw new Error('Containers v4 capability bundle inventory is incomplete');
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((value, index) => deepEqual(value, right[index]));
  if (typeof left !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, entry]) => !(key === 'plan_hash_required' && entry === false))
      .map(([key, entry]) => [key, normalize(entry)]));
  }
  return value;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
NODE

echo "Containers v4 official capability release verified"
