import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveNodeArchive } from './resolve_node_archive.mjs';

function fixture(t, scenario = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'redeven-node-archive-test-'));
  const stateFile = path.join(root, 'scenario.json');
  const archiveName = 'node-v26.7.0-darwin-arm64.tar.gz';
  const bytes = 'official Node archive fixture';
  const digest = createHash('sha256').update(bytes).digest('hex');
  const state = { bytes, archiveName, digest, requests: [], ...scenario };
  writeFileSync(stateFile, JSON.stringify(state));
  const curl = path.join(root, 'curl');
  writeFileSync(curl, String.raw`#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const stateFile = ${JSON.stringify(stateFile)};
const state = JSON.parse(readFileSync(stateFile));
const isArchive = args.at(-1).endsWith('.tar.gz');
state.requests.push({ isArchive, args });
writeFileSync(stateFile, JSON.stringify(state));
if (!isArchive) {
  if (state.checksumFailure) process.exit(22);
  process.stdout.write(state.missingChecksum ? '' : state.digest + '  ' + state.archiveName + '\n');
} else {
  const output = args[args.indexOf('--output') + 1];
  const maxTime = args.includes('--max-time') ? Number(args[args.indexOf('--max-time') + 1]) : Infinity;
  if (state.archiveFailure) process.exit(state.archiveFailure);
  if (state.transferSeconds > maxTime || state.interrupted || state.resetsRemaining > 0) {
    writeFileSync(output, state.bytes.slice(0, 10));
    state.resetsRemaining = Math.max(0, (state.resetsRemaining ?? 0) - 1);
    writeFileSync(stateFile, JSON.stringify(state));
    process.exit(state.interrupted ? 28 : 56);
  }
  if (existsSync(output) && state.requireResume) {
    if (args[args.indexOf('--continue-at') + 1] !== '-' || readFileSync(output, 'utf8') !== state.bytes.slice(0, 10)) process.exit(33);
  }
  writeFileSync(output, state.corrupt ? 'corrupt archive' : state.bytes);
}
`);
  chmodSync(curl, 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = root + path.delimiter + priorPath;
  t.after(() => {
    process.env.PATH = priorPath;
    rmSync(root, { recursive: true, force: true });
  });
  const options = { version: '26.7.0', platform: 'darwin', arch: 'arm64', cacheRoot: path.join(root, 'cache'), archivePath: '' };
  return {
    root, bytes, digest, options,
    state: () => JSON.parse(readFileSync(stateFile)),
    update: patch => writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(readFileSync(stateFile)), ...patch })),
    cachedFiles: () => existsSync(options.cacheRoot) ? readdirSync(options.cacheRoot, { recursive: true }) : [],
  };
}

test('a progressing four-minute Node download completes and is verified', t => {
  const f = fixture(t, { transferSeconds: 240 });
  assert.equal(readFileSync(resolveNodeArchive(f.options), 'utf8'), f.bytes);
  const { args } = f.state().requests.find(request => request.isArchive);
  assert.equal(args[args.indexOf('--connect-timeout') + 1], '30');
  assert.equal(args[args.indexOf('--speed-limit') + 1], '1024');
  assert.equal(args[args.indexOf('--speed-time') + 1], '60');
});

test('successive builds reuse the verified archive without downloading it again', t => {
  const f = fixture(t);
  const archive = resolveNodeArchive(f.options);
  assert.equal(resolveNodeArchive(f.options), archive);
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 1);
  assert.equal(f.state().requests.filter(request => !request.isArchive).length, 2);
});

test('a corrupted cache entry is replaced only by a newly verified archive', t => {
  const f = fixture(t);
  const archive = resolveNodeArchive(f.options);
  writeFileSync(archive, 'corrupted cached bytes');
  assert.equal(readFileSync(resolveNodeArchive(f.options), 'utf8'), f.bytes);
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 2);
});

test('an interrupted transfer leaves no partial archive for a later build', t => {
  const f = fixture(t, { interrupted: true });
  assert.throws(() => resolveNodeArchive(f.options), /download|curl/i);
  assert.deepEqual(f.cachedFiles(), []);
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 3);
  f.update({ interrupted: false });
  assert.equal(readFileSync(resolveNodeArchive(f.options), 'utf8'), f.bytes);
});

test('a reset connection resumes the same temporary archive and verifies the completed bytes', t => {
  const f = fixture(t, { resetsRemaining: 1, requireResume: true });
  assert.equal(readFileSync(resolveNodeArchive(f.options), 'utf8'), f.bytes);
  const requests = f.state().requests.filter(request => request.isArchive);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].args[requests[0].args.indexOf('--output') + 1], requests[1].args[requests[1].args.indexOf('--output') + 1]);
});

test('a non-transient HTTP failure is not retried or cached', t => {
  const f = fixture(t, { archiveFailure: 22 });
  assert.throws(() => resolveNodeArchive(f.options), /download/i);
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 1);
  assert.deepEqual(f.cachedFiles(), []);
});

test('a downloaded checksum mismatch is rejected without publishing a cache entry', t => {
  const f = fixture(t, { corrupt: true });
  assert.throws(() => resolveNodeArchive(f.options), /checksum mismatch/i);
  assert.deepEqual(f.cachedFiles(), []);
});

test('an explicit archive is verified and never replaced by a network download', t => {
  const f = fixture(t);
  const archivePath = path.join(f.root, 'provided.tar.gz');
  writeFileSync(archivePath, f.bytes);
  assert.equal(resolveNodeArchive({ ...f.options, archivePath }), archivePath);
  writeFileSync(archivePath, 'invalid supplied archive');
  assert.throws(() => resolveNodeArchive({ ...f.options, archivePath }), /checksum mismatch/i);
  assert.equal(readFileSync(archivePath, 'utf8'), 'invalid supplied archive');
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 0);
});

test('unavailable or missing official checksums fail before downloading an archive', t => {
  const f = fixture(t, { missingChecksum: true });
  assert.throws(() => resolveNodeArchive(f.options), /checksum is missing/i);
  f.update({ missingChecksum: false, checksumFailure: true });
  assert.throws(() => resolveNodeArchive(f.options), /checksum|curl/i);
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 0);
});

test('a cached archive still requires successful official checksum retrieval', t => {
  const f = fixture(t);
  const archive = resolveNodeArchive(f.options);
  f.update({ checksumFailure: true });
  assert.throws(() => resolveNodeArchive(f.options), /checksum|curl/i);
  assert.equal(readFileSync(archive, 'utf8'), f.bytes);
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 1);
});
