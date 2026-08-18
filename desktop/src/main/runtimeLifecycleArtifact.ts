import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import type {
  GatewayRuntimeArtifactMetadata,
  GatewayRuntimeOperation,
} from './gatewayClient';
import { prepareDesktopRuntimeUploadAsset, runtimeReleaseFetchPolicy } from './runtimePackageCache';
import {
  ensureDesktopSSHVerifiedReleaseManifest,
  fetchDesktopSSHSignedReleaseJSONAsset,
  type DesktopSSHRemotePlatform,
  type DesktopSSHSignedReleaseJSONAsset,
  type DesktopSSHVerifiedReleaseManifest,
} from './sshReleaseAssets';

const GATEWAY_PROTOCOL = 'redeven-gateway-v2';
const RUNTIME_SERVICE_PROTOCOL = 'redeven-runtime-v2';
const RUNTIME_COMPATIBILITY_EPOCH = 9;

export type RuntimeCompatibilityManifest = Readonly<{
  schema_version: number;
  release_set_id: string;
  gateway: Readonly<{
    version: string;
    sha256: string;
    protocol: string;
    capabilities: readonly string[];
  }>;
  runtime: Readonly<{
    version: string;
    sha256: string;
    service_protocol: string;
    compatibility_epoch: number;
    capabilities: readonly string[];
    platform: string;
    architecture: string;
  }>;
  compatibility: Readonly<{
    desktop_gateway_protocols: readonly string[];
    gateway_runtime_epochs: readonly number[];
    upgrade_from_runtime_epochs: readonly number[];
    required_upgrade_order: readonly string[];
  }>;
}>;

export type PreparedRuntimeLifecycleArtifact = Readonly<{
  artifact: Buffer;
  metadata: GatewayRuntimeArtifactMetadata;
}>;

export type PublishedRuntimeLifecyclePreflight = Readonly<{
  compatibilityManifest: RuntimeCompatibilityManifest;
  platform: DesktopSSHRemotePlatform;
  releaseManifest: DesktopSSHVerifiedReleaseManifest;
  signedManifest: DesktopSSHSignedReleaseJSONAsset;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedVersion(value: unknown): string {
  return compact(value).replace(/^v/u, '');
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJSONValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJSONValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJSONValue(entry)]),
    );
  }
  return value;
}

function canonicalJSONDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJSONValue(value)))
    .digest('base64url');
}

function tarString(block: Buffer, offset: number, length: number): string {
  const end = block.subarray(offset, offset + length).indexOf(0);
  return block.subarray(offset, offset + (end < 0 ? length : end)).toString('utf8').trim();
}

function tarSize(block: Buffer): number {
  const raw = tarString(block, 124, 12).replace(/\0/gu, '').trim();
  if (!/^[0-7]+$/u.test(raw)) {
    throw new Error('Runtime archive contains an invalid tar size.');
  }
  const size = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('Runtime archive contains an invalid tar size.');
  }
  return size;
}

export function runtimeExecutableFromArchive(archive: Buffer): Buffer {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive);
  } catch {
    throw new Error('Runtime release archive is not a valid gzip stream.');
  }
  let offset = 0;
  let executable: Buffer | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = [tarString(header, 345, 155), tarString(header, 0, 100)].filter(Boolean).join('/');
    const type = String.fromCharCode(header[156] ?? 0);
    const size = tarSize(header);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) {
      throw new Error('Runtime release archive is truncated.');
    }
    if (name === 'redeven' && (type === '\0' || type === '0')) {
      if (executable) {
        throw new Error('Runtime release archive contains more than one redeven executable.');
      }
      executable = Buffer.from(tar.subarray(bodyStart, bodyEnd));
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  if (!executable || executable.length === 0) {
    throw new Error('Runtime release archive does not contain the redeven executable.');
  }
  return executable;
}

export function buildCustomRuntimeArtifactMetadata(
  operation: GatewayRuntimeOperation,
  artifact: Buffer,
): GatewayRuntimeArtifactMetadata {
  if (operation.kind !== 'update_runtime'
    || operation.desired_runtime.artifact_policy !== 'custom_build'
    || operation.build_inputs === undefined) {
    throw new Error('Custom Runtime artifact metadata requires a bound custom-build update operation.');
  }
  const archiveSHA256 = sha256(artifact);
  const executableSHA256 = sha256(runtimeExecutableFromArchive(artifact));
  return {
    size_bytes: artifact.length,
    archive_sha256: archiveSHA256,
    executable_sha256: executableSHA256,
    manifest: {
      schema_version: 1,
      source: 'desktop_source_build',
    },
    build_attestation: {
      operation_id: operation.operation_id,
      lifecycle_target_id: operation.lifecycle_target_id,
      target_generation: operation.target_generation,
      build_inputs_digest: canonicalJSONDigest(operation.build_inputs),
      archive_sha256: archiveSHA256,
      executable_sha256: executableSHA256,
      platform: operation.desired_runtime.platform,
      architecture: operation.desired_runtime.architecture,
    },
  };
}

