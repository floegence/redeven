import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  clearPendingBootstrap,
  createPlaintextSecretCodec,
  type DesktopPreferences,
  defaultDesktopPreferences,
  defaultDesktopPreferencesPaths,
  defaultSavedEnvironmentLabel,
  deleteSavedEnvironment,
  deleteSavedSSHEnvironment,
  deriveRecentExternalLocalUIURLs,
  desktopEnvironmentID,
  desktopPreferencesToDraft,
  loadDesktopPreferences,
  managedDesktopLaunchKey,
  normalizeRecentExternalLocalUIURLs,
  normalizeSavedEnvironments,
  rememberRecentExternalLocalUITarget,
  rememberRecentSSHEnvironmentTarget,
  saveDesktopPreferences,
  upsertSavedEnvironment,
  upsertSavedSSHEnvironment,
  validateDesktopSettingsDraft,
} from './desktopPreferences';

describe('desktopPreferences', () => {
  it('validates a loopback-only draft without a password', () => {
    expect(validateDesktopSettingsDraft({
      local_ui_bind: 'localhost:23998',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    })).toEqual({
      local_ui_bind: 'localhost:23998',
      local_ui_password: '',
      local_ui_password_configured: false,
      pending_bootstrap: null,
      saved_environments: [],
      saved_ssh_environments: [],
      recent_external_local_ui_urls: [],
      control_planes: [],
    });
  });

  it('requires a password for non-loopback binds', () => {
    expect(() => validateDesktopSettingsDraft({
      local_ui_bind: '0.0.0.0:23998',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    })).toThrow('Non-loopback Local UI binds require a Local UI password.');
  });

  it('requires a complete bootstrap set when any bootstrap field is provided', () => {
    expect(() => validateDesktopSettingsDraft({
      local_ui_bind: 'localhost:23998',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      controlplane_url: 'https://region.example.invalid',
      env_id: '',
      env_token: '',
    })).toThrow('Environment ID is required when bootstrap settings are provided.');
  });

  it('round-trips preferences through the local files with saved environments', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
    try {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const preferences: DesktopPreferences = {
        ...validateDesktopSettingsDraft({
          local_ui_bind: '0.0.0.0:23998',
          local_ui_password: 'super-secret',
          local_ui_password_mode: 'replace',
          controlplane_url: 'https://region.example.invalid',
          env_id: 'env_123',
          env_token: 'token-123',
        }),
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            source: 'saved',
            last_used_at_ms: 100,
          },
        ],
        recent_external_local_ui_urls: ['http://192.168.1.12:24000/'],
      };

      await saveDesktopPreferences(paths, preferences, codec);
      const loaded = await loadDesktopPreferences(paths, codec);
      expect(loaded).toEqual(preferences);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves an existing encoded password when saving configured write-only state', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
    try {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const initial = validateDesktopSettingsDraft({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'super-secret',
        local_ui_password_mode: 'replace',
        controlplane_url: '',
        env_id: '',
        env_token: '',
      });

      await saveDesktopPreferences(paths, initial, codec);
      await saveDesktopPreferences(paths, {
        ...initial,
        local_ui_password: '',
        local_ui_password_configured: true,
      }, codec);

      await expect(loadDesktopPreferences(paths, codec)).resolves.toEqual({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'super-secret',
        local_ui_password_configured: true,
        pending_bootstrap: null,
        saved_environments: [],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [],
        control_planes: [],
      });
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
        version: 2,
        local_ui_bind: '127.0.0.1:0',
      }), 'utf8');
      await fs.writeFile(paths.secretsFile, '{"broken"', 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual({
        local_ui_bind: 'localhost:23998',
        local_ui_password: '',
        local_ui_password_configured: false,
        pending_bootstrap: null,
        saved_environments: [],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [],
        control_planes: [],
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
        version: 2,
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
        local_ui_bind: 'localhost:23998',
        local_ui_password: '',
        local_ui_password_configured: true,
        pending_bootstrap: null,
        saved_environments: [],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [],
        control_planes: [],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves explicit auto-port loopback binds in the current preferences format', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
    try {
      const paths = defaultDesktopPreferencesPaths(root);
      await fs.writeFile(paths.preferencesFile, JSON.stringify({
        version: 3,
        local_ui_bind: '127.0.0.1:0',
      }), 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual({
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        local_ui_password_configured: false,
        pending_bootstrap: null,
        saved_environments: [],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [],
        control_planes: [],
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
        version: 2,
        local_ui_bind: 'bad-bind',
        pending_bootstrap: {
          controlplane_url: 'not-a-url',
          env_id: 'env_123',
        },
        saved_environments: [
          {
            label: 'Bad target',
            local_ui_url: 'not-a-url',
          },
          {
            label: 'Recovered target',
            local_ui_url: 'http://192.168.1.11:24000/_redeven_proxy/env/',
            last_used_at_ms: 20,
          },
        ],
      }), 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual({
        local_ui_bind: 'localhost:23998',
        local_ui_password: '',
        local_ui_password_configured: false,
        pending_bootstrap: null,
        saved_environments: [
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Recovered target',
            local_ui_url: 'http://192.168.1.11:24000/',
            source: 'saved',
            last_used_at_ms: 20,
          },
        ],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
        control_planes: [],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('migrates legacy recent urls into saved environments', () => {
    expect(normalizeSavedEnvironments(
      null,
      [
        'http://192.168.1.11:24000/_redeven_proxy/env/',
        'http://192.168.1.12:24000/',
      ],
    )).toEqual([
      {
        id: 'http://192.168.1.11:24000/',
        label: '192.168.1.11:24000',
        local_ui_url: 'http://192.168.1.11:24000/',
        source: 'recent_auto',
        last_used_at_ms: 2,
      },
      {
        id: 'http://192.168.1.12:24000/',
        label: '192.168.1.12:24000',
        local_ui_url: 'http://192.168.1.12:24000/',
        source: 'recent_auto',
        last_used_at_ms: 1,
      },
    ]);
  });

  it('upserts, orders, and deletes saved environments while deriving recent urls', () => {
    const first = upsertSavedEnvironment(defaultDesktopPreferences(), {
      environment_id: desktopEnvironmentID('http://192.168.1.11:24000/'),
      label: 'Laptop',
      local_ui_url: 'http://192.168.1.11:24000/',
      last_used_at_ms: 100,
    });
    const second = upsertSavedEnvironment(first, {
      environment_id: '',
      label: '',
      local_ui_url: 'http://192.168.1.12:24000/_redeven_proxy/env/',
      last_used_at_ms: 200,
    });
    const updated = upsertSavedEnvironment(second, {
      environment_id: desktopEnvironmentID('http://192.168.1.11:24000/'),
      label: 'Laptop Updated',
      local_ui_url: 'http://192.168.1.11:24000/',
      last_used_at_ms: 300,
    });

    expect(updated.saved_environments).toEqual([
      {
        id: 'http://192.168.1.11:24000/',
        label: 'Laptop Updated',
        local_ui_url: 'http://192.168.1.11:24000/',
        source: 'saved',
        last_used_at_ms: 300,
      },
      {
        id: 'http://192.168.1.12:24000/',
        label: defaultSavedEnvironmentLabel('http://192.168.1.12:24000/'),
        local_ui_url: 'http://192.168.1.12:24000/',
        source: 'saved',
        last_used_at_ms: 200,
      },
    ]);
    expect(updated.recent_external_local_ui_urls).toEqual([
      'http://192.168.1.11:24000/',
      'http://192.168.1.12:24000/',
    ]);

    expect(deleteSavedEnvironment(updated, 'http://192.168.1.12:24000/')).toEqual({
      ...updated,
      saved_environments: [
        {
          id: 'http://192.168.1.11:24000/',
          label: 'Laptop Updated',
          local_ui_url: 'http://192.168.1.11:24000/',
          source: 'saved',
          last_used_at_ms: 300,
        },
      ],
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
    });
  });

  it('upgrades recent_auto environments into saved entries when the user saves them', () => {
    const remembered = rememberRecentExternalLocalUITarget(
      defaultDesktopPreferences(),
      'http://192.168.1.11:24000/',
    );

    expect(remembered.saved_environments).toEqual([
      expect.objectContaining({
        id: 'http://192.168.1.11:24000/',
        source: 'recent_auto',
      }),
    ]);

    const promoted = upsertSavedEnvironment(remembered, {
      environment_id: desktopEnvironmentID('http://192.168.1.11:24000/'),
      label: 'Laptop',
      local_ui_url: 'http://192.168.1.11:24000/',
      source: 'saved',
      last_used_at_ms: 500,
    });

    expect(promoted.saved_environments).toEqual([
      {
        id: 'http://192.168.1.11:24000/',
        label: 'Laptop',
        local_ui_url: 'http://192.168.1.11:24000/',
        source: 'saved',
        last_used_at_ms: 500,
      },
    ]);
  });

  it('remembers, saves, and deletes SSH environments through the saved catalog', () => {
    const remembered = rememberRecentSSHEnvironmentTarget(defaultDesktopPreferences(), {
      ssh_destination: 'devbox',
      ssh_port: 2222,
      remote_install_dir: 'remote_default',
      label: 'Lab',
    });

    expect(remembered.saved_ssh_environments).toEqual([
      {
        id: 'ssh:devbox:2222:remote_default',
        label: 'Lab',
        ssh_destination: 'devbox',
        ssh_port: 2222,
        remote_install_dir: 'remote_default',
        source: 'recent_auto',
        last_used_at_ms: expect.any(Number),
      },
    ]);

    const saved = upsertSavedSSHEnvironment(remembered, {
      environment_id: '',
      label: 'SSH Lab',
      ssh_destination: 'devbox',
      ssh_port: 2222,
      remote_install_dir: 'remote_default',
      source: 'saved',
      last_used_at_ms: 500,
    });

    expect(saved.saved_ssh_environments).toEqual([
      {
        id: 'ssh:devbox:2222:remote_default',
        label: 'SSH Lab',
        ssh_destination: 'devbox',
        ssh_port: 2222,
        remote_install_dir: 'remote_default',
        source: 'saved',
        last_used_at_ms: 500,
      },
    ]);

    expect(deleteSavedSSHEnvironment(saved, 'ssh:devbox:2222:remote_default').saved_ssh_environments).toEqual([]);
  });

  it('remembers recent environment targets through the saved catalog', () => {
    const preferences = rememberRecentExternalLocalUITarget(
      rememberRecentExternalLocalUITarget(
        rememberRecentExternalLocalUITarget(defaultDesktopPreferences(), 'http://192.168.1.11:24000/_redeven_proxy/env/'),
        'http://192.168.1.12:24000/',
      ),
      'http://192.168.1.11:24000/',
    );

    expect(preferences.saved_environments).toEqual([
      expect.objectContaining({
        id: 'http://192.168.1.11:24000/',
        local_ui_url: 'http://192.168.1.11:24000/',
        source: 'recent_auto',
      }),
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        local_ui_url: 'http://192.168.1.12:24000/',
        source: 'recent_auto',
      }),
    ]);
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

  it('derives recent urls from saved environments ordered by last use', () => {
    expect(deriveRecentExternalLocalUIURLs([
      {
        id: 'env-c',
        label: 'C',
        local_ui_url: 'http://192.168.1.13:24000/',
        source: 'saved',
        last_used_at_ms: 10,
      },
      {
        id: 'env-a',
        label: 'A',
        local_ui_url: 'http://192.168.1.11:24000/',
        source: 'saved',
        last_used_at_ms: 30,
      },
      {
        id: 'env-b',
        label: 'B',
        local_ui_url: 'http://192.168.1.12:24000/',
        source: 'recent_auto',
        last_used_at_ms: 20,
      },
    ])).toEqual([
      'http://192.168.1.11:24000/',
      'http://192.168.1.12:24000/',
      'http://192.168.1.13:24000/',
    ]);
  });

  it('serializes local-environment settings into a settings draft', () => {
    expect(desktopPreferencesToDraft({
      local_ui_bind: '0.0.0.0:23998',
      local_ui_password: 'secret',
      local_ui_password_configured: true,
      pending_bootstrap: {
        controlplane_url: 'https://region.example.invalid',
        env_id: 'env_123',
        env_token: 'token-123',
      },
      saved_environments: [
        {
          id: 'http://192.168.1.11:24000/',
          label: 'Laptop',
          local_ui_url: 'http://192.168.1.11:24000/',
          source: 'saved',
          last_used_at_ms: 100,
        },
      ],
      saved_ssh_environments: [],
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
      control_planes: [],
    })).toEqual({
      local_ui_bind: '0.0.0.0:23998',
      local_ui_password: '',
      local_ui_password_mode: 'keep',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });
  });

  it('clears pending bootstrap without changing the saved environments', () => {
    expect(clearPendingBootstrap({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_configured: false,
      pending_bootstrap: {
        controlplane_url: 'https://region.example.invalid',
        env_id: 'env_123',
        env_token: 'token-123',
      },
      saved_environments: [
        {
          id: 'http://192.168.1.11:24000/',
          label: 'Laptop',
          local_ui_url: 'http://192.168.1.11:24000/',
          source: 'saved',
          last_used_at_ms: 100,
        },
      ],
      saved_ssh_environments: [],
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
      control_planes: [],
    })).toEqual({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_configured: false,
      pending_bootstrap: null,
      saved_environments: [
        {
          id: 'http://192.168.1.11:24000/',
          label: 'Laptop',
          local_ui_url: 'http://192.168.1.11:24000/',
          source: 'saved',
          last_used_at_ms: 100,
        },
      ],
      saved_ssh_environments: [],
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
      control_planes: [],
    });
  });

  it('includes local-environment startup inputs in the managed launch key', () => {
    const left = managedDesktopLaunchKey({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_configured: false,
      pending_bootstrap: null,
      saved_environments: [],
      saved_ssh_environments: [],
      recent_external_local_ui_urls: [],
      control_planes: [],
    });
    const right = managedDesktopLaunchKey({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'secret',
      local_ui_password_configured: true,
      pending_bootstrap: null,
      saved_environments: [],
      saved_ssh_environments: [],
      recent_external_local_ui_urls: [],
      control_planes: [],
    });

    expect(left).not.toBe(right);
  });

  it('keeps an existing stored password when the write-only draft stays blank', () => {
    expect(validateDesktopSettingsDraft({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: '',
      local_ui_password_mode: 'keep',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, {
      currentLocalUIPassword: 'secret',
      currentLocalUIPasswordConfigured: true,
    })).toEqual({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'secret',
      local_ui_password_configured: true,
      pending_bootstrap: null,
      saved_environments: [],
      saved_ssh_environments: [],
      recent_external_local_ui_urls: [],
      control_planes: [],
    });
  });

  it('clears an existing stored password only when explicitly requested', () => {
    expect(validateDesktopSettingsDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_mode: 'clear',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    }, {
      currentLocalUIPassword: 'secret',
      currentLocalUIPasswordConfigured: true,
    })).toEqual({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_configured: false,
      pending_bootstrap: null,
      saved_environments: [],
      saved_ssh_environments: [],
      recent_external_local_ui_urls: [],
      control_planes: [],
    });
  });
});
