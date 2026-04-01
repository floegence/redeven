import { describe, expect, it } from 'vitest';

import { buildSettingsPageHTML } from './settingsPage';

describe('settingsPage', () => {
  it('renders This Device Options as a launcher-owned advanced surface', () => {
    const html = buildSettingsPageHTML({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    }, '', 'linux', 'advanced_settings');

    expect(html).toContain('<title>This Device Options</title>');
    expect(html).toContain('This Device Options');
    expect(html).toContain('Machine selection stays in the welcome launcher');
    expect(html).toContain('Desktop-managed startup');
    expect(html).toContain('Next desktop-managed start');
    expect(html).toContain('Host This Device');
    expect(html).toContain('Register to Redeven on next start');
    expect(html).toContain('stdin startup channel');
    expect(html).toContain('This Device startup details');
    expect(html).toContain('Save This Device Options');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('id="settings-main"');
    expect(html).toContain('id="page-status-badge"');
    expect(html).toContain('Desktop-managed Local UI');
    expect(html).toContain('const state = JSON.parse');
    expect(html).not.toContain('targetPresentations');
    expect(html).not.toContain('target_kind');
    expect(html).not.toContain('external-local-ui-url');
  });

  it('keeps the page on a flat theme and exposes dark-mode tokens', () => {
    const html = buildSettingsPageHTML({
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
