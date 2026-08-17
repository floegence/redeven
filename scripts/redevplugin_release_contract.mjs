#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
	 closeSync,
	 constants as fsConstants,
	 fstatSync,
	 openSync,
	 readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const releaseManifestAssetName = 'platform-release-manifest.json';
export const runtimeMarkerName = '.redevplugin-release-artifacts-verified.json';
export const runtimeNoticesName = 'REDEVPLUGIN_THIRD_PARTY_NOTICES.md';
export const runtimeSBOMName = 'REDEVPLUGIN_RUNTIME.spdx.json';
export const runtimeProvenanceName = 'redevplugin-runtime.provenance.json';
export const runtimeSignatureName = 'redevplugin-runtime.sig';
export const runtimeCertificateName = 'redevplugin-runtime.pem';
export const rustToolchain = '1.88.0';

const semverPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const sha512Pattern = /^[0-9a-f]{128}$/u;
const h1Pattern = /^h1:[A-Za-z0-9+/]{43}=$/u;
const integrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const cratesIORegistrySource = 'registry+https://github.com/rust-lang/crates.io-index';
const expectedNPM = Object.freeze([
  '@floegence/redevplugin-contracts',
  '@floegence/redevplugin-ui',
]);
const expectedRuntimeRust = Object.freeze(['redevplugin-runtime']);

export function validateReleaseManifest(value, { tag } = {}) {
  exactKeys(value, ['platform_version', 'plugin_api', 'internal_wire', 'artifacts'], 'platform release manifest');
  semver(value.platform_version, 'platform release manifest version');
  if (tag !== undefined && tag !== `v${value.platform_version}`) fail('release tag does not match platform release manifest');
  if (value.plugin_api !== 1 || value.internal_wire !== 1) fail('platform release protocol identity is invalid');
  if (!Array.isArray(value.artifacts) || value.artifacts.length < 5) fail('platform release artifacts are incomplete');
  const seen = new Set();
  let previous = '';
  for (const artifact of value.artifacts) {
    exactKeys(artifact, ['name', 'sha256'], 'platform release artifact');
    if (typeof artifact.name !== 'string' || !/^(go|npm|crate|contract):[^\s=]+$/u.test(artifact.name)
        || seen.has(artifact.name) || artifact.name <= previous) {
      fail('platform release artifact ordering or identity is invalid');
    }
    digest(artifact.sha256, `platform release artifact ${artifact.name}`);
    seen.add(artifact.name);
    previous = artifact.name;
  }
  for (const name of [
    'go:github.com/floegence/redevplugin/v3',
    'npm:@floegence/redevplugin-contracts',
    'npm:@floegence/redevplugin-ui',
    'crate:redevplugin-runtime',
    'crate:redevplugin-worker-sdk',
  ]) {
    if (!seen.has(name)) fail(`platform release artifact ${name} is missing`);
  }
  return structuredClone(value);
}
const markerFileNames = Object.freeze([
  runtimeNoticesName,
  runtimeSBOMName,
  runtimeProvenanceName,
  runtimeSignatureName,
  runtimeCertificateName,
]);

