import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { renderBootstrap, renderFromBuild } from './render_installer_bootstrap.mjs';

const platforms = ['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'linux_arm64'];
const fixture = '#!/bin/sh\nprintf "%s\\n" "$@" > "$BOOTSTRAP_CHILD_LOG"\nexit "${BOOTSTRAP_CHILD_EXIT:-0}"\n';
const digest = createHash('sha256').update(fixture).digest('hex');
const digests = Object.fromEntries(platforms.map((platform) => [platform, digest]));

function exercise({ kernel = 'Linux', machine = 'x86_64', corrupt = false, channel = 'github', failPrimary = false, childExit = '0' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-bootstrap-test-'));
  try {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const write = (name, text) => fs.writeFileSync(path.join(bin, name), text, { mode: 0o755 });
    write('uname', '#!/bin/sh\ncase "$1" in -s) printf "%s\\n" "$BOOTSTRAP_KERNEL" ;; -m) printf "%s\\n" "$BOOTSTRAP_MACHINE" ;; esac\n');
    write('curl', '#!/bin/sh\nfor argument do\n  if [ "${next:-0}" = 1 ]; then output=$argument; next=0; fi\n  if [ "$argument" = -o ]; then next=1; fi\n  url=$argument\ndone\nprintf "%s\\n" "$url" >> "$BOOTSTRAP_FETCH_LOG"\ncase "$url" in https://github.com/*) [ "$BOOTSTRAP_FAIL_PRIMARY" = 1 ] && exit 22 ;; esac\n/bin/cp "$BOOTSTRAP_FIXTURE" "$output"\n');
    for (const name of ['mktemp', 'chmod', 'rm', 'shasum']) {
      const source = ['/usr/bin', '/bin'].map((dir) => path.join(dir, name)).find((file) => fs.existsSync(file));
      assert.ok(source, `test host must provide ${name}`);
      fs.symlinkSync(source, path.join(bin, name));
    }
    const fixtureFile = path.join(root, 'fixture');
    fs.writeFileSync(fixtureFile, corrupt ? `${fixture}# altered\n` : fixture);
    const childLog = path.join(root, 'child.log');
    const fetchLog = path.join(root, 'fetch.log');
    const script = path.join(root, 'install.sh');
    fs.writeFileSync(script, renderBootstrap('v0.13.13', digests, channel));
    const result = spawnSync('/bin/sh', [script, '--runtime-version', 'v0.13.12'], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, PATH: bin, TMPDIR: root, BOOTSTRAP_FIXTURE: fixtureFile, BOOTSTRAP_KERNEL: kernel,
        BOOTSTRAP_MACHINE: machine, BOOTSTRAP_CHILD_LOG: childLog, BOOTSTRAP_FETCH_LOG: fetchLog,
        BOOTSTRAP_FAIL_PRIMARY: failPrimary ? '1' : '0', BOOTSTRAP_CHILD_EXIT: childExit },
    });
    return { ...result, child: fs.existsSync(childLog) ? fs.readFileSync(childLog, 'utf8') : '',
      fetches: fs.existsSync(fetchLog) ? fs.readFileSync(fetchLog, 'utf8').trim().split('\n') : [],
      temporaryDirectories: fs.readdirSync(root).filter((name) => name.startsWith('redeven-bootstrap.')) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('generated entry requires no external developer tools and has four closed pins', () => {
  const script = renderBootstrap('v0.13.13', digests);
  assert.doesNotMatch(script, /command -v (?:cosign|go|python3?|openssl)\b|cosign verify-blob|safe_extract_tar/);
  assert.equal((script.match(/^SHA256_[A-Z0-9_]+='/gm) ?? []).length, 4);
  assert.doesNotMatch(script, /@[A-Z0-9_]+@/);
  for (const [kernel, machine, target] of [['Darwin', 'x86_64', 'darwin_amd64'], ['Darwin', 'arm64', 'darwin_arm64'], ['Linux', 'amd64', 'linux_amd64'], ['Linux', 'aarch64', 'linux_arm64']]) {
    const result = exercise({ kernel, machine });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.child, 'install\n--channel\ngithub\n--runtime-version\nv0.13.12\n');
    assert.ok(result.fetches[0].endsWith(`v0.13.13/redeven-installer_${target}`));
    assert.deepEqual(result.temporaryDirectories, []);
  }
});

test('checksum mismatch never executes a payload or hides behind mirror fallback', () => {
  const result = exercise({ corrupt: true, channel: 'portal' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
  assert.equal(result.child, '');
  assert.equal(result.fetches.length, 1);
  assert.deepEqual(result.temporaryDirectories, []);
});

test('transport failure uses official mirror and child failure remains a failure', () => {
  const result = exercise({ channel: 'portal', failPrimary: true, childExit: '7' });
  assert.equal(result.status, 7, result.stderr);
  assert.equal(result.fetches.length, 2);
  assert.match(result.fetches[1], /^https:\/\/agent\.package\.redeven\.com\/agent-install-pkg\//);
  assert.deepEqual(result.temporaryDirectories, []);
});

test('unsupported platforms fail before downloading and incomplete pins cannot render', () => {
  const result = exercise({ kernel: 'Windows_NT' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.fetches, []);
  assert.equal(result.child, '');
  assert.throws(() => renderBootstrap('v0.13.13', {}), /Missing reviewed digest/);
  assert.throws(() => renderBootstrap('latest', digests), /canonical/);
  assert.throws(() => renderFromBuild(os.tmpdir(), 'v0.13.13'), /ENOENT/);
});
