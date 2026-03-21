import { describe, expect, it } from 'vitest';

import { buildSettingsPageHTML } from './settingsPage';

describe('settingsPage', () => {
  it('renders the Desktop Settings page with desktop startup fields', () => {
    const html = buildSettingsPageHTML({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    }, '', 'linux', 'desktop_settings');

    expect(html).toContain('<title>Desktop Settings</title>');
    expect(html).toContain('Desktop Settings');
    expect(html).toContain('Connection target is managed separately');
    expect(html).not.toContain('<h2>Connect to Redeven</h2>');
    expect(html).toContain('Host This Device');
    expect(html).toContain('Register to Redeven on next start');
    expect(html).toContain('--env-token-env');
    expect(html).toContain('These values apply to desktop-managed starts on this machine.');
    expect(html).toContain('Desktop is currently targeting External Redeven. This request stays saved for the next This device start and is never sent to the external target.');
    expect(html).toContain("return externalMode ? 'Save for this device' : 'Save and apply';");
  });

  it('renders a dedicated Connect to Redeven page without Desktop startup sections', () => {
    const html = buildSettingsPageHTML({
      target_kind: 'external_local_ui',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, '', 'linux', 'connect');

    expect(html).toContain('<title>Connect to Redeven</title>');
    expect(html).toContain('Connect to Redeven');
    expect(html).toContain('Desktop Settings stay separate');
    expect(html).toContain('Redeven URL');
    expect(html).toContain('External Redeven');
    expect(html).not.toContain('<h2>Host This Device</h2>');
    expect(html).not.toContain('<h2>Register to Redeven on next start</h2>');
    expect(html).toContain("return externalMode ? 'Connect' : 'Use this device';");
  });

  it('keeps the page on a flat theme without glossy gradients', () => {
    const html = buildSettingsPageHTML({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, '', 'linux', 'desktop_settings');

    expect(html).not.toContain('gradient');
    expect(html).toContain('background: var(--bg);');
    expect(html).toContain('env(titlebar-area-height, 0px)');
  });

  it('uses native spacing on macOS without titlebar safe-area CSS', () => {
    const html = buildSettingsPageHTML({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, '', 'darwin', 'desktop_settings');

    expect(html).toContain('calc(24px + 0px)');
    expect(html).not.toContain('env(titlebar-area-height, 0px)');
  });

  it('renders an inline error when validation fails', () => {
    const html = buildSettingsPageHTML({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, 'Non-loopback Local UI binds require a Local UI password.', 'linux', 'desktop_settings');

    expect(html).toContain('Non-loopback Local UI binds require a Local UI password.');
  });
});
