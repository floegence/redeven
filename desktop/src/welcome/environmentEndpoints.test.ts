import { describe, expect, it } from 'vitest';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { testDesktopPreferences } from '../testSupport/desktopTestHelpers';
import { buildEnvironmentCardEndpointsModel } from './viewModel';
import { connectionAddressRows, reportedRuntimeURLs } from '../shared/desktopEnvironmentConnection';

const local = buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences() }).environments
  .find((entry) => entry.kind === 'local_environment')!;

function ssh(label: string, overrides: Partial<DesktopEnvironmentEntry> = {}): DesktopEnvironmentEntry {
  return {
    ...local,
    id: label,
    label,
    kind: 'ssh_environment',
    registration_ref: { kind: 'runtime_target', id: `ssh:${label}` },
    managed_runtime_host_access: {
      kind: 'ssh_host',
      ssh: { ssh_destination: label, ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 },
    },
    managed_runtime_placement: { kind: 'host_process', runtime_root: '~/.redeven' },
    local_environment_runtime_state: undefined,
    local_ui_url: 'http://localhost:23998/',
    local_ui_urls: ['http://localhost:23998/'],
    runtime_health: { status: 'online', freshness: 'fresh', source: 'ssh_runtime_probe', checked_at_unix_ms: 1 },
    ...overrides,
  };
}

