import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
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
const failure = state[isArchive ? 'archiveFailures' : 'checksumFailures']?.shift();
function reportStatus(httpCode = 200, connectCode = 0) {
  const index = args.indexOf('--write-out');
  if (index >= 0) process.stdout.write(args[index + 1]
    .replaceAll('%{http_code}', String(httpCode).padStart(3, '0'))
    .replaceAll('%{http_connect}', String(connectCode).padStart(3, '0')));
}
state.requests.push({ isArchive, args });
writeFileSync(stateFile, JSON.stringify(state));
if (failure) {
  if (!isArchive) process.stdout.write('incomplete checksum response');
  reportStatus(failure.httpCode ?? 0, failure.connectCode ?? 0);
  process.exit(failure.exitCode ?? failure);
}
if (!isArchive) {
  if (state.checksumFailure) process.exit(state.checksumFailure);
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
reportStatus();
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

test('a checksum TLS handshake failure retries and then reuses the verified archive', t => {
  const f = fixture(t);
  const archive = resolveNodeArchive(f.options);
  f.update({ requests: [], checksumFailures: [35] });
  assert.equal(resolveNodeArchive(f.options), archive);
  const requests = f.state().requests;
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => !request.isArchive));
  assert.equal(readFileSync(archive, 'utf8'), f.bytes);
});

test('a cold build recovers from checksum connection resets and archive TLS failures', t => {
  const f = fixture(t, { checksumFailures: [56, 35], archiveFailures: [35] });
  assert.equal(readFileSync(resolveNodeArchive(f.options), 'utf8'), f.bytes);
  assert.deepEqual(f.state().requests.map(request => request.isArchive), [false, false, false, true, true]);
  for (const { args } of f.state().requests) {
    assert.equal(args[args.indexOf('--proto') + 1], '=https');
    assert.equal(args[args.indexOf('--proto-redir') + 1], '=https');
    assert.ok(!args.includes('--insecure') && !args.includes('-k'));
    assert.ok(args.at(-1).startsWith('https://nodejs.org/dist/v26.7.0/'));
  }
});

test('persistent checksum TLS failures stop after three attempts without trusting cached bytes', t => {
  const f = fixture(t);
  const archive = resolveNodeArchive(f.options);
  f.update({ requests: [], checksumFailure: 35 });
  assert.throws(() => resolveNodeArchive(f.options), /checksum/i);
  assert.deepEqual(f.state().requests.map(request => request.isArchive), [false, false, false]);
  assert.equal(readFileSync(archive, 'utf8'), f.bytes);
});

for (const httpCode of [408, 429, 500, 502, 503, 504]) {
  test(`checksum HTTP ${httpCode} retries before verifying the archive`, t => {
    const f = fixture(t, { checksumFailures: [{ exitCode: 22, httpCode }] });
    assert.equal(readFileSync(resolveNodeArchive(f.options), 'utf8'), f.bytes);
    assert.deepEqual(f.state().requests.map(request => request.isArchive), [false, false, true]);
  });
}

test('an archive HTTP 503 retries and publishes only verified bytes', t => {
  const f = fixture(t, { archiveFailures: [{ exitCode: 22, httpCode: 503 }] });
  const archive = resolveNodeArchive(f.options);
  assert.equal(readFileSync(archive, 'utf8'), f.bytes);
  assert.deepEqual(f.state().requests.map(request => request.isArchive), [false, true, true]);
  assert.deepEqual(f.cachedFiles(), [path.basename(archive)]);
});

test('an archive HTTP 503 during resume preserves the partial file for the next attempt', t => {
  const f = fixture(t, { resetsRemaining: 1, requireResume: true, archiveFailures: [0, { exitCode: 22, httpCode: 503 }] });
  assert.equal(readFileSync(resolveNodeArchive(f.options), 'utf8'), f.bytes);
  const requests = f.state().requests.filter(request => request.isArchive);
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map(({ args }) => args[args.indexOf('--output') + 1])).size, 1);
});

test('persistent archive HTTP 503 exhausts the shared retry budget and removes partial files', t => {
  const f = fixture(t, { resetsRemaining: 1, archiveFailures: [0, ...Array(2).fill({ exitCode: 22, httpCode: 503 })] });
  assert.throws(() => resolveNodeArchive(f.options), /download/i);
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 3);
  assert.deepEqual(f.cachedFiles(), []);
});

test('persistent HTTP 503 stops after three attempts without trusting cached bytes', t => {
  const f = fixture(t);
  const archive = resolveNodeArchive(f.options);
  f.update({ requests: [], checksumFailures: Array(3).fill({ exitCode: 22, httpCode: 503 }) });
  assert.throws(() => resolveNodeArchive(f.options), /checksum/i);
  assert.deepEqual(f.state().requests.map(request => request.isArchive), [false, false, false]);
  assert.equal(readFileSync(archive, 'utf8'), f.bytes);
});

test('a temporary proxy CONNECT failure retries the same official URL', t => {
  const f = fixture(t, { checksumFailures: [{ exitCode: 56, connectCode: 503 }] });
  assert.equal(readFileSync(resolveNodeArchive(f.options), 'utf8'), f.bytes);
  const requests = f.state().requests.filter(request => !request.isArchive);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].args.at(-1), requests[1].args.at(-1));
});

