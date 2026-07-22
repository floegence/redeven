#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const targetDefinitions = Object.freeze([
  Object.freeze({ goos: 'linux', goarch: 'amd64', desktopOS: 'linux', desktopArch: 'x64', extensions: ['deb', 'rpm'] }),
  Object.freeze({ goos: 'linux', goarch: 'arm64', desktopOS: 'linux', desktopArch: 'arm64', extensions: ['deb', 'rpm'] }),
  Object.freeze({ goos: 'darwin', goarch: 'amd64', desktopOS: 'mac', desktopArch: 'x64', extensions: ['dmg'] }),
  Object.freeze({ goos: 'darwin', goarch: 'arm64', desktopOS: 'mac', desktopArch: 'arm64', extensions: ['dmg'] }),
]);
const markerName = '.redevplugin-release-artifacts-verified.json';
const packageSharedFiles = Object.freeze([
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'okf_bundle.manifest.json',
  'okf_bundle.sha256',
]);
const copyBufferBytes = 1024 * 1024;
const receiptByteLimit = 1024 * 1024;
const noFollow = fsConstants.O_NOFOLLOW;

function parseArgs(argv) {
  const values = { downloadsDir: '', destDir: '', tag: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value) fail(`${argument} requires a value`);
    if (argument === '--downloads-dir') values.downloadsDir = value;
    else if (argument === '--dest-dir') values.destDir = value;
    else if (argument === '--tag') values.tag = value;
    else fail(`unexpected argument: ${argument}`);
    index += 1;
  }
  if (!values.downloadsDir || !values.destDir || !/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u.test(values.tag)) {
    fail('usage: collect_release_artifacts.mjs --downloads-dir <dir> --dest-dir <dir> --tag <canonical-tag>');
  }
  return values;
}

function requireClosedDirectory(directory, expectedNames, label) {
  requireDirectory(directory, label);
  const actual = readdirSync(directory).sort(compareStrings);
  const expected = [...expectedNames].sort(compareStrings);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} inventory mismatch; got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
  }
  for (const name of actual) requireRegularFile(path.join(directory, name), `${label}/${name}`);
}

function validateReceipt(receiptSource, receiptStagedPath, expectedPackage, target) {
  const receipt = readJSON(receiptStagedPath, receiptSource);
  assertExactKeys(receipt, ['schema_version', 'package', 'runtime_target', 'redevplugin_runtime', 'redevplugin_evidence'], receiptSource);
  if (receipt.schema_version !== 'redeven.desktop_redevplugin_package_verification.v2') fail(`${receiptSource}: schema_version mismatch`);
  assertExactKeys(receipt.package, ['name', 'sha256', 'size'], `${receiptSource}: package`);
  if (JSON.stringify(receipt.package) !== JSON.stringify(expectedPackage)) fail(`${receiptSource}: installer descriptor mismatch`);
  if (receipt.runtime_target !== `${target.goos}/${target.goarch}`) fail(`${receiptSource}: runtime_target mismatch`);
  if (target.goos === 'darwin') {
    if (receipt.redevplugin_runtime !== null || receipt.redevplugin_evidence !== null) {
      fail(`${receiptSource}: Darwin receipt must omit ReDevPlugin runtime evidence`);
    }
    return { runtime: null, evidence: null };
  }
  validateDigestDescriptor(receipt.redevplugin_runtime, `${receiptSource}: redevplugin_runtime`);
  assertExactKeys(receipt.redevplugin_evidence, ['marker', 'notices', 'sbom', 'provenance', 'signature', 'certificate'], `${receiptSource}: redevplugin_evidence`);
  for (const [name, descriptor] of Object.entries(receipt.redevplugin_evidence)) {
    validateDigestDescriptor(descriptor, `${receiptSource}: redevplugin_evidence.${name}`);
  }
  return { runtime: receipt.redevplugin_runtime, evidence: receipt.redevplugin_evidence };
}

