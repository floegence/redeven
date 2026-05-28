import { describe, expect, it } from 'vitest';

import { buildDesktopSettingsSurfaceSnapshot, desktopAccessModeForDraft } from './settingsPageContent';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';

function draft(overrides: Partial<DesktopSettingsDraft>): DesktopSettingsDraft {
  return {
    local_ui_bind: 'localhost:23998',
    local_ui_password: '',
    local_ui_password_mode: 'replace',
    auto_runtime_probe_enabled: false,
    ...overrides,
  };
}

function settingsOptions(overrides: Partial<Parameters<typeof buildDesktopSettingsSurfaceSnapshot>[2]> = {}) {
  return {
    environment_id: 'local',
    environment_label: 'Local Environment',
    environment_kind: 'local' as const,
    auto_runtime_probe_configurable: false,
    ...overrides,
  };
}

describe('settingsPageContent', () => {
  it('derives the local-only access mode from the default loopback draft', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('environment_settings', draft({
      local_ui_bind: '127.0.0.1:0',
      auto_runtime_probe_enabled: true,
    }), settingsOptions());

    expect(desktopAccessModeForDraft(snapshot.draft)).toBe('local_only');
    expect(snapshot.auto_runtime_probe_configurable).toBe(false);
    expect(snapshot.draft.auto_runtime_probe_enabled).toBe(true);
  });

  it('derives shared local network mode and describes the next start address', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('environment_settings', draft({
      local_ui_bind: '0.0.0.0:23998',
    }), settingsOptions());

    expect(snapshot.access_mode).toBe('shared_local_network');
    expect(snapshot.password_state_tone).toBe('warning');
    expect(snapshot.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'visibility',
        value_key: 'settings.sharedLocalNetworkLabel',
      }),
      expect.objectContaining({
        id: 'next_start_address',
        value: '23998',
        detail_key: 'settings.sharedAddressDetail',
      }),
      expect.objectContaining({
        id: 'password_state',
        value_key: 'settings.passwordNeeded',
        tone: 'warning',
      }),
    ]));
  });

  it('treats non-preset binds as custom exposure', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('environment_settings', draft({
      local_ui_bind: '10.0.0.12:25000',
      local_ui_password: 'secret',
    }), settingsOptions());

    expect(snapshot.access_mode).toBe('custom_exposure');
    expect(snapshot.password_state_tone).toBe('success');
    expect(snapshot.next_start_address_display).toBe('10.0.0.12:25000');
    expect(snapshot.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'next_start_address',
        value: '10.0.0.12:25000',
        detail_key: 'settings.customBindDetail',
      }),
      expect.objectContaining({
        id: 'password_state',
        value_key: 'settings.setOnSave',
        tone: 'success',
      }),
    ]));
  });

  it('treats a configured stored password as write-only keep state', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('environment_settings', draft({
      local_ui_bind: '0.0.0.0:23998',
      local_ui_password_mode: 'keep',
    }), settingsOptions({
      local_ui_password_configured: true,
    }));

    expect(snapshot.password_state_id).toBe('configured');
    expect(snapshot.local_ui_password_configured).toBe(true);
    expect(snapshot.draft.local_ui_password).toBe('');
    expect(snapshot.host_fields[1]?.help_key).toBe('settings.localUIPasswordKeepHelp');
  });

  it('describes replacing a stored password before save', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('environment_settings', draft({
      local_ui_bind: '0.0.0.0:23998',
      local_ui_password: 'next-secret',
    }), settingsOptions({
      local_ui_password_configured: true,
    }));

    expect(snapshot.password_state_id).toBe('replace_on_save');
    expect(snapshot.host_fields[1]?.help_key).toBe('settings.localUIPasswordReplaceHelp');
  });

  it('explains when the current runtime needs a password that Desktop has not stored yet', () => {
    const snapshot = buildDesktopSettingsSurfaceSnapshot('environment_settings', draft({
      local_ui_bind: '0.0.0.0:23998',
    }), settingsOptions({
      runtime_password_required: true,
    }));

    expect(snapshot.password_state_id).toBe('required');
    expect(snapshot.runtime_password_required).toBe(true);
    expect(snapshot.local_ui_password_can_clear).toBe(false);
    expect(snapshot.host_fields[1]?.help_key).toBe('settings.localUIPasswordRuntimeRequiredHelp');
  });
});