describe('Environment endpoint ownership', () => {
  it('orders address numbers naturally and keeps equal numeric text deterministic', () => {
    const urls = ['https://192.0.2.100:23998/', 'https://192.0.2.2:23998/', 'https://192.0.2.10:23998/'];
    expect(connectionAddressRows(urls).map(row => row.value)).toEqual([urls[1], urls[2], urls[0]]);
    const paths = ['https://example.test/path1', 'https://example.test/path01'];
    expect(connectionAddressRows(paths)).toEqual(connectionAddressRows([...paths].reverse()));
  });

  it('keeps address identity and order independent of Runtime enumeration order', () => {
    const urls = ['https://192.0.2.20:23998/', 'http://localhost:23998/', 'http://[::1]:23998/'];
    expect(connectionAddressRows([...urls].reverse())).toEqual(connectionAddressRows(urls));
    expect(connectionAddressRows([...urls, urls[0]])).toEqual(connectionAddressRows(urls));
  });

  it('presents usable browser addresses before internal listeners regardless of protocol', () => {
    const rows = buildEnvironmentCardEndpointsModel(ssh('gzcom', { local_ui_urls: ['http://localhost:23998/', 'https://192.0.2.20:23998/'] }));
    expect(rows.map(row => row.kind === 'address' ? row.access_scope : row.kind)).toEqual(['connection', 'network', 'environment_only']);
  });

  it('identifies each SSH host before its host-only listener', () => {
    for (const host of ['gzcom', 'gzlight']) {
      const rows = buildEnvironmentCardEndpointsModel(ssh(host));
      expect(rows[0]).toMatchObject({ kind: 'connection', value: `${host}:22` });
      expect(rows[1]).toMatchObject({
        kind: 'address', value: 'http://localhost:23998/', access_scope: 'environment_only', label_key: 'environmentConnection.browserAccess',
        copyable: false, browser_openable: false, shareable: false,
        detail_params: { host },
      });
    }
  });

  it.each([
    ['online', 'fresh', 'environmentConnection.addressUnavailable'],
    ['offline', 'unknown', 'environmentConnection.notChecked'],
    ['offline', 'checking', 'environmentConnection.checking'],
    ['offline', 'failed', 'environmentConnection.unconfirmed'],
  ] as const)('does not infer stopped from missing URLs (%s, %s)', (status, freshness, valueKey) => {
    const entry = ssh('gzcom', {
      local_ui_url: '', local_ui_urls: [],
      runtime_health: { status, freshness, source: 'ssh_runtime_probe', checked_at_unix_ms: 1 },
    });
    expect(buildEnvironmentCardEndpointsModel(entry)).toContainEqual(expect.objectContaining({ kind: 'status', value_key: valueKey }));
  });

  it.each(['http://localhost:23998/', 'https://127.0.0.1:23998/', 'http://[::1]:23998/', 'http://preview.localhost:23998/'])(
    'keeps loopback in its own namespace: %s', (url) => {
      const remoteRows = buildEnvironmentCardEndpointsModel(ssh('gzcom', { local_ui_urls: [url] }));
      expect(remoteRows).toContainEqual(expect.objectContaining({ value: url, access_scope: 'environment_only', copyable: false, browser_openable: false, shareable: false }));
      const localRows = buildEnvironmentCardEndpointsModel({ ...local, local_ui_urls: [url] });
      expect(localRows).toContainEqual(expect.objectContaining({ value: url, access_scope: 'this_device', label_key: 'environmentConnection.deviceAddress', copyable: true, browser_openable: true, shareable: false }));
    },
  );

  it('preserves actual HTTP and HTTPS network addresses without replacing the host', () => {
    const rows = buildEnvironmentCardEndpointsModel(ssh('jump-alias', {
      local_ui_urls: ['http://192.0.2.20:23998/', 'https://[2001:db8::2]:25000/', 'http://192.0.2.20:23998/'],
    }));
    expect(rows.filter((row) => row.kind === 'address')).toEqual([
      expect.objectContaining({ value: 'http://192.0.2.20:23998/', access_scope: 'network', label_key: 'environmentConnection.networkAccessAddress', copyable: true, browser_openable: true, shareable: true }),
      expect.objectContaining({ value: 'https://[2001:db8::2]:25000/', copyable: true, browser_openable: true, shareable: true }),
    ]);
  });

  it('describes WSL loopback inside the selected distribution without relying on localhost forwarding', () => {
    const rows = buildEnvironmentCardEndpointsModel(ssh('Ubuntu', {
      kind: 'wsl_environment',
      managed_runtime_host_access: { kind: 'wsl_host', distribution_name: 'Ubuntu-24.04', linux_user: 'dev' },
    }));
    expect(rows[0]).toMatchObject({ kind: 'connection', value: 'Ubuntu-24.04 · dev' });
    expect(rows[1]).toMatchObject({ detail_key: 'environmentConnection.wslOnly', detail_params: { host: 'Ubuntu-24.04' }, copyable: false, shareable: false });
  });

  it.each(['local', 'ssh'] as const)('keeps %s container loopback inside the container', (host) => {
    const base = ssh('gzcom');
    const rows = buildEnvironmentCardEndpointsModel({
      ...base,
      managed_runtime_host_access: host === 'local' ? { kind: 'local_host' } : base.managed_runtime_host_access,
      managed_runtime_placement: {
        kind: 'container_process', container_engine: 'docker', container_id: 'abc', container_ref: 'dev-box',
        container_label: 'Dev box', runtime_root: '~/.redeven', bridge_strategy: 'exec_stream',
      },
    });
    expect(rows[1]).toMatchObject({ kind: 'connection', value: 'docker · dev-box' });
    expect(rows[2]).toMatchObject({ detail_key: 'environmentConnection.containerOnly', detail_params: { host: 'dev-box' }, browser_openable: false, shareable: false });
  });

  it('reports stopped only from an explicit stopped observation', () => {
    const entry = ssh('gzcom', {
      local_ui_urls: [], local_ui_url: '',
      runtime_health: { status: 'offline', freshness: 'fresh', source: 'ssh_runtime_probe', checked_at_unix_ms: 1, offline_reason_code: 'not_started' },
    });
    expect(buildEnvironmentCardEndpointsModel(entry)).toContainEqual(expect.objectContaining({ value_key: 'environmentFacts.notRunning' }));
    expect(buildEnvironmentCardEndpointsModel({ ...entry, runtime_health: { ...entry.runtime_health, offline_reason_code: 'auth_required' } }))
      .toContainEqual(expect.objectContaining({ value_key: 'environmentConnection.unconfirmed' }));
  });

  it('never resurrects a singular URL when the current report explicitly has no addresses', () => {
    expect(reportedRuntimeURLs({ local_ui_url: 'http://localhost:23998/', local_ui_urls: [] })).toEqual([]);
    expect(buildEnvironmentCardEndpointsModel(ssh('gzcom', { local_ui_urls: [] })).some((row) => row.kind === 'address')).toBe(false);
  });

  it('rejects non-addresses and wildcard binds as access entries', () => {
    expect(connectionAddressRows(['SSH Lab', 'ssh://devbox:22', 'http://user:secret@server/', 'http://0.0.0.0:23998/', 'http://[::]:23998/'])).toEqual([]);
  });

  it('keeps Cloud and saved URL access separate from Gateway management information', () => {
    expect(buildEnvironmentCardEndpointsModel({ ...local, kind: 'provider_environment', remote_environment_url: 'https://cloud.example/env/a' }))
      .toEqual([expect.objectContaining({ kind: 'address', value: 'https://cloud.example/env/a', shareable: true })]);
    expect(buildEnvironmentCardEndpointsModel({ ...local, kind: 'external_local_ui', local_ui_url: 'https://env.example/' }))
      .toEqual([expect.objectContaining({ kind: 'address', value: 'https://env.example/', shareable: true })]);
    expect(buildEnvironmentCardEndpointsModel({
      ...local, kind: 'gateway_environment', gateway_label: 'Office', gateway_endpoint_label: 'https://gateway.example/',
      local_ui_url: 'http://127.0.0.1:44001/session',
    })).toEqual([expect.objectContaining({ kind: 'connection', value: 'Office · https://gateway.example/', copyable: false })]);
  });
});