function collect(downloadsDir, destDir, tag, testHooks = undefined) {
  downloadsDir = path.resolve(downloadsDir);
  destDir = path.resolve(destDir);
  requireDirectory(downloadsDir, 'download directory');
  mkdirSync(destDir, { recursive: true, mode: 0o755 });
  requireDirectory(destDir, 'release collection destination');
  if (!Number.isInteger(noFollow) || noFollow === 0) fail('O_NOFOLLOW is required for release collection');
  const expectedArtifactDirectories = targetDefinitions.flatMap((target) => [
    `package-${target.goos}-${target.goarch}`,
    `desktop-${target.goos}-${target.goarch}`,
  ]).sort(compareStrings);
  const actualArtifactDirectories = readdirSync(downloadsDir).sort(compareStrings);
  if (JSON.stringify(actualArtifactDirectories) !== JSON.stringify(expectedArtifactDirectories)) {
    fail(`downloaded artifact directory inventory mismatch; got=${JSON.stringify(actualArtifactDirectories)} want=${JSON.stringify(expectedArtifactDirectories)}`);
  }

  const version = tag.slice(1);
  const canonicalSharedFiles = new Map();
  const targetReceiptProfiles = new Map();
  const outputs = new Map();
  const sourceInventories = [];
  const stagingDirectory = mkdtempSync(path.join(destDir, '.release-collector-stage-'));
  chmodSync(stagingDirectory, 0o700);
  let stagedSequence = 0;
  const stage = (source) => stageSource(source, stagingDirectory, stagedSequence += 1, testHooks);
  try {
    for (const target of targetDefinitions) {
      const packageDirectory = path.join(downloadsDir, `package-${target.goos}-${target.goarch}`);
      const packageLabel = `package-${target.goos}-${target.goarch}`;
      const redevenTarball = `redeven_${target.goos}_${target.goarch}.tar.gz`;
      const gatewayTarball = `redeven-gateway_${target.goos}_${target.goarch}.tar.gz`;
      const packageNames = [...packageSharedFiles, redevenTarball, gatewayTarball];
      requireClosedDirectory(packageDirectory, packageNames, packageLabel);
      sourceInventories.push([packageDirectory, packageNames, packageLabel]);

      for (const name of packageSharedFiles) {
        const shared = stage(path.join(packageDirectory, name));
        if (!canonicalSharedFiles.has(name)) {
          canonicalSharedFiles.set(name, shared);
          addOutput(outputs, name, shared);
        } else {
          assertStagedBytesEqual(canonicalSharedFiles.get(name), shared, `target package ${name} files are not byte-identical`);
          unlinkSync(shared.stagedPath);
        }
      }
      addOutput(outputs, redevenTarball, stage(path.join(packageDirectory, redevenTarball)));
      addOutput(outputs, gatewayTarball, stage(path.join(packageDirectory, gatewayTarball)));

      const desktopDirectory = path.join(downloadsDir, `desktop-${target.goos}-${target.goarch}`);
      const desktopLabel = `desktop-${target.goos}-${target.goarch}`;
      const installerNames = target.extensions.map((extension) => `Redeven-Desktop-${version}-${target.desktopOS}-${target.desktopArch}.${extension}`);
      const receiptNames = installerNames.map((name) => `${name}.redevplugin-verification.json`);
      const desktopNames = [...installerNames, ...receiptNames];
      requireClosedDirectory(desktopDirectory, desktopNames, desktopLabel);
      sourceInventories.push([desktopDirectory, desktopNames, desktopLabel]);
      for (const installerName of installerNames) {
        const installer = stage(path.join(desktopDirectory, installerName));
        const receiptName = `${installerName}.redevplugin-verification.json`;
        const receiptSource = path.join(desktopDirectory, receiptName);
        const receipt = stage(receiptSource);
        const profile = validateReceipt(receiptSource, receipt.stagedPath, installer.descriptor, target);
        const targetName = `${target.goos}/${target.goarch}`;
        if (!targetReceiptProfiles.has(targetName)) {
          targetReceiptProfiles.set(targetName, profile);
        } else if (JSON.stringify(targetReceiptProfiles.get(targetName)) !== JSON.stringify(profile)) {
          fail(`${receiptSource}: target installers do not contain byte-identical ReDevPlugin evidence`);
        }
        addOutput(outputs, installerName, installer);
        addOutput(outputs, receiptName, receipt);
      }
    }

    for (const [directory, names, label] of sourceInventories) requireClosedDirectory(directory, names, label);
    const expectedOutputNames = expectedReleaseOutputNames(version);
    if (outputs.size !== expectedOutputNames.length || expectedOutputNames.some((name) => !outputs.has(name))) {
      fail('internal release collection output inventory mismatch');
    }
    requireManagedOutputInventory(destDir, [], 'before publication');
    publishStagedOutputs(destDir, outputs, expectedOutputNames);
    console.log(`[INFO] closed Redeven release artifact inventory collected in ${destDir}`);
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

function stageSource(source, stagingDirectory, sequence, testHooks) {
  const stagedPath = path.join(stagingDirectory, `.source-${String(sequence).padStart(4, '0')}`);
  let sourceFD = -1;
  let stagedFD = -1;
  try {
    sourceFD = openSync(source, fsConstants.O_RDONLY | noFollow);
    const before = fstatSync(sourceFD, { bigint: true });
    if (!before.isFile()) fail(`release source must be a regular file: ${source}`);
    testHooks?.afterSourceOpen?.(source);
    stagedFD = openSync(stagedPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(copyBufferBytes);
    let size = 0;
    while (true) {
      const count = readSync(sourceFD, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      size += count;
      if (!Number.isSafeInteger(size)) fail(`release source exceeds the safe integer byte limit: ${source}`);
      let written = 0;
      while (written < count) {
        const writeCount = writeSync(stagedFD, buffer, written, count - written, null);
        if (writeCount <= 0) fail(`release source copy made no progress: ${source}`);
        written += writeCount;
      }
    }
    fchmodSync(stagedFD, 0o644);
    fsyncSync(stagedFD);
    const after = fstatSync(sourceFD, { bigint: true });
    const pathAfter = lstatSync(source, { bigint: true });
    if (!sameFileSnapshot(before, after) || !sameFileSnapshot(before, pathAfter) ||
        pathAfter.isSymbolicLink() || !pathAfter.isFile() || BigInt(size) !== before.size) {
      fail(`release source changed while being staged: ${source}`);
    }
    closeSync(stagedFD);
    stagedFD = -1;
    closeSync(sourceFD);
    sourceFD = -1;
    return {
      source,
      stagedPath,
      descriptor: {
        name: path.basename(source),
        sha256: hash.digest('hex'),
        size,
      },
    };
  } catch (error) {
    if (stagedFD >= 0) closeSync(stagedFD);
    if (sourceFD >= 0) closeSync(sourceFD);
    rmSync(stagedPath, { force: true });
    if (error && (error.code === 'ELOOP' || error.code === 'EMLINK')) fail(`release source must not be a symbolic link: ${source}`);
    throw error;
  }
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink &&
    left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function addOutput(outputs, name, staged) {
  if (outputs.has(name)) fail(`duplicate release collection output: ${name}`);
  outputs.set(name, staged);
}

function assertStagedBytesEqual(left, right, message) {
  if (left.descriptor.size !== right.descriptor.size || left.descriptor.sha256 !== right.descriptor.sha256 || !filesEqual(left.stagedPath, right.stagedPath)) {
    fail(message);
  }
}

function filesEqual(leftPath, rightPath) {
  const leftFD = openSync(leftPath, fsConstants.O_RDONLY | noFollow);
  const rightFD = openSync(rightPath, fsConstants.O_RDONLY | noFollow);
  const leftBuffer = Buffer.allocUnsafe(copyBufferBytes);
  const rightBuffer = Buffer.allocUnsafe(copyBufferBytes);
  try {
    while (true) {
      const leftCount = readSync(leftFD, leftBuffer, 0, leftBuffer.length, null);
      const rightCount = readSync(rightFD, rightBuffer, 0, rightBuffer.length, null);
      if (leftCount !== rightCount) return false;
      if (leftCount === 0) return true;
      if (!leftBuffer.subarray(0, leftCount).equals(rightBuffer.subarray(0, rightCount))) return false;
    }
  } finally {
    closeSync(leftFD);
    closeSync(rightFD);
  }
}

function publishStagedOutputs(destDir, outputs, expectedOutputNames) {
  const published = [];
  try {
    for (const name of [...outputs.keys()].sort(compareStrings)) {
      const output = path.join(destDir, name);
      linkSync(outputs.get(name).stagedPath, output);
      published.push(output);
    }
    fsyncDirectory(destDir);
    for (const [name, staged] of outputs) {
      const actual = descriptorFromFile(path.join(destDir, name));
      if (JSON.stringify(actual) !== JSON.stringify(staged.descriptor)) fail(`published release output changed: ${name}`);
    }
    requireManagedOutputInventory(destDir, expectedOutputNames, 'after publication');
    fsyncDirectory(destDir);
  } catch (error) {
    for (const output of published.reverse()) rmSync(output, { force: true });
    fsyncDirectory(destDir);
    if (error && error.code === 'EEXIST') fail(`release collection output already exists: ${error.dest ?? error.path ?? 'unknown output'}`);
    throw error;
  }
}

function descriptorFromFile(file) {
  let descriptor = -1;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | noFollow);
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isFile()) fail(`published release output must be a regular file: ${file}`);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(copyBufferBytes);
    let size = 0;
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      size += count;
    }
    if (!Number.isSafeInteger(size) || BigInt(size) !== stat.size) fail(`published release output size changed: ${file}`);
    return { name: path.basename(file), sha256: hash.digest('hex'), size };
  } finally {
    if (descriptor >= 0) closeSync(descriptor);
  }
}

function fsyncDirectory(directory) {
  let descriptor = -1;
  try {
    descriptor = openSync(directory, fsConstants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error) {
    if (!error || !['EINVAL', 'ENOTSUP', 'EPERM'].includes(error.code)) throw error;
  } finally {
    if (descriptor >= 0) closeSync(descriptor);
  }
}

function expectedReleaseOutputNames(version) {
  return [
    ...packageSharedFiles,
    ...targetDefinitions.flatMap((target) => [
      `redeven_${target.goos}_${target.goarch}.tar.gz`,
      `redeven-gateway_${target.goos}_${target.goarch}.tar.gz`,
      ...target.extensions.flatMap((extension) => {
        const installer = `Redeven-Desktop-${version}-${target.desktopOS}-${target.desktopArch}.${extension}`;
        return [installer, `${installer}.redevplugin-verification.json`];
      }),
    ]),
  ].sort(compareStrings);
}

function requireManagedOutputInventory(directory, expectedNames, phase) {
  const actual = readdirSync(directory).filter(isManagedReleaseOutput).sort(compareStrings);
  const expected = [...expectedNames].sort(compareStrings);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`release collection output inventory mismatch ${phase}; got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
  }
  for (const name of actual) requireRegularFile(path.join(directory, name), `release output/${name}`);
}

function isManagedReleaseOutput(name) {
  return name === markerName || packageSharedFiles.includes(name) || /^redeven_(?:darwin|linux)_(?:amd64|arm64)\.tar\.gz$/u.test(name) ||
    /^redeven-gateway_(?:darwin|linux)_(?:amd64|arm64)\.tar\.gz$/u.test(name) ||
    /^Redeven-Desktop-.+\.(?:deb|rpm|dmg)(?:\.redevplugin-verification\.json)?$/u.test(name);
}

function readJSON(file, label = file) {
  try {
    const size = lstatSync(file).size;
    if (size > receiptByteLimit) fail(`${label}: JSON exceeds ${receiptByteLimit} bytes`);
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort(compareStrings);
  const expected = [...expectedKeys].sort(compareStrings);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} fields mismatch`);
}

function validateDigestDescriptor(value, label) {
  assertExactKeys(value, ['sha256', 'size'], label);
  if (!/^[0-9a-f]{64}$/u.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 512 * 1024 * 1024) {
    fail(`${label} is invalid`);
  }
}

function requireDirectory(directory, label) {
  if (!existsSync(directory)) fail(`${label} must be a real directory: ${directory}`);
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} must be a real directory: ${directory}`);
}

function requireRegularFile(file, label) {
  if (!existsSync(file)) fail(`${label} must be a regular file`);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label} must be a regular file`);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
  throw new Error(message);
}

export { collect };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    collect(args.downloadsDir, args.destDir, args.tag);
  } catch (error) {
    console.error(`[release-collector] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
