import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBuildProxy } from './dev_desktop_build_proxy.mjs';

const settings = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 1082
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 1082
  HTTPSProxy : 127.0.0.1
  ExceptionsList : <array> {
    0 : *.example.test
    1 : localhost
    2 : 10.0.0.0/8
    3 : *.local
    4 : unsupported*glob
  }
}`;
const resolve = overrides => resolveBuildProxy({ env: {}, platform: 'darwin', readSettings: () => settings, ...overrides });

test('exports static macOS proxies for build tools with loopback and system exclusions', () => {
  assert.deepEqual(resolve(), {
    http_proxy: 'http://127.0.0.1:1082', HTTP_PROXY: 'http://127.0.0.1:1082',
    https_proxy: 'http://127.0.0.1:1082', HTTPS_PROXY: 'http://127.0.0.1:1082',
    no_proxy: 'localhost,127.0.0.1,::1,.example.test,10.0.0.0/8,.local',
    NO_PROXY: 'localhost,127.0.0.1,::1,.example.test,10.0.0.0/8,.local',
  });
});

test('explicit environment policy, including an empty proxy, skips system discovery', () => {
  for (const name of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
    for (const value of ['', 'http://user:password@explicit.invalid:8000']) {
      assert.deepEqual(resolve({ env: { [name]: value }, readSettings: () => assert.fail('must not read system settings') }), {});
    }
  }
});

test('preserves explicit exclusions, including an intentionally empty list', () => {
  for (const name of ['no_proxy', 'NO_PROXY']) {
    for (const value of ['', 'private.example']) {
      const result = resolve({ env: { [name]: value } });
      assert.equal(result.https_proxy, 'http://127.0.0.1:1082');
      assert.ok(!Object.hasOwn(result, 'no_proxy') && !Object.hasOwn(result, 'NO_PROXY'));
    }
  }
});

test('Linux and explicit opt-out do not read macOS settings', () => {
  for (const overrides of [{ platform: 'linux' }, { env: { REDEVEN_DEV_SYSTEM_PROXY: '0' } }]) {
    assert.deepEqual(resolve({ ...overrides, readSettings: () => assert.fail('must not read system settings') }), {});
  }
});

test('disabled proxy settings do not change the network environment', () => {
  assert.deepEqual(resolve({ readSettings: () => settings.replaceAll('Enable : 1', 'Enable : 0') }), {});
  assert.deepEqual(resolve({ readSettings: () => '<dictionary> {\n}' }), {});
});

test('IPv6 proxy endpoints use brackets and HTTPS destinations use HTTP CONNECT', () => {
  const result = resolve({ readSettings: () => settings.replaceAll('127.0.0.1', '::1') });
  assert.equal(result.https_proxy, 'http://[::1]:1082');
  assert.equal(result.http_proxy, 'http://[::1]:1082');
});

test('invalid enabled endpoints fail without emitting shell content or credentials', () => {
  for (const host of ['bad proxy', 'proxy/path', 'user:secret@proxy', '$(touch marker)', '-bad']) {
    assert.throws(() => resolve({ readSettings: () => settings.replaceAll('127.0.0.1', host) }), /Invalid macOS HTTP proxy/u);
  }
  for (const port of ['0', '65536', 'bad', '-1']) {
    assert.throws(() => resolve({ readSettings: () => settings.replaceAll('1082', port) }), /Invalid macOS HTTP proxy/u);
  }
});

test('unavailable system settings warn with an explicit configuration action', () => {
  const warnings = [];
  assert.deepEqual(resolve({ readSettings: () => { throw new Error('unavailable'); }, warn: value => warnings.push(value) }), {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HTTPS_PROXY/u);
});

test('PAC and SOCKS-only configurations request explicit environment policy', () => {
  for (const key of ['ProxyAutoConfigEnable', 'SOCKSEnable']) {
    const warnings = [];
    assert.deepEqual(resolve({ readSettings: () => `${key} : 1`, warn: value => warnings.push(value) }), {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /HTTPS_PROXY or ALL_PROXY/u);
  }
});
