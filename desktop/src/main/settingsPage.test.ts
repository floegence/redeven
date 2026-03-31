import { describe, expect, it } from 'vitest';

import { buildSettingsPageHTML } from './settingsPage';

describe('settingsPage', () => {
  it('renders the This Device Options page with low-level startup sections', () => {
    const html = buildSettingsPageHTML({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    }, '', 'linux', 'advanced_settings');

    expect(html).toContain('<title>This Device Options</title>');
    expect(html).toContain('This Device Options');
    expect(html).toContain('The device chooser owns machine selection');
    expect(html).toContain('Desktop-managed startup');
    expect(html).toContain('Next desktop-managed start');
    expect(html).toContain('Host This Device');
    expect(html).toContain('Register to Redeven on next start');
    expect(html).toContain('--env-token-env');
    expect(html).toContain('These values apply to desktop-managed starts on this machine.');
    expect(html).toContain('id="host-this-device-state-note"');
    expect(html).toContain('id="bootstrap-state-note"');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('id="settings-main"');
    expect(html).toContain('settings-shell');
    expect(html).toContain('summary-strip');
    expect(html).toContain('section-group');
    expect(html).toContain('settings-card');
    expect(html).toContain('id="page-status-badge"');
    expect(html).toContain('Desktop-managed Local UI');
    expect(html).toContain('id="settings-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="local-ui-bind-help settings-error"');
    expect(html).toContain('aria-describedby="env-token-help settings-error"');
    expect(html).toContain('const targetPresentations = JSON.parse');
    expect(html).toContain('presentation.saveLabel || saveButton.textContent');
    expect(html).not.toContain('summary-grid');
    expect(html).not.toContain('notice-panel');
  });

  it('keeps Another device copy focused on the next This device start', () => {
    const html = buildSettingsPageHTML({
      target_kind: 'external_local_ui',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, '', 'linux', 'advanced_settings');

    expect(html).toContain('Another device');
    expect(html).toContain('Save for this device');
    expect(html).toContain('Desktop is currently targeting Another device');
    expect(html).toContain('id="redeven-target-presentations"');
    expect(html).toContain('This Device Options');
  });

  it('keeps the page on a flat theme and exposes dark-mode tokens', () => {
    const html = buildSettingsPageHTML({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, '', 'linux', 'advanced_settings');

    expect(html).not.toContain('gradient');
    expect(html).toContain('background: var(--background);');
    expect(html).toContain('font-family: "Inter"');
    expect(html).toContain('.settings-shell');
    expect(html).toContain('env(titlebar-area-height, 0px)');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain('.skip-link');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('hsl(222 30% 8%)');
    expect(html).toContain('--error: oklch(0.7 0.22 25)');
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
    }, '', 'darwin', 'advanced_settings');

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
    }, 'Non-loopback Local UI binds require a Local UI password.', 'linux', 'advanced_settings');

    expect(html).toContain('Non-loopback Local UI binds require a Local UI password.');
    expect(html).toContain('queueMicrotask(() => errorEl.focus())');
    expect(html).toContain("errorEl.setAttribute('aria-hidden', text ? 'false' : 'true');");
  });
});
