// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PluginSurfaceFrame,
  pluginSandboxID,
  pluginSandboxOriginFromEnvLocation,
  rewriteReDevPluginPlatformURL,
} from './PluginSurfaceFrame';
import type { PluginOpenSurfaceResult } from './pluginTypes';

const sdkState = vi.hoisted(() => ({
  hosts: [] as Array<{
    options: Record<string, any>;
    sendLifecycle: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  PluginSurfaceHost: vi.fn(function PluginSurfaceHostMock(this: {
    options: Record<string, any>;
    sendLifecycle: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }, options: Record<string, any>) {
    this.options = options;
    this.sendLifecycle = vi.fn();
    this.dispose = vi.fn();
    sdkState.hosts.push(this);
  }),
}));

const localApiMocks = vi.hoisted(() => ({
  prepareLocalApiRequestInit: vi.fn(async (init: RequestInit) => init),
}));

vi.mock('@floegence/redevplugin-ui', () => ({
  PluginSurfaceHost: sdkState.PluginSurfaceHost,
}));

vi.mock('../services/localApi', () => ({
  prepareLocalApiRequestInit: localApiMocks.prepareLocalApiRequestInit,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  X: () => <span />,
}));

const surface: PluginOpenSurfaceResult = {
  plugin_id: 'com.redeven.official.containers',
  plugin_instance_id: 'plugininst_containers',
  surface_id: 'containers.activity',
  surface_instance_id: 'surface_containers_1',
  active_fingerprint: 'sha256:active',
  owner_session_hash: 'owner-session',
  owner_user_hash: 'owner-user',
  session_channel_id_hash: 'channel-hash',
  asset_ticket: 'asset_ticket_secret',
  asset_ticket_id: 'asset_ticket_id_1',
  bridge_nonce: 'bridge_nonce_1',
  issued_at: '2026-01-01T00:00:00Z',
  expires_at: '2026-01-01T00:05:00Z',
};

let dispose: (() => void) | undefined;

beforeEach(() => {
  sdkState.hosts.length = 0;
  sdkState.PluginSurfaceHost.mockClear();
  localApiMocks.prepareLocalApiRequestInit.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ ok: true, data: { asset_session_id: 'asset_session_1' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PluginSurfaceFrame', () => {
  it('derives plugin sandbox origins for region and local Env App hosts', () => {
    const id = pluginSandboxID(surface);
    expect(id).toMatch(/^com-redeven-official-containers-/u);
    expect(id.length).toBeLessThanOrEqual(42);
    expect(
      pluginSandboxOriginFromEnvLocation({
        protocol: 'https:',
        hostname: 'env-demo.dev.redeven-sandbox.test',
        port: '',
      }, 'containers'),
    ).toBe('https://plg-containers.dev.redeven-sandbox.test');
    expect(
      pluginSandboxOriginFromEnvLocation({
        protocol: 'http:',
        hostname: 'localhost',
        port: '8096',
      }, 'containers'),
    ).toBe('http://plg-containers.localhost:8096');
  });

  it('bootstraps plugin assets without putting asset tickets in the iframe URL', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginSurfaceFrame surface={surface} onClose={vi.fn()} />, mount);
    await flushAsync();

    const bootstrapCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(bootstrapCall[0]).toContain('/_redeven_plugin/bootstrap');
    expect(JSON.parse(String(bootstrapCall[1].body))).toEqual({
      surface_instance_id: 'surface_containers_1',
      asset_ticket: 'asset_ticket_secret',
    });

    const iframe = mount.querySelector('[data-plugin-surface-iframe]') as HTMLIFrameElement;
    expect(iframe.src).toContain('/_redeven_plugin/assets/asset_session_1/ui/index.html');
    expect(iframe.src).toContain('parent_origin=');
    expect(iframe.src).toContain('plugin_id=com.redeven.official.containers');
    expect(iframe.src).not.toContain('asset_ticket_secret');
    expect(iframe.src).not.toContain('asset_ticket=');
  });

  it('mounts the released PluginSurfaceHost and rewrites SDK platform calls to the Redeven proxy', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginSurfaceFrame surface={surface} onClose={vi.fn()} />, mount);
    await flushAsync();

    expect(sdkState.PluginSurfaceHost).toHaveBeenCalledTimes(1);
    const host = sdkState.hosts[0];
    expect(host.options.bootstrap).toMatchObject({
      pluginId: 'com.redeven.official.containers',
      pluginInstanceId: 'plugininst_containers',
      surfaceId: 'containers.activity',
      surfaceInstanceId: 'surface_containers_1',
      activeFingerprint: 'sha256:active',
      bridgeNonce: 'bridge_nonce_1',
      ownerSessionHash: 'owner-session',
      ownerUserHash: 'owner-user',
      sessionChannelIdHash: 'channel-hash',
    });
    expect(host.options.iframeOrigin).toContain('plg-');

    await host.options.fetch('/_redevplugin/api/plugins/rpc', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
    });

    const platformCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => url === '/_redeven_proxy/api/plugins/rpc');
    expect(platformCall).toBeTruthy();
    expect(rewriteReDevPluginPlatformURL('/_redevplugin/api/plugins/surfaces/surface_1/bridge-token'))
      .toBe('/_redeven_proxy/api/plugins/surfaces/surface_1/bridge-token');
  });

  it('disposes the SDK host when the activity frame unmounts', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginSurfaceFrame surface={surface} onClose={vi.fn()} />, mount);
    await flushAsync();
    const host = sdkState.hosts[0];

    dispose();
    dispose = undefined;

    expect(host.sendLifecycle).toHaveBeenCalledWith({ type: 'hidden' });
    expect(host.dispose).toHaveBeenCalled();
  });
});
