import { describe, expect, it } from 'vitest';

import { buildDesktopSettingsSurfaceSnapshot, desktopAccessModeForDraft } from './settingsPageContent';

describe('settingsPageContent', () => {
  it('derives the private device access mode from the default loopback draft', () => {
    expect(desktopAccessModeForDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    })).toBe('private_device');
  });

  it('derives shared local network mode and marks bootstrap as pending when queued', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('advanced_settings', {
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });

    expect(snapshot.access_mode).toBe('shared_local_network');
    expect(snapshot.password_state_tone).toBe('warning');
    expect(snapshot.bootstrap_pending).toBe(true);
    expect(snapshot.bootstrap_status_label).toBe('Registration queued for next start');
  });

  it('treats non-preset binds as custom exposure', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('advanced_settings', {
      local_ui_bind: '10.0.0.12:25000',
      local_ui_password: 'secret',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });

    expect(snapshot.access_mode).toBe('custom_exposure');
    expect(snapshot.password_state_tone).toBe('success');
    expect(snapshot.access_bind_display).toBe('10.0.0.12:25000');
  });
});
