#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const publicationAssetName = 'platform-package-publication-v1.json';
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
const expectedRust = Object.freeze([
  ['redevplugin-contracts', 'contracts'],
  ['redevplugin-ipc', 'ipc'],
  ['redevplugin-wasm-abi', 'wasm_abi'],
  ['redevplugin-target-classifier', 'target_classifier'],
  ['redevplugin-worker-sdk', 'worker_sdk'],
  ['redevplugin-runtime', 'runtime'],
]);
const expectedRuntimeRust = Object.freeze([
  'redevplugin-ipc',
  'redevplugin-runtime',
  'redevplugin-wasm-abi',
]);
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

export function validatePackageSet(value) {
  exactKeys(value, [
    'schema_version', 'platform_version', 'go_module', 'npm_packages', 'rust_crates',
    'contract_registry_version', 'contract_set_sha256',
  ], 'package set');
  if (value.schema_version !== 'redevplugin.platform_package_set.v1') fail('package set schema is invalid');
  semver(value.platform_version, 'package set platform version');
  digest(value.contract_set_sha256, 'package set contract digest');
  if (value.contract_registry_version !== 'contract-registry-v2') fail('package set registry version is invalid');
  exactKeys(value.go_module, ['module', 'version'], 'package set Go module');
  if (value.go_module.module !== 'github.com/floegence/redevplugin' || value.go_module.version !== `v${value.platform_version}`) {
    fail('package set Go coordinate is invalid');
  }
  if (!Array.isArray(value.npm_packages) || value.npm_packages.length !== expectedNPM.length) {
    fail('package set npm coordinates are incomplete');
  }
  value.npm_packages.forEach((coordinate, index) => {
    exactKeys(coordinate, ['name', 'version'], `package set npm coordinate ${index}`);
    if (coordinate.name !== expectedNPM[index] || coordinate.version !== value.platform_version) {
      fail(`package set npm coordinate ${index} is invalid`);
    }
  });
  if (!Array.isArray(value.rust_crates) || value.rust_crates.length !== expectedRust.length) {
    fail('package set Rust coordinates are incomplete');
  }
  value.rust_crates.forEach((coordinate, index) => {
    exactKeys(coordinate, ['name', 'version', 'role'], `package set Rust coordinate ${index}`);
    if (coordinate.name !== expectedRust[index][0] || coordinate.role !== expectedRust[index][1]
        || coordinate.version !== value.platform_version) {
      fail(`package set Rust coordinate ${index} is invalid`);
    }
  });
  return structuredClone(value);
}

export function validatePublication(value, packageSet, { tag, sourceCommit } = {}) {
  packageSet = validatePackageSet(packageSet);
  exactKeys(value, [
    'schema_version', 'platform_version', 'source_commit', 'workflow', 'go_module',
    'npm_packages', 'rust_crates', 'contract_set_sha256',
  ], 'platform publication');
  if (value.schema_version !== 'redevplugin.platform_package_publication.v1') fail('publication schema is invalid');
  if (value.platform_version !== packageSet.platform_version) fail('publication platform version mismatch');
  if (value.contract_set_sha256 !== packageSet.contract_set_sha256) fail('publication contract digest mismatch');
  commit(value.source_commit, 'publication source commit');
  if (sourceCommit !== undefined && value.source_commit !== sourceCommit) fail('publication source commit mismatch');
  const expectedTag = `v${packageSet.platform_version}`;
  if (tag !== undefined && tag !== expectedTag) fail('release tag does not match the package set');
  exactKeys(value.workflow, ['repository', 'path', 'ref', 'sha'], 'publication workflow');
  if (value.workflow.repository !== 'floegence/redevplugin'
      || value.workflow.path !== '.github/workflows/release.yml'
      || value.workflow.ref !== `refs/tags/${expectedTag}`
      || value.workflow.sha !== value.source_commit) {
    fail('publication workflow identity is invalid');
  }
  exactKeys(value.go_module, ['module', 'version', 'h1', 'go_mod_h1'], 'publication Go module');
  if (value.go_module.module !== packageSet.go_module.module || value.go_module.version !== packageSet.go_module.version
      || !h1Pattern.test(value.go_module.h1) || !h1Pattern.test(value.go_module.go_mod_h1)) {
    fail('publication Go readback is invalid');
  }
  if (!Array.isArray(value.npm_packages) || value.npm_packages.length !== packageSet.npm_packages.length) {
    fail('publication npm readbacks are incomplete');
  }
  value.npm_packages.forEach((readback, index) => {
    exactKeys(readback, ['name', 'version', 'integrity', 'provenance_subject_sha512'], `publication npm readback ${index}`);
    const coordinate = packageSet.npm_packages[index];
    if (readback.name !== coordinate.name || readback.version !== coordinate.version
        || !integrityPattern.test(readback.integrity) || !sha512Pattern.test(readback.provenance_subject_sha512)) {
      fail(`publication npm readback ${index} is invalid`);
    }
    const integrityHex = Buffer.from(readback.integrity.slice('sha512-'.length), 'base64').toString('hex');
    if (integrityHex !== readback.provenance_subject_sha512) fail(`publication npm readback ${index} digest mismatch`);
  });
  if (!Array.isArray(value.rust_crates) || value.rust_crates.length !== packageSet.rust_crates.length) {
    fail('publication Rust readbacks are incomplete');
  }
  value.rust_crates.forEach((readback, index) => {
    exactKeys(readback, ['name', 'version', 'registry_checksum_sha256'], `publication Rust readback ${index}`);
    const coordinate = packageSet.rust_crates[index];
    if (readback.name !== coordinate.name || readback.version !== coordinate.version) {
      fail(`publication Rust readback ${index} coordinate mismatch`);
    }
    digest(readback.registry_checksum_sha256, `publication Rust readback ${index} checksum`);
  });
  return structuredClone(value);
}

