import { describe, expect, it } from 'vitest';

import { buildConnectionCenterPageHTML } from './connectionCenterPage';

describe('connectionCenterPage', () => {
  it('renders the chooser-first startup page with this-device and recent-device entry points', () => {
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
      entry_reason: 'switch_device',
      remembered_target_kind: 'external_local_ui',
      active_session_target_kind: 'managed_local',
      active_session_local_ui_url: 'http://127.0.0.1:23998/',
      cancel_label: 'Back to current device',
      this_device_local_ui_url: 'http://127.0.0.1:23998/',
      this_device_share_preset: 'local_network',
      this_device_link_state: 'pending',
      recent_devices: [
        {
          local_ui_url: 'http://192.168.1.11:24000/',
          is_remembered_target: true,
          is_active_session: false,
        },
        {
          local_ui_url: 'http://192.168.1.12:24000/',
          is_remembered_target: false,
          is_active_session: false,
        },
      ],
      issue: null,
      advanced_section_open: false,
    }, '', 'linux');

    expect(html).toContain('<title>Choose a device</title>');
    expect(html).toContain('Choose a device');
    expect(html).toContain('Open This Device');
    expect(html).toContain('Open another machine');
    expect(html).toContain('This device options');
    expect(html).toContain('Advanced troubleshooting');
    expect(html).toContain('Save and return');
    expect(html).toContain('Remembered');
    expect(html).toContain('Current session');
    expect(html).toContain('Only this device');
    expect(html).toContain('Local network');
    expect(html).toContain('Custom');
    expect(html).toContain('Recent devices');
    expect(html).toContain('recent-device-button');
    expect(html).toContain('data-recent-url="http://192.168.1.11:24000/"');
    expect(html).toContain('Open Device');
    expect(html).toContain('crypto.getRandomValues');
    expect(html).toContain('initialLocalNetworkBind');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('id="connection-center-main"');
    expect(html).toContain('hero-meta');
    expect(html).toContain('device-card');
    expect(html).toContain('Desktop already has a saved one-shot Redeven link request');
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
      entry_reason: 'app_launch',
      remembered_target_kind: 'managed_local',
      active_session_target_kind: null,
      active_session_local_ui_url: '',
      cancel_label: 'Quit',
      this_device_local_ui_url: '',
      this_device_share_preset: 'this_device',
      this_device_link_state: 'connected',
      recent_devices: [],
      issue: null,
      advanced_section_open: false,
    }, '', 'darwin');

    expect(html).toContain('No device opened');
    expect(html).toContain('Remote control connected');
    expect(html).toContain('Private to this device');
    expect(html).toContain('Desktop can start or attach to the bundled runtime on this machine when you choose This device.');
    expect(html).toContain('id="recent-devices-section" hidden');
    expect(html).toContain('>Quit<');
    expect(html).toContain('calc(26px + 0px)');
    expect(html).not.toContain('env(titlebar-area-height, 0px)');
  });

  it('renders validation and chooser issues inline', () => {
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
      entry_reason: 'blocked',
      remembered_target_kind: 'managed_local',
      active_session_target_kind: null,
      active_session_local_ui_url: '',
      cancel_label: 'Quit',
      this_device_local_ui_url: '',
      this_device_share_preset: 'this_device',
      this_device_link_state: 'idle',
      recent_devices: [],
      issue: {
        scope: 'this_device',
        code: 'state_dir_locked',
        title: 'Redeven is already running',
        message: 'Another Redeven instance is already using the state directory.',
        diagnostics_copy: 'status: blocked\\ncode: state_dir_locked',
        target_url: '',
      },
      advanced_section_open: true,
    }, 'Redeven URL is required.', 'linux');

    expect(html).toContain('Redeven URL is required.');
    expect(html).toContain('Redeven is already running');
    expect(html).toContain('status: blocked');
    expect(html).toContain('Copy diagnostics');
    expect(html).toContain("errorEl.setAttribute('aria-hidden', text ? 'false' : 'true');");
    expect(html).toContain('queueMicrotask(() => errorEl.focus())');
  });
});