export function parseStrictJSON(raw, label = 'JSON', maximum = 256 * 1024) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (bytes.length < 1 || bytes.length > maximum) {
    throw new Error(`${label} exceeds its closed size limit`);
  }
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) throw new Error(`${label} is not UTF-8`);
  let index = 0;

  const whitespace = () => {
    while (index < source.length && /[\x20\x09\x0a\x0d]/u.test(source[index])) index += 1;
  };
  const stringToken = () => {
    const start = index;
    if (source[index] !== '"') throw new Error(`${label} contains invalid JSON`);
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch {
          throw new Error(`${label} contains an invalid string`);
        }
      }
      if (character === '\\') {
        index += 1;
        if (index >= source.length) break;
        if (source[index] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(source.slice(index + 1, index + 5))) {
            throw new Error(`${label} contains an invalid escape`);
          }
          index += 5;
        } else {
          if (!/["\\/bfnrt]/u.test(source[index])) throw new Error(`${label} contains an invalid escape`);
          index += 1;
        }
        continue;
      }
      if (character.charCodeAt(0) < 0x20) throw new Error(`${label} contains a control character`);
      index += 1;
    }
    throw new Error(`${label} contains an unterminated string`);
  };
  const value = () => {
    whitespace();
    const character = source[index];
    if (character === '{') {
      index += 1;
      whitespace();
      const keys = new Set();
      if (source[index] === '}') {
        index += 1;
        return;
      }
      while (index < source.length) {
        const key = stringToken();
        if (keys.has(key)) throw new Error(`${label} contains duplicate field ${key}`);
        keys.add(key);
        whitespace();
        if (source[index] !== ':') throw new Error(`${label} contains invalid JSON`);
        index += 1;
        value();
        whitespace();
        if (source[index] === '}') {
          index += 1;
          return;
        }
        if (source[index] !== ',') throw new Error(`${label} contains invalid JSON`);
        index += 1;
        whitespace();
      }
    } else if (character === '[') {
      index += 1;
      whitespace();
      if (source[index] === ']') {
        index += 1;
        return;
      }
      while (index < source.length) {
        value();
        whitespace();
        if (source[index] === ']') {
          index += 1;
          return;
        }
        if (source[index] !== ',') throw new Error(`${label} contains invalid JSON`);
        index += 1;
      }
    } else if (character === '"') {
      stringToken();
      return;
    } else {
      const remainder = source.slice(index);
      const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(remainder)?.[0];
      if (!token) throw new Error(`${label} contains invalid JSON`);
      index += token.length;
      return;
    }
    throw new Error(`${label} contains unterminated JSON`);
  };

  value();
  whitespace();
  if (index !== source.length) throw new Error(`${label} contains trailing data`);
  return JSON.parse(source);
}

export function createReleaseVerification(manifest, tag, manifestPath) {
  manifest = validateReleaseManifest(manifest, { tag });
  return {
    schema_version: 'redeven.redevplugin_release_verification.v1',
    release_tag: tag,
    manifest: descriptor(manifestPath, releaseManifestAssetName),
    platform_version: manifest.platform_version,
    plugin_api: manifest.plugin_api,
    internal_wire: manifest.internal_wire,
    artifacts: manifest.artifacts,
  };
}

export function validateReleaseVerification(value) {
  exactKeys(value, ['schema_version', 'release_tag', 'manifest', 'platform_version', 'plugin_api', 'internal_wire', 'artifacts'], 'release verification');
  if (value.schema_version !== 'redeven.redevplugin_release_verification.v1') fail('release verification schema is invalid');
  const manifest = validateReleaseManifest({
    platform_version: value.platform_version,
    plugin_api: value.plugin_api,
    internal_wire: value.internal_wire,
    artifacts: value.artifacts,
  }, { tag: value.release_tag });
  validateDescriptor(value.manifest, 'release manifest evidence', releaseManifestAssetName);
  return structuredClone({ ...value, ...manifest });
}

