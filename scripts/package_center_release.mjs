#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const centerTargets = Object.freeze(['linux/amd64', 'linux/arm64']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
export function centerAssetNames(target) {
  if (!centerTargets.includes(target)) fail('Unsupported Center release target');
  const archive = 'redeven-center_' + target.replace('/', '_') + '.tar.gz';
  return [archive, archive + '.manifest.json'];
}
export function validateCenterReceipt(receipt, descriptor, tag, target) {
  if (receipt.schema_version !== 'redeven.center.release.v1' || receipt.version !== tag || receipt.target !== target ||
      !/^[a-f0-9]{40}$/.test(receipt.source_commit) || JSON.stringify(receipt.package) !== JSON.stringify(descriptor)) {
    fail('Center release receipt identity or archive digest mismatch');
  }
  return receipt.source_commit;
}
export function verifyCenterPackage(directory, tag, target, commit) {
  if (!/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/.test(tag)) fail('Invalid Center release tag');
  centerAssetNames(target);
  if (!/^[a-f0-9]{40}$/.test(commit)) fail('Invalid Center source commit');
  const files = [];
  function walk(relative = '') {
    const full = path.join(directory, relative);
    const info = lstatSync(full);
    if (info.isSymbolicLink()) fail('Center packages cannot contain symbolic links');
    if (info.isDirectory()) for (const name of readdirSync(full).sort()) walk(path.join(relative, name));
    else if (info.isFile()) files.push(relative);
    else fail('Center packages contain only regular files and directories');
  }
  walk();
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schema_version !== 'redeven.center.package.v1' || manifest.version !== tag || manifest.base_commit !== commit || manifest.dirty !== false ||
      manifest.target.GOOS + '/' + manifest.target.GOARCH !== target || !/^[a-f0-9]{64}$/.test(manifest.source_sha256)) fail('Center package source, version, target or clean-tree identity mismatch');
  const required = ['redeven-center', 'ui/index.html', 'redeven-center.service', 'redeven-center-connector.service', 'center.env.example', 'Dockerfile', 'compose.yaml', '.env', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'DEPLOYMENT.md'];
  for (const name of required) if (!files.includes(name)) fail('Center package is missing ' + name);
  if (!(lstatSync(path.join(directory, 'redeven-center')).mode & 0o111)) fail('Center binary must be executable');
  const expected = files.filter(file => file !== 'manifest.json').sort();
  if (!Array.isArray(manifest.artifacts) || JSON.stringify(manifest.artifacts.map(item => item.path).sort()) !== JSON.stringify(expected)) fail('Center package file inventory mismatch');
  for (const item of manifest.artifacts) if (hash(readFileSync(path.join(directory, item.path))) !== item.sha256) fail('Center package file digest mismatch: ' + item.path);
  if (readFileSync(path.join(directory, '.env'), 'utf8') !== 'CENTER_VERSION=' + tag + '\n') fail('Center Compose version mismatch');
  const binary = readFileSync(path.join(directory, 'redeven-center'));
  if (binary.length < 64 || !binary.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || binary[4] !== 2 || binary[5] !== 1 || binary.readUInt16LE(18) !== (target === 'linux/amd64' ? 62 : 183)) fail('Center binary architecture mismatch');
  return manifest;
}
export function packageCenter(directory, destination, tag, target, commit) {
  directory = path.resolve(directory);
  verifyCenterPackage(directory, tag, target, commit);
  const [archive, receipt] = centerAssetNames(target);
  mkdirSync(destination, { recursive: true });
  for (const name of [archive, receipt]) if (existsSync(path.join(destination, name))) fail('Center release output already exists');
  const output = path.resolve(destination, archive);
  execFileSync('tar', ['-czf', output, '-C', directory, '.']);
  const bytes = readFileSync(output);
  writeFileSync(path.join(destination, receipt), JSON.stringify({ schema_version: 'redeven.center.release.v1', version: tag, source_commit: commit, target, package: { name: archive, sha256: hash(bytes), size: bytes.length } }, null, 2) + '\n', { flag: 'wx' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [directory, destination, tag, target, commit, ...extra] = process.argv.slice(2);
    if (!commit || extra.length) fail('Usage: package_center_release.mjs <package> <output> <tag> <linux/arch> <source-commit>');
    packageCenter(directory, destination, tag, target, commit);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
