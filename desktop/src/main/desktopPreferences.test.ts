import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  clearPendingBootstrap,
  createPlaintextSecretCodec,
  defaultDesktopPreferencesPaths,
  desktopPreferencesToDraft,
  loadDesktopPreferences,
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
      const preferences = validateDesktopSettingsDraft({
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

  it('clears the one-shot bootstrap after a successful launch', () => {
    const preferences = validateDesktopSettingsDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });
    expect(desktopPreferencesToDraft(clearPendingBootstrap(preferences))).toEqual({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });
  });
});
