import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const verifier = new URL('./verify_redevplugin_macos_signature.py', import.meta.url);
const signedEntitlements = readFileSync(new URL('./redevplugin-runtime-entitlements.plist', import.meta.url), 'utf8');
function fixture(t, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-runtime-signature-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'); mkdirSync(bin);
  const evidence = path.join(root, 'signed.plist');
  writeFileSync(evidence, options.entitlements ?? signedEntitlements);
  writeFileSync(path.join(bin, 'codesign'), [
    '#!/bin/sh', 'set -eu',
    'if [ "$1" = --verify ]; then exit "$FIXTURE_VERIFY_STATUS"; fi',
    'if [ "$2" = --verbose=4 ]; then printf "CodeDirectory v=20500 flags=%s\\n" "$FIXTURE_FLAGS" >&2; exit 0; fi',
    'cat "$FIXTURE_ENTITLEMENTS"', '',
  ].join('\n'), { mode: 0o755 });
  return spawnSync('python3', [verifier.pathname, path.join(root, 'redevplugin-runtime')], {
    encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      FIXTURE_ENTITLEMENTS: evidence, FIXTURE_FLAGS: options.flags ?? '0x10002(adhoc,runtime)',
      FIXTURE_VERIFY_STATUS: String(options.verifyStatus ?? 0) },
  });
}

test('runtime signature accepts the exact executable-memory exception with hardened runtime', t => {
  const result = fixture(t); assert.equal(result.status, 0, result.stderr);
});
test('runtime signature rejects absent hardened runtime', t => {
  const result = fixture(t, { flags: '0x2(adhoc)' }); assert.notEqual(result.status, 0); assert.match(result.stderr, /hardened runtime/);
});
test('runtime signature rejects invalid signatures before reading entitlements', t => {
  const result = fixture(t, { verifyStatus: 1 }); assert.notEqual(result.status, 0);
});
for (const [label, entitlements] of [
  ['missing exception', signedEntitlements.replace('<true/>', '<false/>')],
  ['non-boolean exception', signedEntitlements.replace('<true/>', '<integer>1</integer>')],
  ['allow-jit alone', signedEntitlements.replace('allow-unsigned-executable-memory', 'allow-jit')],
  ['additional privilege', signedEntitlements.replace('</dict>', '<key>com.apple.security.cs.disable-library-validation</key><true/></dict>')],
  ['malformed signed plist', 'invalid'],
]) {
  test('runtime signature rejects ' + label, t => {
    const result = fixture(t, { entitlements }); assert.notEqual(result.status, 0);
  });
}