export function createPublicationVerification(publication, packageSet, tag, publicationPath) {
  publication = validatePublication(publication, packageSet, { tag });
  return {
    schema_version: 'redeven.redevplugin_platform_publication_verification.v1',
    release_tag: tag,
    publication: descriptor(publicationPath, publicationAssetName),
    platform_version: publication.platform_version,
    source_commit: publication.source_commit,
    contract_set_sha256: publication.contract_set_sha256,
    go_module: publication.go_module,
    npm_packages: publication.npm_packages,
    rust_crates: publication.rust_crates,
  };
}

export function validatePublicationVerification(value, packageSet) {
  exactKeys(value, [
    'schema_version', 'release_tag', 'publication', 'platform_version', 'source_commit',
    'contract_set_sha256', 'go_module', 'npm_packages', 'rust_crates',
  ], 'publication verification');
  if (value.schema_version !== 'redeven.redevplugin_platform_publication_verification.v1') {
    fail('publication verification schema is invalid');
  }
  const publication = {
    schema_version: 'redevplugin.platform_package_publication.v1',
    platform_version: value.platform_version,
    source_commit: value.source_commit,
    workflow: {
      repository: 'floegence/redevplugin',
      path: '.github/workflows/release.yml',
      ref: `refs/tags/${value.release_tag}`,
      sha: value.source_commit,
    },
    go_module: value.go_module,
    npm_packages: value.npm_packages,
    rust_crates: value.rust_crates,
    contract_set_sha256: value.contract_set_sha256,
  };
  validatePublication(publication, packageSet, { tag: value.release_tag });
  validateDescriptor(value.publication, 'publication verification asset', publicationAssetName);
  return structuredClone(value);
}

