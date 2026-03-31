import { describe, expect, it } from 'vitest';

import { buildSettingsPageHTML } from './settingsPage';

describe('settingsPage', () => {
  it('renders the Desktop Settings page with settings surface sections', () => {
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
    expect(html).toContain('presentation.saveLabel[mode]');
    expect(html).not.toContain('summary-grid');
    expect(html).not.toContain('notice-panel');
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
    expect(html).toContain('<fieldset class="field">');
    expect(html).toContain('<legend class="field-label">Target</legend>');
    expect(html).toContain('IP or localhost only');
    expect(html).toContain('aria-describedby="external-local-ui-url-help settings-error"');
    expect(html).not.toContain('id="host-this-device-card"');
    expect(html).not.toContain('id="register-next-start-card"');
    expect(html).toContain('id="redeven-target-presentations"');
    expect(html).toContain('"connect":"Connect"');
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
    }, '', 'linux', 'desktop_settings');

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
    expect(html).toContain('queueMicrotask(() => errorEl.focus())');
    expect(html).toContain("errorEl.setAttribute('aria-hidden', text ? 'false' : 'true');");
  });
});