export function createRuntimeEvidence({
  profile,
  target,
  releaseVerification,
  runtimePath,
  sbomPath,
  provenancePath,
  noticesPath,
  signaturePath,
  certificatePath,
  product,
  cargoVersion,
  rustcVersion,
}) {
  if (!['release', 'development'].includes(profile)) fail('runtime evidence profile is invalid');
  targetIdentity(target);
  releaseVerification = validateReleaseVerification(releaseVerification);
  validateProductBuild(product, profile);
  if (typeof cargoVersion !== 'string' || !cargoVersion.startsWith(`cargo ${rustToolchain} `)) fail('cargo toolchain is invalid');
  if (typeof rustcVersion !== 'string' || !rustcVersion.startsWith(`rustc ${rustToolchain} `)) fail('rustc toolchain is invalid');
  const signatureKind = profile === 'release' ? 'sigstore-keyless' : 'local-ephemeral-ed25519';
  return {
    schema_version: 'redeven.redevplugin_runtime_build.v1',
    profile,
    platform_release: releaseVerification,
    product_build: structuredClone(product),
    runtime: {
      target,
      rust_toolchain: rustToolchain,
      cargo_version: cargoVersion,
      rustc_version: rustcVersion,
      binary: descriptor(runtimePath, 'redevplugin-runtime'),
      sbom: descriptor(sbomPath, runtimeSBOMName),
      provenance: descriptor(provenancePath, runtimeProvenanceName),
      notices: descriptor(noticesPath, runtimeNoticesName),
      signature: {
        kind: signatureKind,
        signature: descriptor(signaturePath, runtimeSignatureName),
        certificate: descriptor(certificatePath, runtimeCertificateName),
        certificate_identity: profile === 'release'
          ? `https://github.com/floegence/redeven/.github/workflows/release.yml@${product.ref}`
          : '',
        oidc_issuer: profile === 'release' ? 'https://token.actions.githubusercontent.com' : '',
      },
    },
  };
}

export function validateRuntimeEvidence(value, root, { target, requireRelease = false } = {}) {
  exactKeys(value, ['schema_version', 'profile', 'platform_release', 'product_build', 'runtime'], 'runtime evidence');
  if (value.schema_version !== 'redeven.redevplugin_runtime_build.v1') fail('runtime evidence schema is invalid');
  if (!['release', 'development'].includes(value.profile) || (requireRelease && value.profile !== 'release')) {
    fail('runtime evidence profile is not permitted');
  }
  validateReleaseVerification(value.platform_release);
  validateProductBuild(value.product_build, value.profile);
  exactKeys(value.runtime, [
    'target', 'rust_toolchain', 'cargo_version', 'rustc_version', 'binary', 'sbom',
    'provenance', 'notices', 'signature',
  ], 'runtime evidence payload');
  targetIdentity(value.runtime.target);
  if (target !== undefined && value.runtime.target !== target) fail('runtime evidence target mismatch');
  if (value.runtime.rust_toolchain !== rustToolchain
      || !value.runtime.cargo_version.startsWith(`cargo ${rustToolchain} `)
      || !value.runtime.rustc_version.startsWith(`rustc ${rustToolchain} `)) {
    fail('runtime evidence toolchain mismatch');
  }
  validateDescriptorFile(value.runtime.binary, root, 'runtime binary', 'redevplugin-runtime');
  validateDescriptorFile(value.runtime.sbom, root, 'runtime SBOM', runtimeSBOMName);
  validateDescriptorFile(value.runtime.provenance, root, 'runtime provenance', runtimeProvenanceName);
  validateDescriptorFile(value.runtime.notices, root, 'runtime notices', runtimeNoticesName);
  exactKeys(value.runtime.signature, [
    'kind', 'signature', 'certificate', 'certificate_identity', 'oidc_issuer',
  ], 'runtime signature evidence');
  const release = value.profile === 'release';
  if (value.runtime.signature.kind !== (release ? 'sigstore-keyless' : 'local-ephemeral-ed25519')) {
    fail('runtime signature kind mismatch');
  }
  validateDescriptorFile(value.runtime.signature.signature, root, 'runtime signature', runtimeSignatureName);
  validateDescriptorFile(value.runtime.signature.certificate, root, 'runtime certificate', runtimeCertificateName);
  const expectedIdentity = release
    ? `https://github.com/floegence/redeven/.github/workflows/release.yml@${value.product_build.ref}`
    : '';
  if (value.runtime.signature.certificate_identity !== expectedIdentity
      || value.runtime.signature.oidc_issuer !== (release ? 'https://token.actions.githubusercontent.com' : '')) {
    fail('runtime signature identity mismatch');
  }
  return structuredClone(value);
}