export function createRuntimeEvidence({
  profile,
  target,
  publicationVerification,
  packageSet,
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
  packageSet = validatePackageSet(packageSet);
  publicationVerification = validatePublicationVerification(publicationVerification, packageSet);
  validateProductBuild(product, profile);
  if (typeof cargoVersion !== 'string' || !cargoVersion.startsWith(`cargo ${rustToolchain} `)) fail('cargo toolchain is invalid');
  if (typeof rustcVersion !== 'string' || !rustcVersion.startsWith(`rustc ${rustToolchain} `)) fail('rustc toolchain is invalid');
  const signatureKind = profile === 'release' ? 'sigstore-keyless' : 'local-ephemeral-ed25519';
  return {
    schema_version: 'redeven.redevplugin_runtime_build.v1',
    profile,
    platform_publication: publicationVerification,
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
  exactKeys(value, ['schema_version', 'profile', 'platform_publication', 'product_build', 'runtime'], 'runtime evidence');
  if (value.schema_version !== 'redeven.redevplugin_runtime_build.v1') fail('runtime evidence schema is invalid');
  if (!['release', 'development'].includes(value.profile) || (requireRelease && value.profile !== 'release')) {
    fail('runtime evidence profile is not permitted');
  }
  const embeddedPackageSet = publicationVerificationPackageSet(value.platform_publication);
  validatePublicationVerification(value.platform_publication, embeddedPackageSet);
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

export function createRuntimeProvenance({ publicationVerification, packageSet, product, target, runtimePath, metadata }) {
  packageSet = validatePackageSet(packageSet);
  publicationVerification = validatePublicationVerification(publicationVerification, packageSet);
  targetIdentity(target);
  validateProductBuild(product, product.ref.startsWith('refs/tags/') ? 'release' : 'development');
  const registryPackages = validateCargoMetadata(metadata, packageSet)
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
      release_tag: publicationVerification.release_tag,
      platform_version: publicationVerification.platform_version,
      source_commit: publicationVerification.source_commit,
      publication: publicationVerification.publication,
      contract_set_sha256: publicationVerification.contract_set_sha256,
      rust_crates: publicationVerification.rust_crates,
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
  const info = lstatSync(pathname);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1) fail(`artifact must be a non-empty regular file: ${pathname}`);
  return {
    path: name,
    sha256: createHash('sha256').update(readFileSync(pathname)).digest('hex'),
    size: info.size,
  };
}

function publicationVerificationPackageSet(value) {
  return validatePackageSet({
    schema_version: 'redevplugin.platform_package_set.v1',
    platform_version: value.platform_version,
    go_module: { module: value.go_module.module, version: value.go_module.version },
    npm_packages: value.npm_packages.map(({ name, version }) => ({ name, version })),
    rust_crates: value.rust_crates.map(({ name, version }, index) => ({ name, version, role: expectedRust[index][1] })),
    contract_registry_version: 'contract-registry-v2',
    contract_set_sha256: value.contract_set_sha256,
  });
}

function validateCargoMetadata(metadata, packageSet) {
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
  const runtimeCoordinate = packageSet.rust_crates.find(({ role }) => role === 'runtime');
  const runtimeMatches = metadata.packages.filter((entry) => entry.name === runtimeCoordinate.name
    && entry.version === runtimeCoordinate.version);
  if (runtimeMatches.length !== 1 || metadata.resolve.root !== runtimeMatches[0].id
      || metadata.workspace_members.length !== 1 || metadata.workspace_members[0] !== runtimeMatches[0].id) {
    fail('Cargo metadata root is not the exact published runtime crate');
  }
  const packageCoordinates = new Map(packageSet.rust_crates.map((coordinate) => [coordinate.name, coordinate]));
  const firstParty = metadata.packages.filter(({ name }) => name.startsWith('redevplugin-'));
  const actualRuntimeRust = firstParty
    .map(({ name, version }) => `${name}@${version}`)
    .sort();
  const expectedRuntimeCoordinates = expectedRuntimeRust
    .map((name) => {
      const coordinate = packageCoordinates.get(name);
      if (!coordinate) fail(`package set is missing runtime dependency ${name}`);
      return `${coordinate.name}@${coordinate.version}`;
    })
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

function readJSON(pathname, label) {
  return parseStrictJSON(readFileSync(pathname), label);
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
  if (command === 'verify-publication' && rest.length === 3) {
    const [publicationPath, packageSetPath, tag] = rest;
    const publication = validatePublication(readJSON(publicationPath, 'platform publication'), readJSON(packageSetPath, 'package set'), { tag });
    process.stdout.write(`${publication.source_commit}\n`);
    return;
  }
  if (command === 'write-publication-verification' && rest.length === 4) {
    const [publicationPath, packageSetPath, tag, output] = rest;
    const packageSet = readJSON(packageSetPath, 'package set');
    const publication = readJSON(publicationPath, 'platform publication');
    writeJSON(output, createPublicationVerification(publication, packageSet, tag, publicationPath));
    return;
  }
  if (command === 'verify-elf' && rest.length === 2) {
    verifyELF(rest[0], rest[1]);
    return;
  }
  if (command === 'write-build-evidence') {
    const options = parseOptions(rest);
    const packageSet = readJSON(required(options, '--package-set'), 'package set');
    const publication = readJSON(required(options, '--publication-verification'), 'publication verification');
    const metadata = readJSON(required(options, '--cargo-metadata'), 'Cargo metadata');
    const product = {
      repository: required(options, '--product-repository'),
      workflow_path: required(options, '--product-workflow'),
      ref: required(options, '--product-ref'),
      source_commit: required(options, '--product-commit'),
    };
    const provenance = createRuntimeProvenance({
      publicationVerification: publication,
      packageSet,
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
      publicationVerification: readJSON(required(options, '--publication-verification'), 'publication verification'),
      packageSet: readJSON(required(options, '--package-set'), 'package set'),
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
