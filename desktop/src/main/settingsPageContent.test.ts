import { describe, expect, it } from 'vitest';

import { buildDesktopSettingsSurfaceSnapshot, desktopAccessModeForDraft } from './settingsPageContent';

describe('settingsPageContent', () => {
  it('derives the local-only access mode from the default loopback draft', () => {
    expect(desktopAccessModeForDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    })).toBe('local_only');
  });

  it('derives shared local network mode and marks bootstrap as pending when queued', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('local_environment_settings', {
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });

    expect(snapshot.access_mode).toBe('shared_local_network');
    expect(snapshot.password_state_tone).toBe('warning');
    expect(snapshot.bootstrap_pending).toBe(true);
    expect(snapshot.bootstrap_status_label).toBe('Registration queued for next start');
    expect(snapshot.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'access_mode',
        value: 'Shared on your local network',
      }),
      expect.objectContaining({
        id: 'password_state',
        value: 'Password required before the next open of Local Environment',
        tone: 'warning',
      }),
      expect.objectContaining({
        id: 'next_start',
        value: 'Registration queued for next start',
        tone: 'primary',
      }),
    ]));
  });

  it('treats non-preset binds as custom exposure', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('local_environment_settings', {
      local_ui_bind: '10.0.0.12:25000',
      local_ui_password: 'secret',
      local_ui_password_mode: 'replace',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });

    expect(snapshot.access_mode).toBe('custom_exposure');
    expect(snapshot.password_state_tone).toBe('success');
    expect(snapshot.access_bind_display).toBe('10.0.0.12:25000');
    expect(snapshot.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'bind_address',
        value: '10.0.0.12:25000',
        detail: 'Custom bind',
      }),
      expect.objectContaining({
        id: 'password_state',
        value: 'Password will be configured on save',
        tone: 'success',
      }),
    ]));
  });

  it('treats a configured stored password as write-only keep state', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('local_environment_settings', {
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: '',
      local_ui_password_mode: 'keep',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, {
      local_ui_password_configured: true,
    });

    expect(snapshot.password_state_label).toBe('Password configured');
    expect(snapshot.local_ui_password_configured).toBe(true);
    expect(snapshot.draft.local_ui_password).toBe('');
    expect(snapshot.host_fields[1]?.helpHTML).toContain('Leave this blank to keep the current stored password.');
  });

  it('describes replacing a stored password before save', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('local_environment_settings', {
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'next-secret',
      local_ui_password_mode: 'replace',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, {
      local_ui_password_configured: true,
    });

    expect(snapshot.password_state_label).toBe('Password will be replaced on save');
    expect(snapshot.host_fields[1]?.helpHTML).toContain('Saving will replace the stored password.');
  });

  it('explains when the current runtime needs a password that Desktop has not stored yet', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('local_environment_settings', {
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, {
      runtime_password_required: true,
    });

    expect(snapshot.password_state_label).toBe('Password required before the next open of Local Environment');
    expect(snapshot.runtime_password_required).toBe(true);
    expect(snapshot.local_ui_password_can_clear).toBe(false);
    expect(snapshot.host_fields[1]?.helpHTML).toContain('The current runtime is protected, but Desktop does not have a stored password ready to reuse.');
  });
});
