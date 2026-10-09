import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const stage = path.resolve(import.meta.dirname, 'stage_redevplugin_release_artifacts.sh');
const curl = spawnSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim();
const manifestURL = new URL('https://github.com/floegence/redevplugin/releases/download/v1.2.3/platform-release-manifest.json');
const manifest = {
  platform_version: '1.2.3', plugin_api: 1, internal_wire: 1,
  artifacts: [
    { name: 'contract:plugin/api.json', sha256: '1'.repeat(64) },
    { name: 'crate:redevplugin-runtime', sha256: '2'.repeat(64) },
    { name: 'crate:redevplugin-worker-sdk', sha256: '3'.repeat(64) },
    { name: 'go:github.com/floegence/redevplugin/v3', sha256: '4'.repeat(64) },
    { name: 'npm:@floegence/redevplugin-contracts', sha256: '5'.repeat(64) },
    { name: 'npm:@floegence/redevplugin-ui', sha256: '6'.repeat(64) },
  ],
};
let certificateRoot;

before(() => {
  certificateRoot = mkdtempSync(path.join(tmpdir(), 'redeven-manifest-tls-cert-'));
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=github.com', '-addext', 'subjectAltName=DNS:github.com',
    '-keyout', path.join(certificateRoot, 'key.pem'), '-out', path.join(certificateRoot, 'cert.pem'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
after(() => rmSync(certificateRoot, { recursive: true, force: true }));

function executable(file, source) {
  writeFileSync(file, source);
  chmodSync(file, 0o700);
}

// Run the real staging script and curl against an HTTPS origin with github.com's
// test-only certificate. Rust is stopped after manifest admission, before builds.
async function runStage({ failures = 0, body = JSON.stringify(manifest), redirect, trustCertificate = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-manifest-download-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const sockets = new Set();
  let connections = 0;
  let requests = 0;
  const origin = https.createServer({
    key: readFileSync(path.join(certificateRoot, 'key.pem')),
    cert: readFileSync(path.join(certificateRoot, 'cert.pem')),
  }, (request, response) => {
    requests += 1;
    assert.equal(request.url, manifestURL.pathname);
    if (redirect) response.writeHead(302, { location: redirect });
    response.end(redirect ? '' : body);
  });
  const listener = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    connections += 1;
    if (connections <= failures) socket.destroy();
    else origin.emit('connection', socket);
  });
  try {
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    executable(path.join(bin, 'go'), '#!/bin/sh\nprintf "v1.2.3\\n"\n');
    for (const name of ['cargo', 'rustc', 'codesign']) executable(path.join(bin, name), '#!/bin/sh\nexit 91\n');
    executable(path.join(bin, 'rustup'), `#!/bin/sh
if [ "$1" = which ]; then exit 1; fi
echo 'fixture: verified manifest reached Rust preparation' >&2
exit 91
`);
    executable(path.join(bin, 'curl'), `#!/bin/sh
exec '${curl.replaceAll("'", "'\\''")}' "$@" --noproxy '*' \\
  --connect-to 'github.com:443:127.0.0.1:${port}' \\
  ${trustCertificate ? '--cacert "$FIXTURE_CERT"' : ''}
`);
    const child = spawn('/bin/bash', [stage,
      '--dest-dir', path.join(root, 'artifacts'), '--runtime-out', path.join(root, 'runtime'),
      '--redeven-goos', 'linux', '--redeven-goarch', 'amd64',
    ], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_CERT: path.join(certificateRoot, 'cert.pem'), REDEVEN_RUSTUP_OFFLINE: '0' },
      timeout: 25_000,
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const status = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => { assert.equal(signal, null, output); resolve(code); });
    });
    assert.notEqual(status, 0, 'fixture must stop before building Rust');
    assert.deepEqual(readdirSync(root).sort(), ['bin'], 'failed staging must remove temporary or partial artifacts');
    return { output, connections, requests };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => listener.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}

test('recovers a TLS handshake disconnect before admitting the published manifest', async () => {
  const result = await runStage({ failures: 1 });
  assert.match(result.output, /curl: \(35\)/u);
  assert.equal(result.connections, 2);
  assert.equal(result.requests, 1);
  assert.match(result.output, /verified manifest reached Rust preparation/u);
});

test('persistent TLS failure stops after four attempts with an actionable error', async () => {
  const result = await runStage({ failures: Infinity });
  assert.equal(result.connections, 4);
  assert.equal(result.requests, 0);
  assert.match(result.output, /failed to download.*v1\.2\.3.*HTTPS_PROXY/u);
  assert.doesNotMatch(result.output, /verified manifest reached Rust preparation/u);
});

test('successful transfer still rejects a manifest for a different release', async () => {
  const result = await runStage({ body: JSON.stringify({ ...manifest, platform_version: '1.2.4' }) });
  assert.equal(result.requests, 1);
  assert.match(result.output, /release manifest version does not match Go module version/u);
  assert.doesNotMatch(result.output, /verified manifest reached Rust preparation/u);
});

test('successful transfer still rejects malformed or duplicate-field manifests', async () => {
  const result = await runStage({ body: JSON.stringify(manifest).replace('"plugin_api":1', '"plugin_api":1,"plugin_api":1') });
  assert.equal(result.requests, 1);
  assert.match(result.output, /duplicate field plugin_api/u);
  assert.doesNotMatch(result.output, /verified manifest reached Rust preparation/u);
});

test('retries never bypass an untrusted TLS certificate', async () => {
  const result = await runStage({ trustCertificate: false });
  assert.equal(result.requests, 0);
  assert.match(result.output, /curl: \(60\)/u);
  assert.doesNotMatch(result.output, /verified manifest reached Rust preparation/u);
});

test('retries never follow a redirect from HTTPS to HTTP', async () => {
  const result = await runStage({ redirect: 'http://127.0.0.1/manifest.json' });
  assert.match(result.output, /Protocol "http" disabled/u);
  assert.doesNotMatch(result.output, /verified manifest reached Rust preparation/u);
});
