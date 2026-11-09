import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveDesktopAccessSigningIdentity } from './desktop_access_signing.mjs';

const development = 'A'.repeat(40), distribution = 'B'.repeat(40), other = 'C'.repeat(40);
const record = (hash, name) => `  1) ${hash} "${name}"\n`;
const dev = record(development, 'Apple Development: Example (TEAM)');
const release = record(distribution, 'Developer ID Application: Example (TEAM)');
const resolve = (output, options = {}) => resolveDesktopAccessSigningIdentity({ environment: {}, listIdentities: () => output, ...options });

test('development chooses one valid development certificate and deduplicates keychain entries', () => {
  assert.equal(resolve(dev + release + dev), development);
  assert.equal(resolve(release), distribution);
});
test('selection is independent of keychain ordering', () => {
  assert.equal(resolve(release + dev), resolve(dev + release));
});
test('explicit name or fingerprint takes precedence and resolves to an exact fingerprint', () => {
  assert.equal(resolve(dev + release, { identity: distribution.toLowerCase() }), distribution);
  assert.equal(resolve(dev + release, { identity: 'Developer ID Application: Example (TEAM)' }), distribution);
  assert.equal(resolve(dev + release, { environment: { REDEVEN_DESKTOP_ACCESS_SIGNING_IDENTITY: distribution } }), distribution);
  assert.equal(resolve(dev + release, { environment: { REDEVEN_DESKTOP_MAC_IDENTITY: distribution } }), distribution);
});
test('ambiguous certificates require explicit selection rather than first-match fallback', () => {
  const second = record(other, 'Apple Development: Other (TEAM2)');
  assert.throws(() => resolve(dev + second + release), /Multiple.*REDEVEN_DESKTOP_ACCESS_SIGNING_IDENTITY/su);
  assert.throws(() => resolve(release + record(other, 'Developer ID Application: Other (TEAM2)')), /Multiple/u);
  assert.throws(() => resolve(dev + record(other, 'Apple Development: Example (TEAM)'), { identity: 'Apple Development: Example (TEAM)' }), /Multiple/u);
});
test('unsupported, missing, invalid and ad-hoc identities fail closed', () => {
  const unsupported = record(other, 'Apple Distribution: Example (TEAM)');
  for (const output of ['', '0 valid identities found', unsupported, dev.trimEnd() + ' (CSSMERR_TP_CERT_EXPIRED)\n']) {
    assert.throws(() => resolve(output), /No valid Apple Development or Developer ID Application/u);
  }
  for (const identity of ['', '-', 'unknown', other]) {
    assert.throws(() => resolve(dev + release, { identity }), /Apple Development or Developer ID Application/u);
  }
});
test('production requires an explicit identity and discovery errors never fall back', () => {
  assert.throws(() => resolve(dev + release, { development: false }), /explicit.*REDEVEN_DESKTOP_MAC_IDENTITY/u);
  assert.equal(resolve(dev + release, { development: false, identity: distribution }), distribution);
  assert.throws(() => resolve('', { listIdentities() { throw new Error('keychain inaccessible'); } }), /keychain inaccessible/u);
});
test('launcher resolves signing before stopping services and before cache capture', () => {
  const source = readFileSync(new URL('./dev_desktop.sh', import.meta.url), 'utf8');
  const main = source.slice(source.indexOf('main() {'));
  assert.ok(main.indexOf('prepare_desktop_access_signing') < main.indexOf('stop_existing_processes'));
  assert.match(source, /export REDEVEN_DESKTOP_ACCESS_SIGNING_IDENTITY/u);
  assert.match(source, /\[ "\$STOP_ONLY" -eq 0 \].*return 0/u);
});