export async function prepareCustomRuntimeLifecycleArtifact(input: Readonly<{
  operation: GatewayRuntimeOperation;
  runtimeReleaseTag: string;
  releaseBaseURL: string;
  assetCacheRoot: string;
  sourceRuntimeRoot: string;
  signal?: AbortSignal;
}>): Promise<PreparedRuntimeLifecycleArtifact> {
  const platform = releasePlatform(
    input.operation.desired_runtime.platform,
    input.operation.desired_runtime.architecture,
  );
  const prepared = await prepareDesktopRuntimeUploadAsset({
    runtimeReleaseTag: input.runtimeReleaseTag,
    releaseBaseURL: input.releaseBaseURL,
    assetCacheRoot: input.assetCacheRoot,
    sourceRuntimeRoot: input.sourceRuntimeRoot,
    platform,
    fetchPolicy: runtimeReleaseFetchPolicy(30_000, input.signal),
    signal: input.signal,
  });
  if (prepared.source !== 'source_build' && prepared.source !== 'source_build_cache') {
    throw new Error('Managed custom Runtime updates require an artifact built from the current Desktop source.');
  }
  return {
    artifact: prepared.archiveData,
    metadata: buildCustomRuntimeArtifactMetadata(input.operation, prepared.archiveData),
  };
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(compact).filter(Boolean) : [];
}

function integerList(value: unknown): readonly number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isSafeInteger(item) && item > 0)
    : [];
}

export function validateRuntimeCompatibilityManifest(input: Readonly<{
  value: unknown;
  releaseTag: string;
  platform: DesktopSSHRemotePlatform;
  currentRuntimeEpoch: number;
}>): RuntimeCompatibilityManifest {
  if (!input.value || typeof input.value !== 'object') {
    throw new Error('Runtime compatibility manifest is invalid.');
  }
  const value = input.value as Record<string, unknown>;
  const gateway = value.gateway && typeof value.gateway === 'object' ? value.gateway as Record<string, unknown> : {};
  const runtime = value.runtime && typeof value.runtime === 'object' ? value.runtime as Record<string, unknown> : {};
  const compatibility = value.compatibility && typeof value.compatibility === 'object'
    ? value.compatibility as Record<string, unknown>
    : {};
  const runtimeSHA256 = compact(runtime.sha256).toLowerCase();
  const gatewaySHA256 = compact(gateway.sha256).toLowerCase();
  const gatewayCapabilities = stringList(gateway.capabilities);
  const runtimeCapabilities = stringList(runtime.capabilities);
  const desktopGatewayProtocols = stringList(compatibility.desktop_gateway_protocols);
  const gatewayRuntimeEpochs = integerList(compatibility.gateway_runtime_epochs);
  const upgradeFromRuntimeEpochs = integerList(compatibility.upgrade_from_runtime_epochs);
  const requiredUpgradeOrder = stringList(compatibility.required_upgrade_order);
  const currentRuntimeEpoch = Math.floor(Number(input.currentRuntimeEpoch));
  if (
    Number(value.schema_version) !== 1
    || compact(value.release_set_id) === ''
    || !/^[a-f0-9]{64}$/u.test(gatewaySHA256)
    || compact(gateway.protocol) !== GATEWAY_PROTOCOL
    || !gatewayCapabilities.includes('runtime_operations_v2')
    || !gatewayCapabilities.includes('manual_recovery_v1')
    || !gatewayCapabilities.includes('signed_artifact_policy_v1')
    || normalizedVersion(runtime.version) !== normalizedVersion(input.releaseTag)
    || !/^[a-f0-9]{64}$/u.test(runtimeSHA256)
    || compact(runtime.service_protocol) !== RUNTIME_SERVICE_PROTOCOL
    || Number(runtime.compatibility_epoch) !== RUNTIME_COMPATIBILITY_EPOCH
    || !runtimeCapabilities.includes('lifecycle_fence_v1')
    || compact(runtime.platform).toLowerCase() !== input.platform.goos
    || compact(runtime.architecture).toLowerCase() !== input.platform.goarch
    || !desktopGatewayProtocols.includes(GATEWAY_PROTOCOL)
    || !gatewayRuntimeEpochs.includes(RUNTIME_COMPATIBILITY_EPOCH)
    || requiredUpgradeOrder.length !== 2
    || requiredUpgradeOrder[0] !== 'gateway'
    || requiredUpgradeOrder[1] !== 'runtime'
    || (currentRuntimeEpoch > 0
      && currentRuntimeEpoch !== RUNTIME_COMPATIBILITY_EPOCH
      && !upgradeFromRuntimeEpochs.includes(currentRuntimeEpoch))
  ) {
    throw new Error('Runtime compatibility manifest does not authorize this managed update.');
  }
  return input.value as RuntimeCompatibilityManifest;
}

