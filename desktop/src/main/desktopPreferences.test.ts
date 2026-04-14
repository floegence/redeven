import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeDesktopControlPlaneProvider } from '../shared/controlPlaneProvider';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import {
  testDesktopPreferences,
  testManagedAccess,
  testManagedLocalEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
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
  setManagedEnvironmentPinned,
  setSavedEnvironmentPinned,
  setSavedSSHEnvironmentPinned,
  upsertManagedLocalEnvironment,
  upsertSavedControlPlane,
  upsertSavedEnvironment,
  upsertSavedSSHEnvironment,
  validateDesktopSettingsDraft,
} from './desktopPreferences';

function draft(overrides: Partial<DesktopSettingsDraft> = {}): DesktopSettingsDraft {
  return {
    local_ui_bind: 'localhost:23998',
    local_ui_password: '',
    local_ui_password_mode: 'replace',
    ...overrides,
  };
}

async function withTempPreferencesDir(testFn: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preferences-test-'));
  const previousStateRoot = process.env.REDEVEN_STATE_ROOT;
  process.env.REDEVEN_STATE_ROOT = path.join(root, '.redeven');
  try {
    await testFn(root);
  } finally {
    if (previousStateRoot === undefined) {
      delete process.env.REDEVEN_STATE_ROOT;
    } else {
      process.env.REDEVEN_STATE_ROOT = previousStateRoot;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('desktopPreferences', () => {
  it('validates a loopback-only draft without a password', () => {
    expect(validateDesktopSettingsDraft(draft())).toEqual({
      local_ui_bind: 'localhost:23998',
      local_ui_password: '',
      local_ui_password_configured: false,
    });
  });

  it('requires a password for non-loopback binds', () => {
    expect(() => validateDesktopSettingsDraft(draft({
      local_ui_bind: '0.0.0.0:23998',
    }))).toThrow('Non-loopback Local UI binds require a Local UI password.');
  });

  it('keeps or clears the stored password according to the write-only mode', () => {
    expect(validateDesktopSettingsDraft(draft({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password_mode: 'keep',
    }), {
      currentLocalUIPassword: 'secret',
      currentLocalUIPasswordConfigured: true,
    })).toEqual(expect.objectContaining({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'secret',
      local_ui_password_configured: true,
    }));

    expect(validateDesktopSettingsDraft(draft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password_mode: 'clear',
    }), {
      currentLocalUIPassword: 'secret',
      currentLocalUIPasswordConfigured: true,
    })).toEqual(expect.objectContaining({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_configured: false,
    }));
  });

  it('round-trips preferences through the local files with saved environments and SSH targets', async () => {
    await withTempPreferencesDir(async (root) => {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const preferences: DesktopPreferences = testDesktopPreferences({
        managed_environments: [
          testManagedLocalEnvironment('default', {
            access: testManagedAccess({
              local_ui_bind: '0.0.0.0:23998',
              local_ui_password: 'super-secret',
              local_ui_password_configured: true,
            }),
          }),
        ],
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            source: 'saved',
            pinned: true,
            last_used_at_ms: 100,
          },
        ],
        saved_ssh_environments: [
          {
            id: 'ssh:devbox:2222:remote_default',
            label: 'SSH Lab',
            ssh_destination: 'devbox',
            ssh_port: 2222,
            remote_install_dir: 'remote_default',
            bootstrap_strategy: 'desktop_upload',
            release_base_url: 'https://mirror.example.invalid/releases',
            source: 'saved',
            pinned: false,
            last_used_at_ms: 90,
          },
        ],
        recent_external_local_ui_urls: ['http://192.168.1.12:24000/'],
      });

      await saveDesktopPreferences(paths, preferences, codec);
      await expect(loadDesktopPreferences(paths, codec)).resolves.toEqual(preferences);
    });
  });

  it('stores control plane refresh tokens only in secrets while keeping account summaries in preferences', async () => {
    const provider = normalizeDesktopControlPlaneProvider({
      protocol_version: 'rcpp-v1',
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://region.example.invalid',
      documentation_url: 'https://region.example.invalid/docs/provider-protocol',
    });
    expect(provider).not.toBeNull();

    await withTempPreferencesDir(async (root) => {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const preferences = upsertSavedControlPlane(defaultDesktopPreferences(), {
        provider: provider!,
        account: {
          provider_id: provider!.provider_id,
          provider_origin: provider!.provider_origin,
          display_name: provider!.display_name,
          user_public_id: 'user_demo',
          user_display_name: 'Demo User',
          authorization_expires_at_unix_ms: 1_770_000_000_000,
        },
        environments: [{
          provider_id: provider!.provider_id,
          provider_origin: provider!.provider_origin,
          env_public_id: 'env_demo',
          label: 'Demo Environment',
          description: 'team sandbox',
          namespace_public_id: 'ns_demo',
          namespace_name: 'Demo Team',
          status: 'online',
          lifecycle_status: 'active',
          last_seen_at_unix_ms: 123,
        }],
        refresh_token: 'refresh-demo-token',
        display_label: 'Demo Portal',
        last_synced_at_ms: 456,
      });

      await saveDesktopPreferences(paths, preferences, codec);

      const preferencesFile = JSON.parse(await fs.readFile(paths.preferencesFile, 'utf8')) as {
        control_planes?: Array<{ account?: Record<string, unknown> }>;
      };
      const providerCatalogDir = path.join(paths.stateRoot, 'catalog', 'providers');
      const providerCatalogFiles = await fs.readdir(providerCatalogDir);
      expect(providerCatalogFiles).toHaveLength(1);
      const providerCatalogFile = JSON.parse(
        await fs.readFile(path.join(providerCatalogDir, providerCatalogFiles[0]!), 'utf8'),
      ) as { account?: Record<string, unknown> };
      const secretsFile = JSON.parse(await fs.readFile(paths.secretsFile, 'utf8')) as {
        control_planes?: Array<{ refresh_token?: { data?: string } }>;
      };

      expect(JSON.stringify(preferencesFile)).not.toContain('refresh-demo-token');
      expect(providerCatalogFile.account).toEqual({
        user_public_id: 'user_demo',
        user_display_name: 'Demo User',
        authorization_expires_at_unix_ms: 1_770_000_000_000,
      });
      expect(secretsFile.control_planes?.[0]?.refresh_token?.data).toBe('refresh-demo-token');

      const loaded = await loadDesktopPreferences(paths, codec);
      expect(loaded).toEqual(expect.objectContaining({
        saved_environments: [],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [],
        control_plane_refresh_tokens: preferences.control_plane_refresh_tokens,
        control_planes: preferences.control_planes,
      }));
      expect(loaded.managed_environments).toEqual([
        expect.objectContaining({
          id: 'local:default',
          identity: { kind: 'provisional_local', local_name: 'default' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local', name: 'default' },
          }),
        }),
      ]);
    });
  });

  it('preserves an existing encoded password when saving configured write-only state', async () => {
    await withTempPreferencesDir(async (root) => {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const initialAccess = validateDesktopSettingsDraft(draft({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'super-secret',
      }));
      const initial = testDesktopPreferences({
        managed_environments: [
          testManagedLocalEnvironment('default', {
            access: initialAccess,
          }),
        ],
      });

      await saveDesktopPreferences(paths, initial, codec);
      await saveDesktopPreferences(paths, {
        ...initial,
        managed_environments: [
          testManagedLocalEnvironment('default', {
            access: {
              ...initialAccess,
              local_ui_password: '',
              local_ui_password_configured: true,
            },
          }),
        ],
      }, codec);

      const loaded = await loadDesktopPreferences(paths, codec);
      expect(loaded).toEqual(expect.objectContaining({
        saved_environments: [],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [],
        control_plane_refresh_tokens: {},
        control_planes: [],
      }));
      expect(loaded.managed_environments).toEqual([
        expect.objectContaining({
          id: 'local:default',
          label: 'Local Environment',
          identity: { kind: 'provisional_local', local_name: 'default' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local', name: 'default' },
            access: {
              local_ui_bind: '0.0.0.0:24000',
              local_ui_password: 'super-secret',
              local_ui_password_configured: true,
            },
          }),
        }),
      ]);
    });
  });

  it('falls back to defaults when the preferences json is malformed', async () => {
    await withTempPreferencesDir(async (root) => {
      const paths = defaultDesktopPreferencesPaths(root);
      await fs.writeFile(paths.preferencesFile, '{not valid json', 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual(expect.objectContaining({
        saved_environments: [],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [],
        control_plane_refresh_tokens: {},
        control_planes: [],
      }));
      expect(loaded.managed_environments).toEqual([
        expect.objectContaining({
          id: 'local:default',
          label: 'Local Environment',
          identity: { kind: 'provisional_local', local_name: 'default' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local', name: 'default' },
            access: {
              local_ui_bind: 'localhost:23998',
              local_ui_password: '',
              local_ui_password_configured: false,
            },
          }),
        }),
      ]);
    });
  });

  it('drops malformed secrets while keeping valid non-secret preferences', async () => {
    await withTempPreferencesDir(async (root) => {
      const paths = defaultDesktopPreferencesPaths(root);
      await fs.writeFile(paths.preferencesFile, JSON.stringify({
        version: 8,
        local_ui_bind: '127.0.0.1:0',
      }), 'utf8');
      await fs.writeFile(paths.secretsFile, '{"broken"', 'utf8');

      const loaded = await loadDesktopPreferences(paths, createPlaintextSecretCodec());
      expect(loaded).toEqual(expect.objectContaining({
        saved_environments: [],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [],
        control_plane_refresh_tokens: {},
        control_planes: [],
      }));
      expect(loaded.managed_environments).toEqual([
        expect.objectContaining({
          id: 'local:default',
          identity: { kind: 'provisional_local', local_name: 'default' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local', name: 'default' },
            access: {
              local_ui_bind: '127.0.0.1:0',
              local_ui_password: '',
              local_ui_password_configured: false,
            },
          }),
        }),
      ]);
    });
  });

  it('recovers invalid stored values by falling back to valid defaults and normalized URLs', async () => {
    await withTempPreferencesDir(async (root) => {
      const paths = defaultDesktopPreferencesPaths(root);
      await fs.writeFile(paths.preferencesFile, JSON.stringify({
        version: 8,
        local_ui_bind: 'bad-bind',
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
      expect(loaded).toEqual(expect.objectContaining({
        saved_environments: [
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Recovered target',
            local_ui_url: 'http://192.168.1.11:24000/',
            source: 'saved',
            pinned: false,
            last_used_at_ms: 20,
          },
        ],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
        control_plane_refresh_tokens: {},
        control_planes: [],
      }));
      expect(loaded.managed_environments).toEqual([
        expect.objectContaining({
          id: 'local:default',
          identity: { kind: 'provisional_local', local_name: 'default' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local', name: 'default' },
            access: {
              local_ui_bind: 'localhost:23998',
              local_ui_password: '',
              local_ui_password_configured: false,
            },
          }),
        }),
      ]);
    });
  });

  it('migrates legacy recent URLs into saved environments', () => {
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
        pinned: false,
        last_used_at_ms: 2,
      },
      {
        id: 'http://192.168.1.12:24000/',
        label: '192.168.1.12:24000',
        local_ui_url: 'http://192.168.1.12:24000/',
        source: 'recent_auto',
        pinned: false,
        last_used_at_ms: 1,
      },
    ]);
  });

  it('upserts, promotes, orders, and deletes saved environments while deriving recent URLs', () => {
    const remembered = rememberRecentExternalLocalUITarget(defaultDesktopPreferences(), 'http://192.168.1.11:24000/');
    const updated = upsertSavedEnvironment(remembered, {
      environment_id: desktopEnvironmentID('http://192.168.1.11:24000/'),
      label: 'Laptop Updated',
      local_ui_url: 'http://192.168.1.11:24000/',
      source: 'saved',
      last_used_at_ms: 300,
    });
    const second = upsertSavedEnvironment(updated, {
      environment_id: '',
      label: '',
      local_ui_url: 'http://192.168.1.12:24000/_redeven_proxy/env/',
      last_used_at_ms: 200,
    });

    expect(second.saved_environments).toEqual([
      {
        id: 'http://192.168.1.11:24000/',
        label: 'Laptop Updated',
        local_ui_url: 'http://192.168.1.11:24000/',
        source: 'saved',
        pinned: false,
        last_used_at_ms: 300,
      },
      {
        id: 'http://192.168.1.12:24000/',
        label: defaultSavedEnvironmentLabel('http://192.168.1.12:24000/'),
        local_ui_url: 'http://192.168.1.12:24000/',
        source: 'saved',
        pinned: false,
        last_used_at_ms: 200,
      },
    ]);
    expect(second.recent_external_local_ui_urls).toEqual([
      'http://192.168.1.11:24000/',
      'http://192.168.1.12:24000/',
    ]);

    expect(deleteSavedEnvironment(second, 'http://192.168.1.12:24000/').saved_environments).toEqual([
      {
        id: 'http://192.168.1.11:24000/',
        label: 'Laptop Updated',
        local_ui_url: 'http://192.168.1.11:24000/',
        source: 'saved',
        pinned: false,
        last_used_at_ms: 300,
      },
    ]);
  });

  it('remembers, saves, and deletes SSH environments through the saved catalog', () => {
    const remembered = rememberRecentSSHEnvironmentTarget(defaultDesktopPreferences(), {
      ssh_destination: 'devbox',
      ssh_port: 2222,
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'auto',
      release_base_url: '',
      label: 'Lab',
    });

    expect(remembered.saved_ssh_environments).toEqual([
      {
        id: 'ssh:devbox:2222:remote_default',
        label: 'Lab',
        ssh_destination: 'devbox',
        ssh_port: 2222,
        remote_install_dir: 'remote_default',
        bootstrap_strategy: 'auto',
        release_base_url: '',
        source: 'recent_auto',
        pinned: false,
        last_used_at_ms: expect.any(Number),
      },
    ]);

    const saved = upsertSavedSSHEnvironment(remembered, {
      environment_id: '',
      label: 'SSH Lab',
      ssh_destination: 'devbox',
      ssh_port: 2222,
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: 'https://mirror.example.invalid/releases',
      source: 'saved',
      last_used_at_ms: 500,
    });

    expect(deleteSavedSSHEnvironment(saved, 'ssh:devbox:2222:remote_default').saved_ssh_environments).toEqual([]);
  });

  it('persists pin state for managed, URL, and SSH environments', () => {
    const base = testDesktopPreferences({
      managed_environments: [testManagedLocalEnvironment('default', { pinned: false })],
      saved_environments: [{
        id: 'http://192.168.1.12:24000/',
        label: 'Staging',
        local_ui_url: 'http://192.168.1.12:24000/',
        source: 'saved',
        pinned: false,
        last_used_at_ms: 20,
      }],
      saved_ssh_environments: [{
        id: 'ssh:devbox:2222:remote_default',
        label: 'SSH Lab',
        ssh_destination: 'devbox',
        ssh_port: 2222,
        remote_install_dir: 'remote_default',
        bootstrap_strategy: 'desktop_upload',
        release_base_url: '',
        source: 'saved',
        pinned: false,
        last_used_at_ms: 10,
      }],
    });

    const managedPinned = setManagedEnvironmentPinned(base, 'local:default', true);
    const urlPinned = setSavedEnvironmentPinned(managedPinned, {
      environment_id: 'http://192.168.1.12:24000/',
      label: 'Staging',
      local_ui_url: 'http://192.168.1.12:24000/',
      pinned: true,
    });
    const sshPinned = setSavedSSHEnvironmentPinned(urlPinned, {
      environment_id: 'ssh:devbox:2222:remote_default',
      label: 'SSH Lab',
      pinned: true,
      ssh_destination: 'devbox',
      ssh_port: 2222,
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
    });

    expect(sshPinned.managed_environments[0]).toEqual(expect.objectContaining({ pinned: true }));
    expect(sshPinned.saved_environments[0]).toEqual(expect.objectContaining({ pinned: true }));
    expect(sshPinned.saved_ssh_environments[0]).toEqual(expect.objectContaining({ pinned: true }));
  });

  it('normalizes recent URLs and derives them from saved environments ordered by last use', () => {
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

    expect(deriveRecentExternalLocalUIURLs([
      {
        id: 'env-c',
        label: 'C',
        local_ui_url: 'http://192.168.1.13:24000/',
        source: 'saved',
        pinned: false,
        last_used_at_ms: 10,
      },
      {
        id: 'env-a',
        label: 'A',
        local_ui_url: 'http://192.168.1.11:24000/',
        source: 'saved',
        pinned: true,
        last_used_at_ms: 30,
      },
      {
        id: 'env-b',
        label: 'B',
        local_ui_url: 'http://192.168.1.12:24000/',
        source: 'recent_auto',
        pinned: false,
        last_used_at_ms: 20,
      },
    ])).toEqual([
      'http://192.168.1.11:24000/',
      'http://192.168.1.12:24000/',
      'http://192.168.1.13:24000/',
    ]);
  });

  it('binds a local environment to a control-plane identity while preserving its record id', () => {
    const existing = testManagedLocalEnvironment('dev-a');
    const next = upsertManagedLocalEnvironment(testDesktopPreferences({
      managed_environments: [existing],
    }), {
      environment_id: existing.id,
      name: 'dev-a',
      label: 'Dev A',
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
      provider_binding_enabled: true,
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
      env_public_id: 'env_demo',
      preferred_open_route: 'remote_desktop',
    });

    expect(next.managed_environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: existing.id,
        label: 'Dev A',
        preferred_open_route: 'remote_desktop',
        identity: {
          kind: 'provider',
          provider_origin: 'https://cp.example.invalid',
          provider_id: 'redeven_portal',
          env_public_id: 'env_demo',
        },
        provider_binding: expect.objectContaining({
          provider_origin: 'https://cp.example.invalid',
          provider_id: 'redeven_portal',
          env_public_id: 'env_demo',
        }),
        local_hosting: expect.objectContaining({
          scope: expect.objectContaining({
            kind: 'controlplane',
            env_public_id: 'env_demo',
          }),
        }),
      }),
    ]));
  });

  it('can clear a control-plane binding and resets the preferred open route to auto', () => {
    const existing = testManagedLocalEnvironment('dev-a');
    const bound = upsertManagedLocalEnvironment(testDesktopPreferences({
      managed_environments: [existing],
    }), {
      environment_id: existing.id,
      name: 'dev-a',
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
      provider_binding_enabled: true,
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
      env_public_id: 'env_demo',
      preferred_open_route: 'remote_desktop',
    });

    const cleared = upsertManagedLocalEnvironment(bound, {
      environment_id: existing.id,
      name: 'dev-a',
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
      provider_binding_enabled: false,
      preferred_open_route: 'remote_desktop',
    });

    const clearedEnvironment = cleared.managed_environments.find((environment) => environment.id === existing.id);

    expect(clearedEnvironment).toEqual(expect.objectContaining({
      id: existing.id,
      preferred_open_route: 'auto',
      local_hosting: expect.objectContaining({
        scope: {
          kind: 'local',
          name: 'dev-a',
        },
      }),
    }));
    expect(clearedEnvironment?.provider_binding).toBeUndefined();
  });

  it('serializes local-environment settings into a settings draft', () => {
    expect(desktopPreferencesToDraft(testDesktopPreferences({
      managed_environments: [
        testManagedLocalEnvironment('default', {
          access: {
            local_ui_bind: '0.0.0.0:23998',
            local_ui_password: 'secret',
            local_ui_password_configured: true,
          },
        }),
      ],
    }))).toEqual({
      local_ui_bind: '0.0.0.0:23998',
      local_ui_password: '',
      local_ui_password_mode: 'keep',
    });
  });

  it('includes local-environment startup inputs in the managed launch key', () => {
    const left = managedDesktopLaunchKey(testDesktopPreferences({
      managed_environments: [
        testManagedLocalEnvironment('default', {
          access: {
            local_ui_bind: '127.0.0.1:0',
            local_ui_password: '',
            local_ui_password_configured: false,
          },
        }),
      ],
    }));
    const right = managedDesktopLaunchKey(testDesktopPreferences({
      managed_environments: [
        testManagedLocalEnvironment('default', {
          access: {
            local_ui_bind: '0.0.0.0:24000',
            local_ui_password: 'secret',
            local_ui_password_configured: true,
          },
        }),
      ],
    }));

    expect(left).not.toBe(right);
  });
});
