import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  activeDesktopTargetKey,
  clearPendingBootstrap,
  defaultDesktopPreferences,
  createPlaintextSecretCodec,
  defaultDesktopPreferencesPaths,
  desktopPreferencesToDraft,
  loadDesktopPreferences,
  managedDesktopLaunchKey,
  saveDesktopPreferences,
  validateDesktopSettingsDraft,
} from './desktopPreferences';

describe('desktopPreferences', () => {
  it('validates a loopback-only draft without a password', () => {
    expect(validateDesktopSettingsDraft({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    })).toEqual({
      target: {
        kind: 'managed_local',
        external_local_ui_url: '',
      },
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      pending_bootstrap: null,
    });
  });

  it('requires a password for non-loopback binds', () => {
    expect(() => validateDesktopSettingsDraft({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    })).toThrow('Non-loopback Local UI binds require a Local UI password.');
  });

  it('requires a complete bootstrap set when any bootstrap field is provided', () => {
    expect(() => validateDesktopSettingsDraft({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: '',
      env_token: '',
    })).toThrow('Environment ID is required when bootstrap settings are provided.');
  });

  it('requires a valid Redeven URL when the desktop target is external', () => {
    expect(() => validateDesktopSettingsDraft({
      target_kind: 'external_local_ui',
      external_local_ui_url: 'http://example.com:24000/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    })).toThrow('Redeven URL must use localhost or an IP literal.');

    expect(validateDesktopSettingsDraft({
      target_kind: 'external_local_ui',
      external_local_ui_url: 'http://192.168.1.11:24000/_redeven_proxy/env/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }).target).toEqual({
      kind: 'external_local_ui',
      external_local_ui_url: 'http://192.168.1.11:24000/',
    });
  });

  it('round-trips preferences through the local files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
    try {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const preferences = validateDesktopSettingsDraft({
        target_kind: 'external_local_ui',
        external_local_ui_url: 'http://192.168.1.11:24000/',
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'super-secret',
        controlplane_url: 'https://region.example.invalid',
        env_id: 'env_123',
        env_token: 'token-123',
      });

      await saveDesktopPreferences(paths, preferences, codec);
      const loaded = await loadDesktopPreferences(paths, codec);
      expect(loaded).toEqual(preferences);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to defaults when the preferences json is malformed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
    try {
      const paths = defaultDesktopPreferencesPaths(root);
      await fs.writeFile(paths.preferencesFile, '{not valid json', 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual(defaultDesktopPreferences());
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('drops malformed secrets while keeping valid non-secret preferences', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
    try {
      const paths = defaultDesktopPreferencesPaths(root);
      await fs.writeFile(paths.preferencesFile, JSON.stringify({
        version: 1,
        target: {
          kind: 'external_local_ui',
          external_local_ui_url: 'http://192.168.1.11:24000/',
        },
        local_ui_bind: '127.0.0.1:0',
      }), 'utf8');
      await fs.writeFile(paths.secretsFile, '{"broken"', 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual({
        target: {
          kind: 'external_local_ui',
          external_local_ui_url: 'http://192.168.1.11:24000/',
        },
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: null,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('drops secrets that cannot be decoded', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
    try {
      const paths = defaultDesktopPreferencesPaths(root);
      await fs.writeFile(paths.preferencesFile, JSON.stringify({
        version: 1,
        target: {
          kind: 'managed_local',
        },
        local_ui_bind: '127.0.0.1:0',
        pending_bootstrap: {
          controlplane_url: 'https://region.example.invalid',
          env_id: 'env_123',
        },
      }), 'utf8');
      await fs.writeFile(paths.secretsFile, JSON.stringify({
        version: 1,
        local_ui_password: {
          encoding: 'safe_storage',
          data: 'abc',
        },
        pending_bootstrap: {
          env_token: {
            encoding: 'safe_storage',
            data: 'abc',
          },
        },
      }), 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual({
        target: {
          kind: 'managed_local',
          external_local_ui_url: '',
        },
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: null,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('recovers invalid stored values by falling back to valid defaults', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
    try {
      const paths = defaultDesktopPreferencesPaths(root);
      await fs.writeFile(paths.preferencesFile, JSON.stringify({
        version: 1,
        target: {
          kind: 'external_local_ui',
          external_local_ui_url: 'http://example.com:24000/',
        },
        local_ui_bind: 'bad-bind',
        pending_bootstrap: {
          controlplane_url: 'not-a-url',
          env_id: 'env_123',
        },
      }), 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual(defaultDesktopPreferences());
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('clears the one-shot bootstrap after a successful launch', () => {
    const preferences = validateDesktopSettingsDraft({
      target_kind: 'managed_local',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });
    expect(desktopPreferencesToDraft(clearPendingBootstrap(preferences))).toEqual({
      target_kind: 'managed_local',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });
  });

  it('tracks the active desktop target separately from remembered host settings', () => {
    const managedLocal = validateDesktopSettingsDraft({
      target_kind: 'managed_local',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });
    const external = validateDesktopSettingsDraft({
      target_kind: 'external_local_ui',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });

    expect(activeDesktopTargetKey(managedLocal)).toBe('managed_local');
    expect(activeDesktopTargetKey(external)).toBe('external_local_ui:http://192.168.1.11:24000/');
    expect(managedDesktopLaunchKey(managedLocal)).toBe(managedDesktopLaunchKey(external));
  });

  it('changes the managed launch key only when desktop-managed startup inputs change', () => {
    const baseline = validateDesktopSettingsDraft({
      target_kind: 'managed_local',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });
    const rememberedExternalOnly = validateDesktopSettingsDraft({
      target_kind: 'managed_local',
      external_local_ui_url: 'http://192.168.1.12:24000/',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });
    const changedBind = validateDesktopSettingsDraft({
      target_kind: 'managed_local',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'secret',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });

    expect(managedDesktopLaunchKey(rememberedExternalOnly)).toBe(managedDesktopLaunchKey(baseline));
    expect(managedDesktopLaunchKey(changedBind)).not.toBe(managedDesktopLaunchKey(baseline));
  });
});