export function createRuntimeProvenance({ releaseVerification, product, target, runtimePath, metadata }) {
  releaseVerification = validateReleaseVerification(releaseVerification);
  targetIdentity(target);
  validateProductBuild(product, product.ref.startsWith('refs/tags/') ? 'release' : 'development');
  const registryPackages = validateCargoMetadata(metadata, releaseVerification)
    .map((entry) => ({
      name: entry.name,
      version: entry.version,
      source: entry.source ?? cratesIORegistrySource,
      license: entry.license ?? 'NOASSERTION',
    }))
    .sort(compareCoordinates);
  return {
    schema_version: 'redeven.redevplugin_runtime_provenance.v1',
    product_build: structuredClone(product),
    target,
    rust_toolchain: rustToolchain,
    upstream: {
      release_tag: releaseVerification.release_tag,
      platform_version: releaseVerification.platform_version,
      manifest: releaseVerification.manifest,
      artifacts: releaseVerification.artifacts,
    },
    resolved_registry_packages: registryPackages,
    runtime: descriptor(runtimePath, 'redevplugin-runtime'),
  };
}

export function createRuntimeSBOM(provenance) {
  exactKeys(provenance, [
    'schema_version', 'product_build', 'target', 'rust_toolchain', 'upstream',
    'resolved_registry_packages', 'runtime',
  ], 'runtime provenance');
  const namespaceDigest = createHash('sha256').update(JSON.stringify(provenance)).digest('hex');
  const packages = provenance.resolved_registry_packages.map((entry, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: entry.name,
    versionInfo: entry.version,
    downloadLocation: entry.source,
    filesAnalyzed: false,
    licenseConcluded: entry.license,
    licenseDeclared: entry.license,
    copyrightText: 'NOASSERTION',
  }));
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `Redeven ReDevPlugin runtime ${provenance.target}`,
    documentNamespace: `https://redeven.dev/spdx/redevplugin-runtime/${namespaceDigest}`,
    creationInfo: {
      creators: ['Organization: Floegence'],
      created: new Date(0).toISOString().replace('.000Z', 'Z'),
    },
    packages,
    files: [{
      SPDXID: 'SPDXRef-File-redevplugin-runtime',
      fileName: 'redevplugin-runtime',
      checksums: [{ algorithm: 'SHA256', checksumValue: provenance.runtime.sha256 }],
      licenseConcluded: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
    }],
    relationships: packages.map((entry) => ({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: entry.SPDXID,
    })),
  };
}

