import { describe, expect, it } from 'vitest';

import { buildSettingsPageHTML } from './settingsPage';

describe('settingsPage', () => {
  it('renders the settings form with desktop startup fields', () => {
    const html = buildSettingsPageHTML({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });

    expect(html).toContain('Redeven Desktop Settings');
    expect(html).toContain('Local UI bind address');
    expect(html).toContain('Register to Redeven on next start');
    expect(html).toContain('--env-token-env');
  });

  it('keeps the page on a flat theme without glossy gradients', () => {
    const html = buildSettingsPageHTML({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, '', 'linux');

    expect(html).not.toContain('gradient');
    expect(html).toContain('background: var(--bg);');
    expect(html).toContain('env(titlebar-area-height, 0px)');
  });

  it('uses native spacing on macOS without titlebar safe-area CSS', () => {
    const html = buildSettingsPageHTML({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, '', 'darwin');

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
    }, 'Non-loopback Local UI binds require a Local UI password.');

    expect(html).toContain('Non-loopback Local UI binds require a Local UI password.');
  });
});