for (const httpCode of [401, 403, 404, 407, 501]) {
  test(`permanent HTTP ${httpCode} fails immediately at the origin or proxy`, t => {
    const f = fixture(t, { checksumFailures: [{ exitCode: 22, httpCode }] });
    assert.throws(() => resolveNodeArchive(f.options), /checksum/i);
    assert.equal(f.state().requests.length, 1);
    f.update({ requests: [], checksumFailures: [{ exitCode: 56, connectCode: httpCode }] });
    assert.throws(() => resolveNodeArchive(f.options), /checksum/i);
    assert.equal(f.state().requests.length, 1);
    f.update({ requests: [], archiveFailures: [{ exitCode: 22, httpCode }] });
    assert.throws(() => resolveNodeArchive(f.options), /download/i);
    assert.equal(f.state().requests.filter(request => request.isArchive).length, 1);
    assert.deepEqual(f.cachedFiles(), []);
  });
}

for (const status of [22, 60, 77]) {
  test(`checksum HTTP or certificate failures stop immediately (curl ${status})`, t => {
    const f = fixture(t, { checksumFailure: status });
    assert.throws(() => resolveNodeArchive(f.options), /checksum/i);
    assert.equal(f.state().requests.length, 1);
    assert.deepEqual(f.cachedFiles(), []);
  });
}

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

for (const status of [22, 60, 77]) {
  test(`archive HTTP or certificate failures stop immediately (curl ${status})`, t => {
    const f = fixture(t, { archiveFailure: status });
    assert.throws(() => resolveNodeArchive(f.options), /download/i);
    assert.equal(f.state().requests.filter(request => request.isArchive).length, 1);
    assert.deepEqual(f.cachedFiles(), []);
  });
}

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
  f.update({ missingChecksum: false, checksumFailure: 22 });
  assert.throws(() => resolveNodeArchive(f.options), /checksum|curl/i);
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 0);
});

test('a cached archive still requires successful official checksum retrieval', t => {
  const f = fixture(t);
  const archive = resolveNodeArchive(f.options);
  f.update({ checksumFailure: 22 });
  assert.throws(() => resolveNodeArchive(f.options), /checksum|curl/i);
  assert.equal(readFileSync(archive, 'utf8'), f.bytes);
  assert.equal(f.state().requests.filter(request => request.isArchive).length, 1);
});

test('real curl recovers from HTTPS 503 responses without mixing status or error bodies into verified bytes', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'redeven-node-archive-https-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const curl = spawnSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' });
  assert.equal(curl.status, 0, curl.stderr);
  const certificate = path.join(root, 'cert.pem');
  const key = path.join(root, 'key.pem');
  const openssl = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=nodejs.org', '-addext', 'subjectAltName=DNS:nodejs.org',
    '-keyout', key, '-out', certificate,
  ], { encoding: 'utf8' });
  assert.equal(openssl.status, 0, openssl.stderr);
  const archiveName = 'node-v26.7.0-darwin-arm64.tar.gz';
  const bytes = 'official Node archive HTTPS fixture';
  const digest = createHash('sha256').update(bytes).digest('hex');
  const requests = new Map();
  const origin = https.createServer({ key: readFileSync(key), cert: readFileSync(certificate) }, (request, response) => {
    const count = (requests.get(request.url) ?? 0) + 1;
    requests.set(request.url, count);
    response.writeHead(count === 1 ? 503 : 200);
    response.end(count === 1 ? 'temporarily unavailable'
      : request.url.endsWith('/SHASUMS256.txt') ? `${digest}  ${archiveName}\n` : bytes);
  });
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    origin.closeAllConnections();
    await new Promise(resolve => origin.close(resolve));
  });
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const wrapper = path.join(root, 'curl');
  writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(curl.stdout.trim())} "$@" --noproxy '*' --connect-to 'nodejs.org:443:127.0.0.1:${origin.address().port}' --cacert ${quote(certificate)}\n`);
  chmodSync(wrapper, 0o700);
  const options = { version: '26.7.0', platform: 'darwin', arch: 'arm64', cacheRoot: path.join(root, 'cache'), archivePath: '' };
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { resolveNodeArchive } from ${JSON.stringify(new URL('./resolve_node_archive.mjs', import.meta.url).href)}; resolveNodeArchive(${JSON.stringify(options)});`,
  ], { env: { ...process.env, PATH: root + path.delimiter + process.env.PATH }, timeout: 20_000 });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const status = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(status, { code: 0, signal: null }, output);
  assert.equal(requests.get('/dist/v26.7.0/SHASUMS256.txt'), 2);
  assert.equal(requests.get(`/dist/v26.7.0/${archiveName}`), 2);
  assert.match(output, /HTTP 503, curl 22/u);
  assert.equal(readFileSync(path.join(options.cacheRoot, `${digest}-${archiveName}`), 'utf8'), bytes);
  assert.deepEqual(readdirSync(options.cacheRoot), [`${digest}-${archiveName}`]);
});