export function createRuntimeNotices(provenance) {
  const lines = [
    '# ReDevPlugin Runtime Third-Party Notices',
    '',
    `Redeven builds ReDevPlugin ${provenance.upstream.platform_version} from the exact published Rust source crate set.`,
    'The accompanying SPDX document is the machine-readable dependency inventory.',
    '',
    '| Package | Version | Declared license | Registry source |',
    '| --- | --- | --- | --- |',
  ];
  for (const entry of provenance.resolved_registry_packages) {
    lines.push(`| ${escapeCell(entry.name)} | ${escapeCell(entry.version)} | ${escapeCell(entry.license)} | ${escapeCell(entry.source)} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function verifyELF(pathname, target) {
  targetIdentity(target);
  const bytes = readFileSync(pathname);
  if (bytes.length < 64 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      || bytes[4] !== 2 || bytes[5] !== 1) {
    fail('runtime binary is not a 64-bit little-endian ELF executable');
  }
  if (bytes.readUInt16LE(16) !== 3) fail('runtime ELF is not position-independent');
  const machine = bytes.readUInt16LE(18);
  const expected = target === 'linux/amd64' ? 62 : 183;
  if (machine !== expected) fail(`runtime ELF machine ${machine} does not match ${target}`);

  const programOffset = Number(bytes.readBigUInt64LE(32));
  const programEntrySize = bytes.readUInt16LE(54);
  const programCount = bytes.readUInt16LE(56);
  if (!Number.isSafeInteger(programOffset)
      || (programCount > 0 && (programEntrySize < 56 || programOffset < 64
        || programOffset + programEntrySize * programCount > bytes.length))) {
    fail('runtime ELF program headers are invalid');
  }
  for (let index = 0; index < programCount; index += 1) {
    const header = programOffset + index * programEntrySize;
    const type = bytes.readUInt32LE(header);
    if (type === 3) fail('runtime ELF interpreter is forbidden');
    if (type !== 2) continue;

    const dynamicOffset = Number(bytes.readBigUInt64LE(header + 8));
    const dynamicSize = Number(bytes.readBigUInt64LE(header + 32));
    if (!Number.isSafeInteger(dynamicOffset) || !Number.isSafeInteger(dynamicSize)
        || dynamicSize % 16 !== 0 || dynamicOffset < 0 || dynamicOffset + dynamicSize > bytes.length) {
      fail('runtime ELF dynamic segment is invalid');
    }
    for (let offset = dynamicOffset; offset < dynamicOffset + dynamicSize; offset += 16) {
      const tag = bytes.readBigInt64LE(offset);
      if (tag === 0n) break;
      if (tag === 1n) fail('runtime ELF dynamic dependencies are forbidden');
    }
  }
}

export function descriptor(pathname, name = path.basename(pathname)) {
  const descriptorFD = openSync(pathname, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = fstatSync(descriptorFD);
    if (!info.isFile() || info.size < 1) fail(`artifact must be a non-empty regular file: ${pathname}`);
    return {
      path: name,
      sha256: createHash('sha256').update(readFileSync(descriptorFD)).digest('hex'),
      size: info.size,
    };
  } finally {
    closeSync(descriptorFD);
  }
}

export function projectRuntimeCargoMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || !Array.isArray(metadata.packages)
      || !metadata.resolve || typeof metadata.resolve !== 'object'
      || typeof metadata.resolve.root !== 'string' || !Array.isArray(metadata.resolve.nodes)
      || !Array.isArray(metadata.workspace_members)) {
    fail('Cargo metadata is invalid');
  }
  if (metadata.workspace_members.length !== 1 || metadata.workspace_members[0] !== metadata.resolve.root) {
    fail('Cargo metadata workspace root is invalid');
  }

  const packages = new Map();
  for (const entry of metadata.packages) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string'
        || typeof entry.name !== 'string' || typeof entry.version !== 'string'
        || packages.has(entry.id)) {
      fail('Cargo metadata package identity is invalid');
    }
    packages.set(entry.id, entry);
  }
  const nodes = new Map();
  for (const node of metadata.resolve.nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string'
        || !Array.isArray(node.deps) || nodes.has(node.id)) {
      fail('Cargo metadata dependency node is invalid');
    }
    nodes.set(node.id, node);
  }

  const reachable = new Set([metadata.resolve.root]);
  const pending = [metadata.resolve.root];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!packages.has(id) || !nodes.has(id)) fail('Cargo metadata production dependency is missing');
    for (const dependency of nodes.get(id).deps) {
      if (!dependency || typeof dependency.pkg !== 'string' || !Array.isArray(dependency.dep_kinds)
          || dependency.dep_kinds.some((kind) => !kind || typeof kind !== 'object'
            || (kind.kind !== null && kind.kind !== 'build' && kind.kind !== 'dev'))) {
        fail('Cargo metadata dependency kind is invalid');
      }
      const production = dependency.dep_kinds.some(({ kind }) => kind === null || kind === 'build');
      if (!production || reachable.has(dependency.pkg)) continue;
      reachable.add(dependency.pkg);
      pending.push(dependency.pkg);
    }
  }

  return {
    packages: metadata.packages
      .filter(({ id }) => reachable.has(id))
      .map(({ id, name, version, source, license }) => ({
        id,
        name,
        version,
        source: source ?? null,
        license: license ?? null,
      })),
    resolve: { root: metadata.resolve.root },
    workspace_members: [metadata.resolve.root],
  };
}

function validateCargoMetadata(metadata, releaseVerification) {
  if (!metadata || typeof metadata !== 'object' || !Array.isArray(metadata.packages)
      || !metadata.resolve || typeof metadata.resolve !== 'object'
      || typeof metadata.resolve.root !== 'string' || !Array.isArray(metadata.workspace_members)) {
    fail('Cargo metadata is invalid');
  }
  for (const entry of metadata.packages) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string'
        || typeof entry.name !== 'string' || typeof entry.version !== 'string') {
      fail('Cargo metadata package identity is invalid');
    }
  }
  const runtimeArtifact = releaseVerification.artifacts.find(({ name }) => name === 'crate:redevplugin-runtime');
  if (!runtimeArtifact) fail('release manifest is missing the runtime crate');
  const runtimeVersion = releaseVerification.platform_version;
  const runtimeMatches = metadata.packages.filter((entry) => entry.name === 'redevplugin-runtime'
    && entry.version === runtimeVersion);
  if (runtimeMatches.length !== 1 || metadata.resolve.root !== runtimeMatches[0].id
      || metadata.workspace_members.length !== 1 || metadata.workspace_members[0] !== runtimeMatches[0].id) {
    fail('Cargo metadata root is not the exact published runtime crate');
  }
  const firstParty = metadata.packages.filter(({ name }) => name.startsWith('redevplugin-'));
  const actualRuntimeRust = firstParty
    .map(({ name, version }) => `${name}@${version}`)
    .sort();
  const expectedRuntimeCoordinates = expectedRuntimeRust
    .map((name) => `${name}@${runtimeVersion}`)
    .sort();
  if (JSON.stringify(actualRuntimeRust) !== JSON.stringify(expectedRuntimeCoordinates)) {
    fail('Cargo metadata ReDevPlugin runtime crate set mismatch');
  }
  for (const entry of metadata.packages) {
    const isRuntimeRoot = entry.id === runtimeMatches[0].id;
    if (entry.source !== cratesIORegistrySource && !(isRuntimeRoot && entry.source === null)) {
      fail(`Cargo metadata package ${entry.name}@${entry.version} is not from crates.io`);
    }
  }
  return metadata.packages;
}

function validateProductBuild(value, profile) {
  exactKeys(value, ['repository', 'workflow_path', 'ref', 'source_commit'], 'product build identity');
  commit(value.source_commit, 'product source commit');
  if (value.repository !== 'floegence/redeven' || value.workflow_path !== '.github/workflows/release.yml') {
    fail('product build workflow is invalid');
  }
  if (profile === 'release') {
    if (!/^refs\/tags\/v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(value.ref)) {
      fail('release product ref is invalid');
    }
  } else if (!/^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/u.test(value.ref)) {
    fail('development product ref is invalid');
  }
}

function validateDescriptorFile(value, root, label, expectedName) {
  validateDescriptor(value, label, expectedName);
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, value.path);
  if (path.dirname(absolute) !== absoluteRoot) fail(`${label} path escapes its runtime directory`);
  const actual = descriptor(absolute, expectedName);
  if (JSON.stringify(actual) !== JSON.stringify(value)) fail(`${label} descriptor mismatch`);
}

function validateDescriptor(value, label, expectedName) {
  exactKeys(value, ['path', 'sha256', 'size'], label);
  if (value.path !== expectedName) fail(`${label} path is invalid`);
  digest(value.sha256, `${label} digest`);
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > 512 * 1024 * 1024) fail(`${label} size is invalid`);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} fields mismatch`);
  }
}

