import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  clearPendingBootstrap,
  createPlaintextSecretCodec,
  defaultDesktopPreferences,
  defaultDesktopPreferencesPaths,
  desktopPreferencesToDraft,
  loadDesktopPreferences,
  managedDesktopLaunchKey,
  normalizeRecentExternalLocalUIURLs,
  rememberRecentExternalLocalUITarget,
  saveDesktopPreferences,
  validateDesktopSettingsDraft,
} from './desktopPreferences';

describe('desktopPreferences', () => {
  it('validates a loopback-only draft without a password', () => {
    expect(validateDesktopSettingsDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    })).toEqual({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      pending_bootstrap: null,
      recent_external_local_ui_urls: [],
    });
  });

  it('requires a password for non-loopback binds', () => {
    expect(() => validateDesktopSettingsDraft({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    })).toThrow('Non-loopback Local UI binds require a Local UI password.');
  });

  it('requires a complete bootstrap set when any bootstrap field is provided', () => {
    expect(() => validateDesktopSettingsDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: '',
      env_token: '',
    })).toThrow('Environment ID is required when bootstrap settings are provided.');
  });

  it('round-trips preferences through the local files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
    try {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const preferences = {
        ...validateDesktopSettingsDraft({
          local_ui_bind: '0.0.0.0:24000',
          local_ui_password: 'super-secret',
          controlplane_url: 'https://region.example.invalid',
          env_id: 'env_123',
          env_token: 'token-123',
        }),
        recent_external_local_ui_urls: ['http://192.168.1.12:24000/'],
      };

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
        local_ui_bind: '127.0.0.1:0',
      }), 'utf8');
      await fs.writeFile(paths.secretsFile, '{"broken"', 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual({
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: null,
        recent_external_local_ui_urls: [],
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
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: null,
        recent_external_local_ui_urls: [],
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
        local_ui_bind: 'bad-bind',
        pending_bootstrap: {
          controlplane_url: 'not-a-url',
          env_id: 'env_123',
        },
        recent_external_local_ui_urls: [
          'http://192.168.1.11:24000/_redeven_proxy/env/',
          'not-a-url',
        ],
      }), 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual({
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: null,
        recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes recent device urls, preserves order, and caps the list', () => {
    const preferences = rememberRecentExternalLocalUITarget(
      rememberRecentExternalLocalUITarget(
        rememberRecentExternalLocalUITarget(defaultDesktopPreferences(), 'http://192.168.1.11:24000/_redeven_proxy/env/'),
        'http://192.168.1.12:24000/',
      ),
      'http://192.168.1.11:24000/',
    );

    expect(preferences.recent_external_local_ui_urls).toEqual([
      'http://192.168.1.11:24000/',
      'http://192.168.1.12:24000/',
    ]);

    expect(normalizeRecentExternalLocalUIURLs([
      'http://192.168.1.11:24000/',
      'http://192.168.1.12:24000/',
      'http://192.168.1.13:24000/',
      'http://192.168.1.14:24000/',
      'http://192.168.1.15:24000/',
      'http://192.168.1.16:24000/',
    ])).toEqual([
      'http://192.168.1.11:24000/',
      'http://192.168.1.12:24000/',
      'http://192.168.1.13:24000/',
      'http://192.168.1.14:24000/',
      'http://192.168.1.15:24000/',
    ]);
  });

  it('serializes this-device settings into a settings draft', () => {
    expect(desktopPreferencesToDraft({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'secret',
      pending_bootstrap: {
        controlplane_url: 'https://region.example.invalid',
        env_id: 'env_123',
        env_token: 'token-123',
      },
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
    })).toEqual({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'secret',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });
  });

  it('clears pending bootstrap without changing other fields', () => {
    expect(clearPendingBootstrap({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      pending_bootstrap: {
        controlplane_url: 'https://region.example.invalid',
        env_id: 'env_123',
        env_token: 'token-123',
      },
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
    })).toEqual({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      pending_bootstrap: null,
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
    });
  });

  it('includes this-device startup inputs in the managed launch key', () => {
    const left = managedDesktopLaunchKey({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      pending_bootstrap: null,
      recent_external_local_ui_urls: [],
    });
    const right = managedDesktopLaunchKey({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'secret',
      pending_bootstrap: null,
      recent_external_local_ui_urls: [],
    });

    expect(left).not.toBe(right);
  });
});
