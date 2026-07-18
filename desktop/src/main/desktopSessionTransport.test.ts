import { describe, expect, it } from 'vitest';

import { resolveDesktopSessionTransport, shouldFailDesktopSessionMainDocument } from './desktopSessionTransport';
import type { DesktopSessionTarget } from './desktopTarget';
import type { StartupReport } from './startup';

const localTarget: DesktopSessionTarget = {
  kind: 'local_environment',
  session_key: 'env:local:local_host',
  environment_id: 'local',
  label: 'Local Environment',
  route: 'local_host',
  local_environment_kind: 'local',
  has_local_hosting: true,
  has_remote_desktop: false,
};

const localStartup: StartupReport = {
  local_ui_url: 'http://100.126.191.114:23998/',
  local_ui_urls: ['http://100.126.191.114:23998/', 'http://192.168.1.20:23998/'],
  local_ui_bridge_url: 'http://127.0.0.1:43123/',
};

describe('resolveDesktopSessionTransport', () => {
  it('uses the trusted bridge for a native Local Environment without public URL fallback', () => {
    expect(resolveDesktopSessionTransport(localTarget, localStartup)).toEqual({
      kind: 'native_local_bridge',
      baseURL: 'http://127.0.0.1:43123/',
      entryURL: 'http://127.0.0.1:43123/_redeven_proxy/env/',
      displayURL: 'http://100.126.191.114:23998/',
      allowedBaseURL: 'http://127.0.0.1:43123/',
      proxyPolicy: 'direct',
      partition: 'redeven-direct:env%3Alocal%3Alocal_host',
    });
  });

  it('fails closed when a native Local Environment omits the bridge URL', () => {
    const { local_ui_bridge_url: _bridge, ...startup } = localStartup;
    expect(() => resolveDesktopSessionTransport(localTarget, startup)).toThrow(/missing the trusted Local UI bridge URL/iu);
  });

  it('uses a direct isolated session for a placement bridge', () => {
    expect(resolveDesktopSessionTransport(localTarget, {
      ...localStartup,
      local_ui_url: 'http://127.0.0.1:44000/',
    }, { placementBridge: true })).toMatchObject({
      kind: 'placement_bridge',
      baseURL: 'http://127.0.0.1:44000/',
      entryURL: 'http://127.0.0.1:44000/_redeven_proxy/env/',
      proxyPolicy: 'direct',
    });
  });

  it('uses a non-persistent direct partition for SSH placement bridges', () => {
    const target: DesktopSessionTarget = {
      kind: 'ssh_environment',
      session_key: 'ssh:demo',
      environment_id: 'ssh-demo',
      label: 'SSH Demo',
      ssh_destination: 'demo-host',
      ssh_port: null,
      auth_mode: 'key_agent',
      runtime_root: '~/.redeven',
      bootstrap_strategy: 'auto',
      release_base_url: 'https://github.com/floegence/redeven/releases',
      forwarded_local_ui_url: 'http://127.0.0.1:44000/',
    };
    const transport = resolveDesktopSessionTransport(target, {
      local_ui_url: 'http://127.0.0.1:44000/',
      local_ui_urls: ['http://127.0.0.1:44000/'],
    });
    expect(transport.kind).toBe('placement_bridge');
    expect(transport.proxyPolicy).toBe('direct');
    expect(transport.partition.startsWith('persist:')).toBe(false);
  });

  it('uses a non-persistent direct partition for Gateway loopback sessions', () => {
    const target: DesktopSessionTarget = {
      kind: 'gateway_environment',
      session_key: 'gateway:demo:env:one:session:token',
      environment_id: 'gateway-env',
      label: 'Gateway Env',
      gateway_id: 'demo',
      gateway_label: 'Gateway',
      gateway_env_id: 'one',
      gateway_session_id: 'token',
    };
    const transport = resolveDesktopSessionTransport(target, {
      local_ui_url: 'http://127.0.0.1:45000/session?ticket=secret',
      local_ui_urls: ['http://127.0.0.1:45000/session?ticket=secret'],
    });
    expect(transport.kind).toBe('gateway_bridge');
    expect(transport.entryURL).toContain('ticket=secret');
    expect(transport.proxyPolicy).toBe('direct');
    expect(transport.partition.startsWith('persist:')).toBe(false);
  });

  it('keeps Provider remote sessions on system proxy policy', () => {
    const target: DesktopSessionTarget = { ...localTarget, session_key: 'env:remote:remote_desktop', route: 'remote_desktop' };
    expect(resolveDesktopSessionTransport(target, {
      local_ui_url: 'https://provider.example.invalid/session/token',
      local_ui_urls: ['https://provider.example.invalid/session/token'],
    })).toMatchObject({
      kind: 'provider_remote',
      entryURL: 'https://provider.example.invalid/session/token',
      proxyPolicy: 'system',
      partition: '',
    });
  });

  it('keeps external Local UI sessions on system proxy policy', () => {
    const target: DesktopSessionTarget = {
      kind: 'external_local_ui',
      session_key: 'url:http%3A%2F%2F192.168.1.20%3A23998%2F',
      environment_id: 'external',
      external_local_ui_url: 'http://192.168.1.20:23998/',
      label: 'External',
    };
    expect(resolveDesktopSessionTransport(target, {
      local_ui_url: 'http://192.168.1.20:23998/',
      local_ui_urls: ['http://192.168.1.20:23998/'],
    })).toMatchObject({
      kind: 'external_local_ui',
      proxyPolicy: 'system',
      partition: '',
    });
  });
});

describe('shouldFailDesktopSessionMainDocument', () => {
  const response = {
    lifecycle: 'opening' as const,
    resourceType: 'mainFrame',
    statusCode: 503,
    webContentsID: 42,
    rootWebContentsID: 42,
  };

  it('fails an opening root document immediately on HTTP errors', () => {
    expect(shouldFailDesktopSessionMainDocument(response)).toBe(true);
  });

  it('does not treat successful documents, subresources, child windows, or open sessions as opening failures', () => {
    expect(shouldFailDesktopSessionMainDocument({ ...response, statusCode: 200 })).toBe(false);
    expect(shouldFailDesktopSessionMainDocument({ ...response, resourceType: 'xhr' })).toBe(false);
    expect(shouldFailDesktopSessionMainDocument({ ...response, webContentsID: 43 })).toBe(false);
    expect(shouldFailDesktopSessionMainDocument({ ...response, lifecycle: 'open' })).toBe(false);
  });
});