function semver(value, label) {
  if (typeof value !== 'string' || !semverPattern.test(value)) fail(`${label} is invalid`);
}

function commit(value, label) {
  if (typeof value !== 'string' || !commitPattern.test(value)) fail(`${label} is invalid`);
}

function digest(value, label) {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) fail(`${label} is invalid`);
}

function targetIdentity(value) {
  if (!['linux/amd64', 'linux/arm64'].includes(value)) fail(`unsupported ReDevPlugin runtime target: ${value}`);
}

function compareCoordinates(left, right) {
  return left.name.localeCompare(right.name) || left.version.localeCompare(right.version) || left.source.localeCompare(right.source);
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function fail(message) {
  throw new Error(message);
}

function readJSON(pathname, label, maximum) {
  return parseStrictJSON(readFileSync(pathname), label, maximum);
}

function writeJSON(pathname, value) {
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined || options[name] !== undefined) fail('invalid command options');
    options[name] = value;
  }
  return options;
}

function required(options, name) {
  if (!options[name]) fail(`missing ${name}`);
  return options[name];
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'verify-release-manifest' && rest.length === 2) {
    const [manifestPath, tag] = rest;
    const manifest = validateReleaseManifest(readJSON(manifestPath, 'platform release manifest'), { tag });
    process.stdout.write(`${manifest.platform_version}\n`);
    return;
  }
  if (command === 'project-runtime-cargo-metadata' && rest.length === 2) {
    const [input, output] = rest;
    const metadata = readJSON(input, 'raw Cargo metadata', 8 * 1024 * 1024);
    writeJSON(output, projectRuntimeCargoMetadata(metadata));
    return;
  }
  if (command === 'write-release-verification' && rest.length === 3) {
    const [manifestPath, tag, output] = rest;
    const manifest = readJSON(manifestPath, 'platform release manifest');
    writeJSON(output, createReleaseVerification(manifest, tag, manifestPath));
    return;
  }
  if (command === 'verify-elf' && rest.length === 2) {
    verifyELF(rest[0], rest[1]);
    return;
  }
  if (command === 'write-build-evidence') {
    const options = parseOptions(rest);
    const releaseVerification = readJSON(required(options, '--release-verification'), 'release verification');
    const metadata = readJSON(required(options, '--cargo-metadata'), 'Cargo metadata');
    const product = {
      repository: required(options, '--product-repository'),
      workflow_path: required(options, '--product-workflow'),
      ref: required(options, '--product-ref'),
      source_commit: required(options, '--product-commit'),
    };
    const provenance = createRuntimeProvenance({
      releaseVerification,
      product,
      target: required(options, '--target'),
      runtimePath: required(options, '--runtime'),
      metadata,
    });
    writeJSON(required(options, '--provenance-out'), provenance);
    writeJSON(required(options, '--sbom-out'), createRuntimeSBOM(provenance));
    writeFileSync(required(options, '--notices-out'), createRuntimeNotices(provenance), { flag: 'wx', mode: 0o644 });
    return;
  }
  if (command === 'write-runtime-marker') {
    const options = parseOptions(rest);
    const product = {
      repository: required(options, '--product-repository'),
      workflow_path: required(options, '--product-workflow'),
      ref: required(options, '--product-ref'),
      source_commit: required(options, '--product-commit'),
    };
    const marker = createRuntimeEvidence({
      profile: required(options, '--profile'),
      target: required(options, '--target'),
      releaseVerification: readJSON(required(options, '--release-verification'), 'release verification'),
      runtimePath: required(options, '--runtime'),
      sbomPath: required(options, '--sbom'),
      provenancePath: required(options, '--provenance'),
      noticesPath: required(options, '--notices'),
      signaturePath: required(options, '--signature'),
      certificatePath: required(options, '--certificate'),
      product,
      cargoVersion: required(options, '--cargo-version'),
      rustcVersion: required(options, '--rustc-version'),
    });
    writeJSON(required(options, '--out'), marker);
    return;
  }
  if (command === 'verify-runtime-directory') {
    const options = parseOptions(rest);
    const root = path.resolve(required(options, '--root'));
    const entries = readdirSync(root);
    for (const name of ['redevplugin-runtime', runtimeMarkerName, ...markerFileNames]) {
      if (!entries.includes(name)) fail(`runtime directory is missing ${name}`);
    }
    validateRuntimeEvidence(readJSON(path.join(root, runtimeMarkerName), 'runtime evidence'), root, {
      target: required(options, '--target'),
      requireRelease: options['--require-release'] === 'true',
    });
    verifyELF(path.join(root, 'redevplugin-runtime'), required(options, '--target'));
    return;
  }
  console.error('usage: redevplugin_release_contract.mjs <command> ...');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[redevplugin-release-contract] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
