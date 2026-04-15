import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  desktopControlPlaneKey,
  normalizeDesktopControlPlaneProvider,
} from '../shared/controlPlaneProvider';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import { managedEnvironmentLocalAccess } from '../shared/desktopManagedEnvironment';
import {
  testDesktopPreferences,
  testManagedAccess,
  testManagedControlPlaneEnvironment,
  testManagedLocalEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  controlPlaneManagedStateLayout,
  controlPlaneProviderKeyForOrigin,
} from './statePaths';
import {
  createPlaintextSecretCodec,
  deleteManagedEnvironment,
  type DesktopPreferences,
  defaultDesktopPreferences,
  defaultDesktopPreferencesPaths,
  defaultSavedEnvironmentLabel,
  deleteSavedControlPlane,
  deleteSavedEnvironment,
  deleteSavedSSHEnvironment,
  deriveRecentExternalLocalUIURLs,
  desktopEnvironmentID,
  desktopPreferencesToDraft,
  loadDesktopPreferences,
  managedDesktopLaunchKey,
  normalizeRecentExternalLocalUIURLs,
  normalizeSavedEnvironments,
  rememberManagedEnvironmentUse,
  rememberRecentExternalLocalUITarget,
  rememberRecentSSHEnvironmentTarget,
  saveDesktopPreferences,
  setManagedEnvironmentPinned,
  setSavedEnvironmentPinned,
  setSavedSSHEnvironmentPinned,
  upsertManagedEnvironment,
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

function buildTestControlPlaneProvider(providerOrigin = 'https://cp.example.invalid') {
  const provider = normalizeDesktopControlPlaneProvider({
    protocol_version: 'rcpp-v1',
    provider_id: 'redeven_portal',
    display_name: 'Redeven Portal',
    provider_origin: providerOrigin,
    documentation_url: `${providerOrigin}/docs/provider-protocol`,
  });
  if (!provider) {
    throw new Error('Expected test provider to normalize.');
  }
  return provider;
}

function buildTestControlPlaneAccount(provider = buildTestControlPlaneProvider()) {
  return {
    provider_id: provider.provider_id,
    provider_origin: provider.provider_origin,
    display_name: provider.display_name,
    user_public_id: 'user_demo',
    user_display_name: 'Demo User',
    authorization_expires_at_unix_ms: 1_770_000_000_000,
  };
}

function buildTestProviderEnvironment(
  provider = buildTestControlPlaneProvider(),
  envPublicID = 'env_demo',
  overrides: Partial<{
    label: string;
    description: string;
    namespace_public_id: string;
    namespace_name: string;
    status: string;
    lifecycle_status: string;
    last_seen_at_unix_ms: number;
  }> = {},
) {
  return {
    provider_id: provider.provider_id,
    provider_origin: provider.provider_origin,
    env_public_id: envPublicID,
    label: overrides.label ?? 'Demo Environment',
    description: overrides.description ?? 'team sandbox',
    namespace_public_id: overrides.namespace_public_id ?? 'ns_demo',
    namespace_name: overrides.namespace_name ?? 'Demo Team',
    status: overrides.status ?? 'online',
    lifecycle_status: overrides.lifecycle_status ?? 'active',
    last_seen_at_unix_ms: overrides.last_seen_at_unix_ms ?? 123,
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
      expect(loaded.managed_environments).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'local:default',
          identity: { kind: 'provisional_local', local_name: 'default' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local', name: 'default' },
          }),
        }),
        expect.objectContaining({
          id: 'cp:https%3A%2F%2Fregion.example.invalid:env:env_demo',
          identity: {
            kind: 'provider',
            provider_origin: 'https://region.example.invalid',
            provider_id: 'redeven_portal',
            env_public_id: 'env_demo',
          },
          provider_binding: expect.objectContaining({
            provider_origin: 'https://region.example.invalid',
            provider_id: 'redeven_portal',
            env_public_id: 'env_demo',
          }),
        }),
      ]));
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

  it('remembers the last-used managed route when a user opens a specific managed path', () => {
    const dualRoute = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      preferredOpenRoute: 'local_host',
    });
    const remembered = rememberManagedEnvironmentUse(testDesktopPreferences({
      managed_environments: [dualRoute],
    }), dualRoute.id, 'remote_desktop');

    expect(remembered.managed_environments.find((environment) => environment.id === dualRoute.id)).toEqual(
      expect.objectContaining({
        preferred_open_route: 'remote_desktop',
        last_used_at_ms: expect.any(Number),
      }),
    );
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

  it('materializes provider environments into the managed catalog on control-plane sync', () => {
    const provider = buildTestControlPlaneProvider();
    const next = upsertSavedControlPlane(testDesktopPreferences(), {
      provider,
      account: buildTestControlPlaneAccount(provider),
      environments: [buildTestProviderEnvironment(provider)],
      refresh_token: 'refresh-demo-token',
      display_label: 'Demo Portal',
      last_synced_at_ms: 456,
    });

    const providerEntry = next.managed_environments.find((environment) => environment.id !== 'local:default');

    expect(providerEntry).toEqual(expect.objectContaining({
      label: 'Demo Environment',
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
    }));
    expect(providerEntry?.local_hosting).toBeUndefined();
  });

  it('merges provider refresh data into an existing dual-route environment without dropping local state', () => {
    const provider = buildTestControlPlaneProvider();
    const existing = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Desktop Label',
      preferredOpenRoute: 'local_host',
      access: {
        local_ui_bind: '127.0.0.1:0',
      },
    });

    const next = upsertSavedControlPlane(testDesktopPreferences({
      managed_environments: [existing],
    }), {
      provider,
      account: buildTestControlPlaneAccount(provider),
      environments: [buildTestProviderEnvironment(provider, 'env_demo', {
        label: 'Provider Label',
        status: 'offline',
        lifecycle_status: 'suspended',
      })],
      refresh_token: 'refresh-demo-token',
      display_label: 'Demo Portal',
      last_synced_at_ms: 456,
    });

    const merged = next.managed_environments.find((environment) => environment.id === existing.id);

    expect(merged).toEqual(expect.objectContaining({
      id: existing.id,
      label: 'Desktop Label',
      preferred_open_route: 'local_host',
      local_hosting: existing.local_hosting,
      provider_binding: expect.objectContaining({
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'redeven_portal',
        env_public_id: 'env_demo',
      }),
    }));
  });

  it('upserts one managed environment with both local hosting and provider binding', () => {
    const next = upsertManagedEnvironment(testDesktopPreferences(), {
      name: 'dev-a',
      label: 'Desktop Demo',
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:24001',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      }),
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
      env_public_id: 'env_demo',
    });

    const managed = next.managed_environments.find((environment) => (
      environment.provider_binding?.provider_origin === 'https://cp.example.invalid'
      && environment.provider_binding?.env_public_id === 'env_demo'
    ));

    expect(managed).toEqual(expect.objectContaining({
      id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
      label: 'Desktop Demo',
      identity: expect.objectContaining({
        kind: 'provider',
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'redeven_portal',
        env_public_id: 'env_demo',
      }),
      local_hosting: expect.objectContaining({
        scope: expect.objectContaining({
          kind: 'controlplane',
          provider_origin: 'https://cp.example.invalid',
          env_public_id: 'env_demo',
        }),
        access: expect.objectContaining({
          local_ui_bind: '127.0.0.1:24001',
          local_ui_password: 'secret',
          local_ui_password_configured: true,
        }),
      }),
      provider_binding: expect.objectContaining({
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'redeven_portal',
        env_public_id: 'env_demo',
      }),
    }));
  });

  it('promotes a local-only managed environment into a canonical control-plane identity without duplicates', () => {
    const existingLocal = testManagedLocalEnvironment('lab', {
      label: 'Local Lab',
      access: {
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      },
    });
    const existingRemoteOnly = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_lab', {
      localHosting: false,
      label: 'Remote Lab',
    });

    const next = upsertManagedEnvironment(testDesktopPreferences({
      managed_environments: [existingLocal, existingRemoteOnly],
    }), {
      environment_id: existingLocal.id,
      name: 'lab',
      label: 'Unified Lab',
      access: managedEnvironmentLocalAccess(existingLocal),
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
      env_public_id: 'env_lab',
    });

    const providerEntries = next.managed_environments.filter((environment) => (
      environment.provider_binding?.provider_origin === 'https://cp.example.invalid'
      && environment.provider_binding?.env_public_id === 'env_lab'
    ));

    expect(providerEntries).toHaveLength(1);
    expect(providerEntries[0]).toEqual(expect.objectContaining({
      id: existingRemoteOnly.id,
      label: 'Unified Lab',
      local_hosting: expect.objectContaining({
        scope: expect.objectContaining({
          kind: 'controlplane',
          provider_origin: 'https://cp.example.invalid',
          env_public_id: 'env_lab',
        }),
        access: expect.objectContaining({
          local_ui_bind: '0.0.0.0:24000',
          local_ui_password: 'secret',
          local_ui_password_configured: true,
        }),
      }),
    }));
    expect(next.managed_environments.some((environment) => environment.id === existingLocal.id)).toBe(false);
  });

  it('keeps the existing local scope when editing a local-only environment label', () => {
    const existing = testManagedLocalEnvironment('lab', {
      label: 'Lab',
      stateDir: '/tmp/redeven-lab',
    });

    const next = upsertManagedEnvironment(testDesktopPreferences({
      managed_environments: [existing],
    }), {
      environment_id: existing.id,
      name: 'lab',
      label: 'Renamed Lab',
      access: managedEnvironmentLocalAccess(existing),
    });

    expect(next.managed_environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: existing.id,
        label: 'Renamed Lab',
        local_hosting: expect.objectContaining({
          scope: expect.objectContaining({
            kind: 'local',
            name: 'lab',
          }),
          state_dir: '/tmp/redeven-lab',
        }),
      }),
    ]));
  });

  it('deletes a local-only managed environment and returns its local state directory', () => {
    const removable = testManagedLocalEnvironment('lab');

    const result = deleteManagedEnvironment(testDesktopPreferences({
      managed_environments: [
        testManagedLocalEnvironment('default'),
        removable,
      ],
    }), removable.id);

    expect(result.deleted_environment?.id).toBe(removable.id);
    expect(result.deleted_state_dir).toBe(removable.local_hosting?.state_dir);
    expect(result.preferences.managed_environments.some((environment) => environment.id === removable.id)).toBe(false);
  });

  it('deleting a dual-route managed environment keeps the remote control-plane entry while removing local hosting', () => {
    const dualRoute = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_dual_route', {
      access: {
        local_ui_bind: '127.0.0.1:24000',
      },
    });

    const result = deleteManagedEnvironment(testDesktopPreferences({
      managed_environments: [dualRoute],
    }), dualRoute.id);

    const retained = result.preferences.managed_environments.find((environment) => (
      environment.provider_binding?.provider_origin === 'https://cp.example.invalid'
      && environment.provider_binding?.env_public_id === 'env_dual_route'
    ));

    expect(result.deleted_environment?.id).toBe(dualRoute.id);
    expect(result.deleted_state_dir).toBe(dualRoute.local_hosting?.state_dir);
    expect(retained).toEqual(expect.objectContaining({
      id: dualRoute.id,
      label: dualRoute.label,
      provider_binding: expect.objectContaining({
        provider_origin: 'https://cp.example.invalid',
        env_public_id: 'env_dual_route',
      }),
    }));
    expect(retained?.local_hosting).toBeUndefined();
  });

  it('repairs a legacy provider-backed local environment during control-plane sync without duplicating it', () => {
    const provider = buildTestControlPlaneProvider();
    const legacyProviderID = controlPlaneProviderKeyForOrigin(provider.provider_origin);
    const existing = testManagedControlPlaneEnvironment(provider.provider_origin, 'env_demo', {
      providerID: legacyProviderID,
      label: 'Desktop Label',
      preferredOpenRoute: 'local_host',
      access: {
        local_ui_bind: '127.0.0.1:0',
      },
    });

    const next = upsertSavedControlPlane(testDesktopPreferences({
      managed_environments: [existing],
    }), {
      provider,
      account: buildTestControlPlaneAccount(provider),
      environments: [buildTestProviderEnvironment(provider)],
      refresh_token: 'refresh-demo-token',
      display_label: 'Demo Portal',
      last_synced_at_ms: 456,
    });

    const repairedEntries = next.managed_environments.filter((environment) => (
      environment.provider_binding?.provider_origin === provider.provider_origin
      && environment.provider_binding?.env_public_id === 'env_demo'
    ));

    expect(repairedEntries).toHaveLength(1);
    expect(repairedEntries[0]).toEqual(expect.objectContaining({
      id: existing.id,
      label: 'Desktop Label',
      preferred_open_route: 'local_host',
      local_hosting: existing.local_hosting,
      provider_binding: expect.objectContaining({
        provider_origin: provider.provider_origin,
        provider_id: provider.provider_id,
        env_public_id: 'env_demo',
      }),
      identity: {
        kind: 'provider',
        provider_origin: provider.provider_origin,
        provider_id: provider.provider_id,
        env_public_id: 'env_demo',
      },
    }));
  });

  it('drops revoked remote-only entries during provider refresh while keeping local-hosted environments', () => {
    const provider = buildTestControlPlaneProvider();
    const remoteOnly = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_removed', {
      localHosting: false,
    });
    const dualRoute = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_kept');

    const next = upsertSavedControlPlane(testDesktopPreferences({
      managed_environments: [remoteOnly, dualRoute],
    }), {
      provider,
      account: buildTestControlPlaneAccount(provider),
      environments: [],
      refresh_token: 'refresh-demo-token',
      display_label: 'Demo Portal',
      last_synced_at_ms: 456,
    });

    expect(next.managed_environments.some((environment) => environment.id === remoteOnly.id)).toBe(false);
    expect(next.managed_environments.find((environment) => environment.id === dualRoute.id)).toEqual(dualRoute);
  });

  it('deleting a control plane removes remote-only catalog entries and keeps dual-route local hosts', () => {
    const preferences = testDesktopPreferences({
      managed_environments: [
        testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_removed', { localHosting: false }),
        testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_kept'),
      ],
      control_plane_refresh_tokens: {
        'https://cp.example.invalid|redeven_portal': 'refresh-demo-token',
      },
      control_planes: [{
        provider: buildTestControlPlaneProvider(),
        account: buildTestControlPlaneAccount(),
        environments: [buildTestProviderEnvironment()],
        display_label: 'Demo Portal',
        last_synced_at_ms: 456,
      }],
    });

    const next = deleteSavedControlPlane(preferences, 'https://cp.example.invalid', 'redeven_portal');

    expect(next.control_planes).toEqual([]);
    expect(next.control_plane_refresh_tokens).toEqual({});
    expect(next.managed_environments.map((environment) => environment.id)).toEqual(expect.arrayContaining([
      'local:default',
      'cp:https%3A%2F%2Fcp.example.invalid:env:env_kept',
    ]));
  });

  it('canonicalizes legacy provider ids when loading catalog-backed preferences and rewrites the catalog', async () => {
    await withTempPreferencesDir(async (root) => {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const provider = buildTestControlPlaneProvider();
      const providerKey = controlPlaneProviderKeyForOrigin(provider.provider_origin);
      const environmentID = 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo';
      const layout = controlPlaneManagedStateLayout(
        provider.provider_origin,
        'env_demo',
        process.env,
        os.homedir,
        paths.stateRoot,
      );
      const environmentsDir = path.join(paths.stateRoot, 'catalog', 'environments');
      const providersDir = path.join(paths.stateRoot, 'catalog', 'providers');
      const providerCatalogID = desktopControlPlaneKey(provider.provider_origin, provider.provider_id);

      await fs.mkdir(environmentsDir, { recursive: true });
      await fs.mkdir(providersDir, { recursive: true });
      await fs.writeFile(paths.preferencesFile, `${JSON.stringify({ version: 10 }, null, 2)}\n`, 'utf8');
      await fs.writeFile(paths.secretsFile, `${JSON.stringify({
        version: 2,
        control_planes: [{
          provider_origin: provider.provider_origin,
          provider_id: provider.provider_id,
          refresh_token: {
            encoding: 'plain',
            data: 'refresh-demo-token',
          },
        }],
      }, null, 2)}\n`, 'utf8');
      await fs.writeFile(
        path.join(providersDir, `${encodeURIComponent(providerCatalogID)}.json`),
        `${JSON.stringify({
          schema_version: 1,
          record_kind: 'provider',
          provider: {
            protocol_version: provider.protocol_version,
            provider_id: provider.provider_id,
            display_name: provider.display_name,
            provider_origin: provider.provider_origin,
            documentation_url: provider.documentation_url,
          },
          account: {
            user_public_id: 'user_demo',
            user_display_name: 'Demo User',
            authorization_expires_at_unix_ms: 1_770_000_000_000,
          },
          display_label: 'Demo Portal',
          environments: [{
            env_public_id: 'env_demo',
            name: 'Demo Environment',
            description: 'team sandbox',
            namespace_public_id: 'ns_demo',
            namespace_name: 'Demo Team',
            status: 'online',
            lifecycle_status: 'active',
            last_seen_at_unix_ms: 123,
          }],
          last_synced_at_ms: 456,
        }, null, 2)}\n`,
        'utf8',
      );
      await fs.writeFile(
        path.join(environmentsDir, `${encodeURIComponent(environmentID)}.json`),
        `${JSON.stringify({
          schema_version: 1,
          record_kind: 'environment',
          id: environmentID,
          label: 'Desktop Label',
          preferred_open_route: 'local_host',
          created_at_ms: 100,
          updated_at_ms: 200,
          last_used_at_ms: 300,
          identity: {
            kind: 'provider',
            provider_origin: provider.provider_origin,
            provider_id: providerKey,
            env_public_id: 'env_demo',
          },
          local_hosting: {
            scope: {
              kind: 'controlplane',
              provider_origin: provider.provider_origin,
              provider_key: providerKey,
              env_public_id: 'env_demo',
            },
            scope_key: layout.scopeKey,
            state_dir: layout.stateDir,
            owner: 'desktop',
            access: {
              local_ui_bind: '127.0.0.1:0',
              local_ui_password_configured: false,
            },
          },
          provider_binding: {
            provider_origin: provider.provider_origin,
            provider_id: providerKey,
            env_public_id: 'env_demo',
            remote_web_supported: true,
            remote_desktop_supported: true,
          },
        }, null, 2)}\n`,
        'utf8',
      );

      const loaded = await loadDesktopPreferences(paths, codec);
      const repaired = loaded.managed_environments.find((environment) => environment.id === environmentID);

      expect(repaired).toEqual(expect.objectContaining({
        id: environmentID,
        label: 'Desktop Label',
        preferred_open_route: 'local_host',
        local_hosting: expect.objectContaining({
          scope: expect.objectContaining({
            kind: 'controlplane',
            provider_origin: provider.provider_origin,
            provider_key: providerKey,
            env_public_id: 'env_demo',
          }),
        }),
        provider_binding: expect.objectContaining({
          provider_origin: provider.provider_origin,
          provider_id: provider.provider_id,
          env_public_id: 'env_demo',
        }),
        identity: {
          kind: 'provider',
          provider_origin: provider.provider_origin,
          provider_id: provider.provider_id,
          env_public_id: 'env_demo',
        },
      }));

      const rewrittenEnvironmentCatalog = JSON.parse(
        await fs.readFile(path.join(environmentsDir, `${encodeURIComponent(environmentID)}.json`), 'utf8'),
      ) as {
        identity?: { provider_id?: string };
        provider_binding?: { provider_id?: string };
      };
      expect(rewrittenEnvironmentCatalog.identity?.provider_id).toBe(provider.provider_id);
      expect(rewrittenEnvironmentCatalog.provider_binding?.provider_id).toBe(provider.provider_id);
    });
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
