import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const helper = path.join(repositoryRoot, 'scripts', 'prepare_redevplugin_rust_toolchain.sh');

function createFakeRustup(root, behavior) {
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'state');
  const log = path.join(root, 'rustup.log');
  const script = path.join(bin, 'rustup');
  const toolchain = path.join(state, 'toolchain');
  mkdirSync(path.join(toolchain, 'bin'), { recursive: true });
  for (const name of ['cargo', 'rustc']) {
    const file = path.join(toolchain, 'bin', name);
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${name} 1.88.0 (fixture)'\n`);
    chmodSync(file, 0o700);
  }
  mkdirSync(bin, { recursive: true });
  writeFileSync(script, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_RUSTUP_LOG"
${behavior}
`);
  chmodSync(script, 0o700);
  return { bin, state, log, toolchain };
}

function runHelper(fake, extraEnv = {}, args = ['--toolchain', '1.88.0', '--target', 'aarch64-apple-darwin']) {
  return spawnSync(helper, args, {
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      PATH: `${fake.bin}:${process.env.PATH}`,
      HOME: fake.state,
      FAKE_RUSTUP_LOG: fake.log,
      FAKE_RUSTUP_STATE: fake.state,
      FAKE_TOOLCHAIN: fake.toolchain,
      REDEVEN_RUSTUP_OFFLINE: '0',
      REDEVEN_RUSTUP_MAX_ATTEMPTS: '3',
      CARGO_HOME: path.join(fake.state, 'cargo'),
      RUSTUP_HOME: path.join(fake.state, 'rustup'),
      REDEVEN_RUSTUP_RETRY_DELAY_SECONDS: '0',
      ...extraEnv,
    },
  });
}

test('reuses an installed toolchain and target without invoking downloads', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-installed-'));
  try {
    const fake = createFakeRustup(root, `
case "$1" in
  which) printf '%s\\n' "$FAKE_TOOLCHAIN/bin/$4" ;;
  target) printf '%s\\n' 'aarch64-apple-darwin' ;;
  toolchain|*) echo "unexpected download: $*" >&2; exit 90 ;;
esac
`);
    const result = runHelper(fake);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /are ready/u);
    assert.equal(result.stdout.trim(), path.join(fake.toolchain, 'bin', 'cargo'));
    assert.doesNotMatch(readFileSync(fake.log, 'utf8'), /toolchain install|target add/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retries transient TLS failures with a bounded attempt count', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-retry-'));
  try {
    const fake = createFakeRustup(root, `
case "$1" in
  which)
    if [[ -f "$FAKE_RUSTUP_STATE/toolchain-ready" ]]; then printf '%s\\n' "$FAKE_TOOLCHAIN/bin/$4"; else exit 1; fi ;;
  target)
    if [[ "$2" == list ]]; then
      if [[ -f "$FAKE_RUSTUP_STATE/target-ready" ]]; then printf '%s\\n' 'aarch64-apple-darwin'; fi
    elif [[ "$2" == add ]]; then
      if [[ ! -f "$FAKE_RUSTUP_STATE/target-first-failed" ]]; then touch "$FAKE_RUSTUP_STATE/target-first-failed"; echo 'error: connection reset by peer' >&2; exit 1; fi
      touch "$FAKE_RUSTUP_STATE/target-ready"
    fi ;;
  toolchain)
    if [[ ! -f "$FAKE_RUSTUP_STATE/toolchain-first-failed" ]]; then touch "$FAKE_RUSTUP_STATE/toolchain-first-failed"; echo 'error: TLS handshake eof' >&2; exit 1; fi
    touch "$FAKE_RUSTUP_STATE/toolchain-ready" ;;
esac
`);
    const result = runHelper(fake, { REDEVEN_RUSTUP_MAX_ATTEMPTS: '3' });
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(fake.log, 'utf8');
    assert.equal((calls.match(/^toolchain install /gmu) ?? []).length, 2);
    assert.equal((calls.match(/^target add /gmu) ?? []).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not retry checksum or other non-retryable failures', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-hard-failure-'));
  try {
    const fake = createFakeRustup(root, `
case "$1" in
  which) exit 1 ;;
  toolchain) echo 'error: checksum failed for channel manifest' >&2; exit 1 ;;
  *) exit 1 ;;
esac
`);
    const result = runHelper(fake, { REDEVEN_RUSTUP_MAX_ATTEMPTS: '5' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-retryable/u);
    assert.equal((readFileSync(fake.log, 'utf8').match(/^toolchain install /gmu) ?? []).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stops after the configured number of transient attempts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-bounded-'));
  try {
    const fake = createFakeRustup(root, `
case "$1" in
  which) exit 1 ;;
  toolchain) echo 'error: TLS handshake eof' >&2; exit 1 ;;
  *) exit 1 ;;
