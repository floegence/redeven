import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const packagePath = 'node_modules/@floegence/floebrowser';
export const mediaManifestPath = packagePath + '/dist/bin/manifest.json';
export const mediaUpstreamPath = packagePath + '/dist/bin/manifest.upstream.json';

// codesign removes the signature and its load command, but retains the old
// __LINKEDIT virtual allocation. Normalize that allocation for byte comparison;
// every other remaining byte must match the verified published executable.
export function normalizeUnsignedMachO(bytes) {
  const result = Buffer.from(bytes);
  if (result.length < 32 || result.readUInt32LE(0) !== 0xfeedfacf) throw new Error('Media signing requires a thin 64-bit Mach-O');
  const count = result.readUInt32LE(16);
  const end = 32 + result.readUInt32LE(20);
  let offset = 32, linkedit = 0;
  if (end > result.length) throw new Error('Invalid media Mach-O load commands');
  for (let i = 0; i < count; i++) {
    if (offset + 8 > end) throw new Error('Invalid media Mach-O load commands');
    const command = result.readUInt32LE(offset), size = result.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > end) throw new Error('Invalid media Mach-O load commands');
    if (command === 0x1d) throw new Error('Media code signature was not removed');
    if (command === 0x19 && size >= 72 && result.subarray(offset + 8, offset + 24).toString().replaceAll('\0', '') === '__LINKEDIT') {
      result.writeBigUInt64LE(0n, offset + 32);
      linkedit++;
    }
    offset += size;
  }
  if (offset !== end || linkedit !== 1) throw new Error('Invalid media Mach-O segments');
  return result;
}

function unsignedDigest(file) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-media-signing-'));
  try {
    const copy = path.join(root, 'media');
    fs.copyFileSync(file, copy);
    execFileSync('/usr/bin/codesign', ['--remove-signature', copy], { stdio: 'pipe' });
    return digest(normalizeUnsignedMachO(fs.readFileSync(copy)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function regularBytes(file) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error('Media signing requires regular files');
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

export function captureMediaSigningState(computer) {
  const manifestBytes = regularBytes(path.join(computer, mediaManifestPath));
  if (!manifestBytes.equals(regularBytes(path.join(computer, mediaUpstreamPath)))) throw new Error('Media upstream evidence changed before signing');
  const manifest = JSON.parse(manifestBytes);
  const metadata = JSON.parse(regularBytes(path.join(computer, packagePath, 'package.json')));
  const relative = process.platform + '-' + process.arch + '/floebrowser-media';
  const matches = manifest.artifacts.filter(item => item.platform === process.platform && item.arch === process.arch);
  if (process.platform !== 'darwin' || manifest.version !== metadata.version || manifest.mediaWireVersion !== 1 || matches.length !== 1 || matches[0].path !== relative) throw new Error('Invalid media signing target');
  const file = path.join(computer, packagePath, 'dist/bin', relative);
  const bytes = regularBytes(file), artifact = matches[0];
  if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256) throw new Error('Media source failed upstream integrity verification');
  return { computer, file, manifestBytes, unsignedSHA256: unsignedDigest(file) };
}

export function deriveSignedMediaManifest(state, signedPaths) {
  for (const relative of [mediaManifestPath, mediaUpstreamPath]) {
    if (!regularBytes(path.join(state.computer, relative)).equals(state.manifestBytes)) throw new Error('Media manifest changed during signing');
  }
  if (!signedPaths.has(path.resolve(state.file))) throw new Error('Media helper was not visited by the signer');
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', state.file], { stdio: 'pipe' });
  if (unsignedDigest(state.file) !== state.unsignedSHA256) throw new Error('Signing changed media executable content');
  const bytes = regularBytes(state.file);
  const manifest = JSON.parse(state.manifestBytes);
  const artifact = manifest.artifacts.find(item => item.platform === process.platform && item.arch === process.arch);
  artifact.bytes = bytes.length;
  artifact.sha256 = digest(bytes);
  return Buffer.from(JSON.stringify(manifest) + '\n');
}
