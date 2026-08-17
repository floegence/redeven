#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

function fail(message) {
  throw new Error(message);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail(`${name} is required`);
  return process.argv[index + 1];
}

function tarString(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8').trim();
}

function executableFromArchive(archive, executableName) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = [tarString(header, 345, 155), tarString(header, 0, 100)].filter(Boolean).join('/');
    const rawSize = tarString(header, 124, 12).replace(/\0/gu, '').trim();
    if (!/^[0-7]+$/u.test(rawSize)) fail(`invalid tar size in ${executableName} archive`);
    const size = Number.parseInt(rawSize, 8);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) fail(`${executableName} archive is truncated`);
    if (name === executableName) return tar.subarray(bodyStart, bodyEnd);
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  fail(`${executableName} archive does not contain ${executableName}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const dist = path.resolve(argument('--dist'));
const tag = argument('--tag').trim();
if (!/^v[^\s]+$/u.test(tag)) fail('--tag must be a canonical v-prefixed release tag');
const compatibilityContract = JSON.parse(await readFile(new URL('../internal/runtimeservice/compatibility_contract.json', import.meta.url), 'utf8'));
const epoch = Number(compatibilityContract.compatibility_epoch);
if (!Number.isSafeInteger(epoch) || epoch <= 0) fail('runtime compatibility epoch is invalid');
const upgradeFromRuntimeEpochs = compatibilityContract.upgrade_from_runtime_epochs;
if (!Array.isArray(upgradeFromRuntimeEpochs)
  || upgradeFromRuntimeEpochs.some((value) => !Number.isSafeInteger(value) || value <= 0 || value >= epoch)
  || new Set(upgradeFromRuntimeEpochs).size !== upgradeFromRuntimeEpochs.length) {
  fail('runtime compatibility upgrade epochs are invalid');
}

for (const platform of ['linux', 'darwin']) {
  for (const architecture of ['amd64', 'arm64']) {
    const runtimeArchive = await readFile(path.join(dist, `redeven_${platform}_${architecture}.tar.gz`));
    const gatewayArchive = await readFile(path.join(dist, `redeven-gateway_${platform}_${architecture}.tar.gz`));
    const manifest = {
      schema_version: 1,
      release_set_id: tag,
      gateway: {
        version: tag,
        sha256: sha256(executableFromArchive(gatewayArchive, 'redeven-gateway')),
        protocol: 'redeven-gateway-v2',
        capabilities: [
          'runtime_operations_v2',
          'manual_recovery_v1',
          'signed_artifact_policy_v1',
        ],
      },
      runtime: {
        version: tag,
        sha256: sha256(executableFromArchive(runtimeArchive, 'redeven')),
        service_protocol: String(compatibilityContract.runtime_protocol_version),
        compatibility_epoch: epoch,
        capabilities: ['lifecycle_fence_v1'],
        platform,
        architecture,
      },
      compatibility: {
        desktop_gateway_protocols: ['redeven-gateway-v2'],
        gateway_runtime_epochs: [epoch],
        upgrade_from_runtime_epochs: upgradeFromRuntimeEpochs,
        required_upgrade_order: ['gateway', 'runtime'],
      },
    };
    const output = path.join(dist, `redeven-runtime-compatibility_${platform}_${architecture}.json`);
    await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }
}