esac
`);
    const result = runHelper(fake, { REDEVEN_RUSTUP_MAX_ATTEMPTS: '3' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /failed after 3 attempts/u);
    assert.equal((readFileSync(fake.log, 'utf8').match(/^toolchain install /gmu) ?? []).length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('offline mode fails clearly when the exact cache is missing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-offline-'));
  try {
    const fake = createFakeRustup(root, 'echo "unexpected rustup command" >&2; exit 90');
    const result = runHelper(fake, { REDEVEN_RUSTUP_OFFLINE: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /offline mode is enabled/u);
    assert.doesNotMatch(readFileSync(fake.log, 'utf8'), /toolchain install|target add/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsafe retry configuration instead of looping indefinitely', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-config-'));
  try {
    const fake = createFakeRustup(root, 'exit 1');
    const result = runHelper(fake, { REDEVEN_RUSTUP_MAX_ATTEMPTS: '99' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /REDEVEN_RUSTUP_MAX_ATTEMPTS must be (?:an integer )?between 1 and 5/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const message of [
  'error: TLS handshake eof\nerror: checksum failed for channel manifest',
  'error: tls handshake failed: invalid peer certificate: UnknownIssuer',
]) {
  test(`rejects integrity failures even alongside network diagnostics: ${message}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-integrity-'));
    try {
      const fake = createFakeRustup(root, `
if [[ "$1" == which ]]; then exit 1; fi
printf '%s\\n' "$FAKE_FAILURE" >&2
exit 1
`);
      const result = runHelper(fake, { FAKE_FAILURE: message });
      assert.notEqual(result.status, 0);
      assert.equal((readFileSync(fake.log, 'utf8').match(/^toolchain install /gmu) ?? []).length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('removes temporary download diagnostics on terminal failure', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-cleanup-'));
  try {
    const fake = createFakeRustup(root, 'echo "checksum failed" >&2; exit 1');
    const result = runHelper(fake, { TMPDIR: root });
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(root).filter((name) => name.startsWith('redevplugin-rustup.')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, env, addSucceeds, expected, addCount] of [
  ['only downloads a missing target', {}, true, 0, 1],
  ['offline missing target fails without download', { REDEVEN_RUSTUP_OFFLINE: '1' }, true, 1, 0],
  ['validates target installation postcondition', {}, false, 1, 1],
]) {
  test(label, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-target-'));
    try {
      const fake = createFakeRustup(root, `
case "$1 $2" in
  'which --toolchain') printf '%s\\n' "$FAKE_TOOLCHAIN/bin/$4" ;;
  'target list') if [[ -f "$FAKE_RUSTUP_STATE/ready" ]]; then echo aarch64-apple-darwin; fi ;;
  'target add') ${addSucceeds ? 'touch "$FAKE_RUSTUP_STATE/ready"' : ':'} ;;
  *) exit 90 ;;
esac
`);
      const result = runHelper(fake, env);
      assert.equal(result.status, expected, result.stderr);
      const calls = readFileSync(fake.log, 'utf8');
      assert.doesNotMatch(calls, /toolchain install/u);
      assert.equal((calls.match(/^target add /gmu) ?? []).length, addCount);
      if (!addSucceeds) assert.match(result.stderr, /still unavailable/u);
      if (env.REDEVEN_RUSTUP_OFFLINE) assert.match(result.stderr, /rustup target add --toolchain 1.88.0 aarch64-apple-darwin/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('does not treat target inventory errors as missing components', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-inventory-'));
  try {
    const fake = createFakeRustup(root, `
if [[ "$1" == which ]]; then printf '%s\\n' "$FAKE_TOOLCHAIN/bin/$4"; else echo 'manifest is corrupt' >&2; exit 1; fi
`);
    const result = runHelper(fake);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot inspect installed targets/u);
    assert.doesNotMatch(readFileSync(fake.log, 'utf8'), /toolchain install|target add/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves cancellation instead of retrying transient diagnostics', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-cancel-'));
  try {
    const fake = createFakeRustup(root, `
if [[ "$1" == which ]]; then exit 1; fi
echo 'TLS handshake eof' >&2
exit 130
`);
    const result = runHelper(fake, { TMPDIR: root });
    assert.equal(result.status, 130);
    assert.equal((readFileSync(fake.log, 'utf8').match(/^toolchain install /gmu) ?? []).length, 1);
    assert.deepEqual(readdirSync(root).filter((name) => name.startsWith('redevplugin-rustup.')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bounds exponential backoff and preserves Rustup network settings', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-rustup-backoff-'));
  try {
    const fake = createFakeRustup(root, `
[[ "$RUSTUP_AUTO_INSTALL" == 0 && "$RUSTUP_DOWNLOAD_TIMEOUT" == 120 ]] || exit 90
[[ "$RUSTUP_DIST_SERVER" == 'https://rust.example.invalid' && "$HTTPS_PROXY" == 'http://proxy.example.invalid' ]] || exit 91
if [[ "$1" == which ]]; then exit 1; fi
echo 'error: http request returned an unsuccessful status code: 503' >&2
exit 1
`);
    const sleep = path.join(fake.bin, 'sleep');
    writeFileSync(sleep, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$FAKE_RUSTUP_STATE/delays"\n');
    chmodSync(sleep, 0o700);
    const result = runHelper(fake, {
      REDEVEN_RUSTUP_MAX_ATTEMPTS: '5', REDEVEN_RUSTUP_RETRY_DELAY_SECONDS: '20',
      RUSTUP_DIST_SERVER: 'https://rust.example.invalid', HTTPS_PROXY: 'http://proxy.example.invalid',
      RUSTUP_DOWNLOAD_TIMEOUT: '120',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /failed after 5 attempts/u);
    assert.deepEqual(readFileSync(path.join(fake.state, 'delays'), 'utf8').trim().split('\n'), ['20', '40', '60', '60']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
