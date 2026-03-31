import { describe, expect, it } from 'vitest';

import { buildConnectionCenterPageHTML } from './connectionCenterPage';

describe('connectionCenterPage', () => {
  it('renders the connection center with open, share, link, and recent device sections', () => {
    const html = buildConnectionCenterPageHTML({
      draft: {
        target_kind: 'external_local_ui',
        external_local_ui_url: 'http://192.168.1.11:24000/',
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret-123',
        controlplane_url: 'https://region.example.invalid',
        env_id: 'env_123',
        env_token: 'token-123',
      },
      current_target_kind: 'external_local_ui',
      current_local_ui_url: 'http://192.168.1.11:24000/',
      active_runtime_remote_enabled: null,
      share_preset: 'local_network',
      link_state: 'pending',
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/', 'http://192.168.1.12:24000/'],
    }, '', 'linux');

    expect(html).toContain('<title>Connection Center</title>');
    expect(html).toContain('Connection Center');
    expect(html).toContain('Open a Redeven device');
    expect(html).toContain('Choose how This device is exposed');
    expect(html).toContain('Link This device to Redeven');
    expect(html).toContain('Only this device');
    expect(html).toContain('Local network');
    expect(html).toContain('Custom');
    expect(html).toContain('Recent devices');
    expect(html).toContain('recent-target-chip');
    expect(html).toContain('data-recent-url="http://192.168.1.11:24000/"');
    expect(html).toContain('Local network');
    expect(html).toContain('Open Another Device');
    expect(html).toContain('crypto.getRandomValues');
    expect(html).toContain('initialLocalNetworkBind');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('id="connection-center-main"');
    expect(html).toContain('summary-strip');
    expect(html).toContain('settings-card');
    expect(html).toContain('Desktop will queue a one-shot Redeven link request');
  });

  it('renders without recent targets when none are available', () => {
    const html = buildConnectionCenterPageHTML({
      draft: {
        target_kind: 'managed_local',
        external_local_ui_url: '',
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        controlplane_url: '',
        env_id: '',
        env_token: '',
      },
      current_target_kind: 'managed_local',
      current_local_ui_url: '',
      active_runtime_remote_enabled: true,
      share_preset: 'this_device',
      link_state: 'connected',
      recent_external_local_ui_urls: [],
    }, '', 'darwin');

    expect(html).toContain('data-tone="local"');
    expect(html).toContain('Connected');
    expect(html).toContain('Private to this device');
    expect(html).toContain('Start or attach to the bundled Redeven runtime on this machine.');
    expect(html).toContain('id="recent-targets" class="recent-targets" hidden');
    expect(html).toContain('calc(24px + 0px)');
    expect(html).not.toContain('env(titlebar-area-height, 0px)');
  });

  it('renders an inline error when validation fails', () => {
    const html = buildConnectionCenterPageHTML({
      draft: {
        target_kind: 'managed_local',
        external_local_ui_url: '',
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        controlplane_url: '',
        env_id: '',
        env_token: '',
      },
      current_target_kind: 'managed_local',
      current_local_ui_url: '',
      active_runtime_remote_enabled: false,
      share_preset: 'this_device',
      link_state: 'idle',
      recent_external_local_ui_urls: [],
    }, 'Redeven URL is required.', 'linux');

    expect(html).toContain('Redeven URL is required.');
    expect(html).toContain("errorEl.setAttribute('aria-hidden', text ? 'false' : 'true');");
    expect(html).toContain('queueMicrotask(() => errorEl.focus())');
  });
});