function releasePlatform(platform: string, architecture: string): DesktopSSHRemotePlatform {
  const goos = compact(platform).toLowerCase();
  const goarch = compact(architecture).toLowerCase();
  if ((goos !== 'linux' && goos !== 'darwin') || (goarch !== 'amd64' && goarch !== 'arm64')) {
    throw new Error(`Runtime lifecycle does not support ${goos || 'unknown'}/${goarch || 'unknown'}.`);
  }
  return {
    goos,
    goarch,
    platform_id: `${goos}_${goarch}`,
    release_package_name: `redeven_${goos}_${goarch}.tar.gz`,
    platform_label: `${goos}/${goarch}`,
  };
}

export async function preparePublishedRuntimeLifecycleArtifact(input: Readonly<{
  runtimeReleaseTag: string;
  releaseBaseURL: string;
  assetCacheRoot: string;
  platform: string;
  architecture: string;
  currentRuntimeEpoch: number;
  preflight?: PublishedRuntimeLifecyclePreflight;
  signal?: AbortSignal;
}>): Promise<PreparedRuntimeLifecycleArtifact> {
  const platform = releasePlatform(input.platform, input.architecture);
  const fetchPolicy = runtimeReleaseFetchPolicy(30_000, input.signal);
  const preflight = input.preflight ?? await preflightPublishedRuntimeLifecycleArtifact(input);
  if (
    normalizedVersion(preflight.releaseManifest.release_tag) !== normalizedVersion(input.runtimeReleaseTag)
    || preflight.releaseManifest.release_base_url.replace(/\/$/u, '') !== input.releaseBaseURL.replace(/\/$/u, '')
    || preflight.platform.goos !== platform.goos
    || preflight.platform.goarch !== platform.goarch
  ) {
    throw new Error('Runtime compatibility preflight does not match the requested release target.');
  }
  const prepared = await prepareDesktopRuntimeUploadAsset({
    runtimeReleaseTag: input.runtimeReleaseTag,
    releaseBaseURL: input.releaseBaseURL,
    assetCacheRoot: input.assetCacheRoot,
    platform,
    fetchPolicy,
    signal: input.signal,
  });
  if (!prepared.cacheEntry || prepared.source !== 'release_cache') {
    throw new Error('Managed published Runtime updates require a verified release archive.');
  }
  const executableSHA256 = sha256(runtimeExecutableFromArchive(prepared.archiveData));
  if (executableSHA256 !== compact(preflight.compatibilityManifest.runtime.sha256).toLowerCase()) {
    throw new Error('Runtime executable digest does not match the signed compatibility manifest.');
  }
  const archiveSHA256 = sha256(prepared.archiveData);
  if (archiveSHA256 !== prepared.cacheEntry.sha256.toLowerCase()) {
    throw new Error('Runtime archive digest changed after release verification.');
  }
  return {
    artifact: prepared.archiveData,
    metadata: {
      size_bytes: prepared.archiveData.length,
      archive_sha256: archiveSHA256,
      executable_sha256: executableSHA256,
      manifest: preflight.compatibilityManifest,
      manifest_signature: preflight.signedManifest.signature,
      manifest_certificate: preflight.signedManifest.certificate,
    },
  };
}

export async function preflightPublishedRuntimeLifecycleArtifact(input: Readonly<{
  runtimeReleaseTag: string;
  releaseBaseURL: string;
  assetCacheRoot: string;
  platform: string;
  architecture: string;
  currentRuntimeEpoch: number;
  signal?: AbortSignal;
}>): Promise<PublishedRuntimeLifecyclePreflight> {
  const platform = releasePlatform(input.platform, input.architecture);
  const fetchPolicy = runtimeReleaseFetchPolicy(30_000, input.signal);
  const releaseManifest = await ensureDesktopSSHVerifiedReleaseManifest({
    releaseTag: input.runtimeReleaseTag,
    releaseBaseURL: input.releaseBaseURL,
    cacheRoot: input.assetCacheRoot,
    fetchPolicy,
  });
  const baseName = `redeven-runtime-compatibility_${platform.goos}_${platform.goarch}`;
  const signedManifest = await fetchDesktopSSHSignedReleaseJSONAsset({
    manifest: releaseManifest,
    asset_name: `${baseName}.json`,
    signature_name: `${baseName}.sig`,
    certificate_name: `${baseName}.pem`,
    fetchPolicy,
  });
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(signedManifest.json_text);
  } catch {
    throw new Error('Runtime compatibility manifest is invalid JSON.');
  }
  return {
    compatibilityManifest: validateRuntimeCompatibilityManifest({
      value: manifestValue,
      releaseTag: input.runtimeReleaseTag,
      platform,
      currentRuntimeEpoch: input.currentRuntimeEpoch,
    }),
    platform,
    releaseManifest,
    signedManifest,
  };
}
