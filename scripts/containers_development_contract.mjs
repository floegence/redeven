import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const capabilityBundleRelative = 'spec/redevplugin/official-containers-capability-v4/bundle';
const capabilityPinFilename = 'host-capability.pin.json';
const expectedArtifactRef = 'capabilities/redeven.container_resources.v4/v4.0.0/redeven.container_resources.v4.schema.json';

export function loadContainersProductionCapability(root) {
  const bundleRoot = resolve(root, capabilityBundleRelative);
  const pin = readJSON(resolve(bundleRoot, capabilityPinFilename));
  if (pin.publisher_id !== 'com.redeven.official'
    || pin.contract_id !== 'redeven.container_resources.v4'
    || pin.contract_version !== '4.0.0'
    || pin.artifact_ref !== expectedArtifactRef
    || pin.signature_key_id !== 'redeven_official_signing_2026') {
    throw new Error('Containers production capability pin identity is invalid');
  }
  const artifactPath = resolve(bundleRoot, pin.artifact_ref);
  if (!artifactPath.startsWith(`${bundleRoot}${sep}`)) {
    throw new Error('Containers production capability artifact escapes its signed bundle');
  }
  const artifact = readFileSync(artifactPath);
  if (sha256(artifact) !== pin.artifact_sha256) {
    throw new Error('Containers production capability artifact hash does not match its signed pin');
  }
  const contract = JSON.parse(artifact.toString('utf8'));
  if (contract.contract_id !== pin.contract_id
    || contract.contract_version !== pin.contract_version
    || contract.capability_id !== 'redeven.capability.container_resources'
    || contract.capability_version !== '3.0.0'
    || !Array.isArray(contract.methods)
    || contract.methods.length !== 52) {
    throw new Error('Containers production capability contract identity is invalid');
  }
  return { pin, contract };
}

export function bindContainersProductionCapability(manifest, capability) {
  manifest.capability_bindings = [{ binding_id: 'containers-v4', contract: capability.pin }];
  manifest.methods = capability.contract.methods.map((method) => ({
    method: method.name,
    route: { kind: 'capability', binding_id: 'containers-v4', target_method: method.name },
  }));
}

function readJSON(filename) {
  return JSON.parse(readFileSync(filename, 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
