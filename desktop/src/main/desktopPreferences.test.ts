import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopControlPlaneProvider,
} from '../shared/controlPlaneProvider';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import { managedEnvironmentLocalAccess } from '../shared/desktopManagedEnvironment';
import {
  testDesktopPreferences,
  testManagedAccess,
  testManagedControlPlaneEnvironment,
  testManagedLocalEnvironment,
  testProviderEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
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
  findManagedEnvironmentByID,
  findManagedEnvironmentLocalBindConflict,
  loadDesktopPreferences,
  managedDesktopLaunchKey,
  normalizeRecentExternalLocalUIURLs,
  normalizeSavedEnvironments,
  rememberRecentExternalLocalUITarget,
  rememberRecentSSHEnvironmentTarget,
  rememberProviderEnvironmentUse,
  saveDesktopPreferences,
  setManagedEnvironmentPinned,
  setProviderEnvironmentPinned,
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
    documentation_url: `${providerOrigin}/docs/control-plane-providers`,
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

  it('does not report bind conflicts after collapsed local environment records normalize to one entry', () => {
    const primary = testManagedLocalEnvironment('local', {
      label: 'Local Environment',
      access: testManagedAccess({
        local_ui_bind: 'localhost:23998',
      }),
    });
    const lab = testManagedLocalEnvironment('lab', {
      label: 'Lab',
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:23998',
      }),
    });
    const preferences = testDesktopPreferences({
      managed_environments: [primary, lab],
    });

    expect(findManagedEnvironmentLocalBindConflict(preferences, lab.id)).toBeNull();
  });

  it('does not treat dynamic local binds as conflicts', () => {
    const primary = testManagedLocalEnvironment('default', {
      access: testManagedAccess({
        local_ui_bind: 'localhost:23998',
      }),
    });
    const lab = testManagedLocalEnvironment('lab', {
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });
    const preferences = testDesktopPreferences({
      managed_environments: [primary, lab],
    });

    expect(findManagedEnvironmentLocalBindConflict(preferences, lab.id)).toBeNull();
  });

  it('preserves the single Local Environment state when editing access without resending it', () => {
    const existing = testManagedLocalEnvironment('lab', {
      label: 'Lab',
      access: testManagedAccess({
        local_ui_bind: 'localhost:23998',
      }),
    });
    const next = upsertManagedEnvironment(testDesktopPreferences({
      managed_environments: [existing],
    }), {
      environment_id: existing.id,
      label: 'Renamed Lab',
      access: testManagedAccess({
        local_ui_bind: 'localhost:24000',
      }),
    });
    const updated = findManagedEnvironmentByID(next, existing.id);

    expect(updated).toBeTruthy();
    expect(updated).toEqual(expect.objectContaining({
      id: existing.id,
      label: 'Local Environment',
    }));
    expect(updated?.local_hosting?.scope).toEqual({
      kind: 'local_environment',
      name: 'local',
    });
    expect(updated?.local_hosting?.access.local_ui_bind).toBe('localhost:24000');
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
          testManagedLocalEnvironment('local', {
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
            id: 'ssh:devbox:2222:key_agent:remote_default',
            label: 'SSH Lab',
            ssh_destination: 'devbox',
            ssh_port: 2222,
            auth_mode: 'key_agent',
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

  it('canonicalizes legacy SSH catalog records onto host-scoped SSH ids', async () => {
    await withTempPreferencesDir(async (root) => {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const connectionsDir = path.join(paths.stateRoot, 'catalog', 'connections');
      const legacyID = 'ssh:devbox:2222:remote_default';

      await fs.mkdir(connectionsDir, { recursive: true });
      await fs.writeFile(
        path.join(connectionsDir, `${encodeURIComponent(legacyID)}.json`),
        `${JSON.stringify({
          schema_version: 1,
          record_kind: 'connection',
          kind: 'ssh',
          id: legacyID,
          label: 'SSH Lab',
          ssh_destination: 'devbox',
          ssh_port: 2222,
          remote_install_dir: 'remote_default',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: 'https://mirror.example.invalid/releases',
          source: 'saved',
          pinned: false,
          last_used_at_ms: 90,
        }, null, 2)}\n`,
      );

      const loaded = await loadDesktopPreferences(paths, codec);
      expect(loaded.saved_ssh_environments).toHaveLength(1);
      expect(loaded.saved_ssh_environments[0]).toEqual(expect.objectContaining({
        label: 'SSH Lab',
        ssh_destination: 'devbox',
        ssh_port: 2222,
        auth_mode: 'key_agent',
        remote_install_dir: 'remote_default',
        bootstrap_strategy: 'desktop_upload',
        release_base_url: 'https://mirror.example.invalid/releases',
        source: 'saved',
        pinned: false,
      }));
      expect(loaded.saved_ssh_environments[0].id).toBe('ssh:devbox:2222:key_agent:remote_default');

      const rewrittenFiles = await fs.readdir(connectionsDir);
      expect(rewrittenFiles).toHaveLength(1);
      expect(rewrittenFiles[0]).toContain(encodeURIComponent(loaded.saved_ssh_environments[0].id));
    });
  });

  it('stores control plane refresh tokens only in secrets while keeping account summaries in preferences', async () => {
    const provider = normalizeDesktopControlPlaneProvider({
      protocol_version: 'rcpp-v1',
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://region.example.invalid',
      documentation_url: 'https://region.example.invalid/docs/control-plane-providers',
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
          id: 'local',
          identity: { kind: 'provisional_local', local_name: 'local' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local_environment', name: 'local' },
          }),
        }),
      ]);
      expect(loaded.provider_environments).toEqual([
        expect.objectContaining({
          id: 'cp:https%3A%2F%2Fregion.example.invalid:env:env_demo',
          provider_origin: 'https://region.example.invalid',
          provider_id: 'redeven_portal',
          env_public_id: 'env_demo',
          label: 'Demo Environment',
          remote_catalog_entry: expect.objectContaining({
            description: 'team sandbox',
            namespace_public_id: 'ns_demo',
            namespace_name: 'Demo Team',
            status: 'online',
            lifecycle_status: 'active',
            last_seen_at_unix_ms: 123,
          }),
        }),
      ]);
    });
  });

  it('drops orphaned provider environment catalog records without a saved provider owner', async () => {
    await withTempPreferencesDir(async (root) => {
      const paths = defaultDesktopPreferencesPaths(root);
      const codec = createPlaintextSecretCodec();
      const providerEnvironmentsDir = path.join(paths.stateRoot, 'catalog', 'provider-environments');
      const orphan = testProviderEnvironment('https://cp.example.invalid', 'env_orphan', {
        label: 'Orphaned Env',
        pinned: true,
        lastUsedAtMS: 111,
      });

      await fs.mkdir(providerEnvironmentsDir, { recursive: true });
      await fs.writeFile(
        path.join(providerEnvironmentsDir, `${encodeURIComponent(orphan.id)}.json`),
        `${JSON.stringify({
          schema_version: 1,
          record_kind: 'provider_environment',
          id: orphan.id,
          provider_origin: orphan.provider_origin,
          provider_id: orphan.provider_id,
          env_public_id: orphan.env_public_id,
          label: orphan.label,
          pinned: orphan.pinned,
          created_at_ms: orphan.created_at_ms,
          updated_at_ms: orphan.updated_at_ms,
          last_used_at_ms: orphan.last_used_at_ms,
          preferred_open_route: orphan.preferred_open_route,
          remote_web_supported: orphan.remote_web_supported,
          remote_desktop_supported: orphan.remote_desktop_supported,
        }, null, 2)}\n`,
      );

      const loaded = await loadDesktopPreferences(paths, codec);
      expect(loaded.control_planes).toEqual([]);
      expect(loaded.provider_environments).toEqual([]);

      await saveDesktopPreferences(paths, loaded, codec);
      expect(await fs.readdir(providerEnvironmentsDir)).toEqual([]);
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
          testManagedLocalEnvironment('local', {
            access: initialAccess,
          }),
        ],
      });

      await saveDesktopPreferences(paths, initial, codec);
      await saveDesktopPreferences(paths, {
        ...initial,
        managed_environments: [
          testManagedLocalEnvironment('local', {
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
          id: 'local',
          label: 'Local Environment',
          identity: { kind: 'provisional_local', local_name: 'local' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local_environment', name: 'local' },
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
          id: 'local',
          label: 'Local Environment',
          identity: { kind: 'provisional_local', local_name: 'local' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local_environment', name: 'local' },
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
          id: 'local',
          identity: { kind: 'provisional_local', local_name: 'local' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local_environment', name: 'local' },
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
          id: 'local',
          identity: { kind: 'provisional_local', local_name: 'local' },
          local_hosting: expect.objectContaining({
            scope: { kind: 'local_environment', name: 'local' },
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
      auth_mode: 'key_agent',
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'auto',
      release_base_url: '',
      label: 'Lab',
    });

    expect(remembered.saved_ssh_environments).toEqual([
      {
        id: 'ssh:devbox:2222:key_agent:remote_default',
        label: 'Lab',
        ssh_destination: 'devbox',
        ssh_port: 2222,
        auth_mode: 'key_agent',
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
      auth_mode: 'key_agent',
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: 'https://mirror.example.invalid/releases',
      source: 'saved',
      last_used_at_ms: 500,
    });

    expect(deleteSavedSSHEnvironment(saved, 'ssh:devbox:2222:key_agent:remote_default').saved_ssh_environments).toEqual([]);
  });

  it('persists pin state for managed, URL, and SSH environments', () => {
    const base = testDesktopPreferences({
      managed_environments: [testManagedLocalEnvironment('local', { pinned: false })],
      saved_environments: [{
        id: 'http://192.168.1.12:24000/',
        label: 'Staging',
        local_ui_url: 'http://192.168.1.12:24000/',
        source: 'saved',
        pinned: false,
        last_used_at_ms: 20,
      }],
      saved_ssh_environments: [{
        id: 'ssh:devbox:2222:key_agent:remote_default',
        label: 'SSH Lab',
        ssh_destination: 'devbox',
        ssh_port: 2222,
        auth_mode: 'key_agent',
        remote_install_dir: 'remote_default',
        bootstrap_strategy: 'desktop_upload',
        release_base_url: '',
        source: 'saved',
        pinned: false,
        last_used_at_ms: 10,
      }],
    });

    const managedPinned = setManagedEnvironmentPinned(base, 'local', true);
    const urlPinned = setSavedEnvironmentPinned(managedPinned, {
      environment_id: 'http://192.168.1.12:24000/',
      label: 'Staging',
      local_ui_url: 'http://192.168.1.12:24000/',
      pinned: true,
    });
    const sshPinned = setSavedSSHEnvironmentPinned(urlPinned, {
      environment_id: 'ssh:devbox:2222:key_agent:remote_default',
      label: 'SSH Lab',
      pinned: true,
      ssh_destination: 'devbox',
      ssh_port: 2222,
      auth_mode: 'key_agent',
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
    });

    expect(sshPinned.managed_environments[0]).toEqual(expect.objectContaining({ pinned: true }));
    expect(sshPinned.saved_environments[0]).toEqual(expect.objectContaining({ pinned: true }));
    expect(sshPinned.saved_ssh_environments[0]).toEqual(expect.objectContaining({ pinned: true }));
  });

  it('remembers provider-card usage without rewriting the preferred route', () => {
    const dualRoute = testProviderEnvironment('https://cp.example.invalid', 'env_demo', {
      preferredOpenRoute: 'local_host',
    });
    const remembered = rememberProviderEnvironmentUse(testDesktopPreferences({
      provider_environments: [dualRoute],
    }), dualRoute.id);

    expect(remembered.provider_environments.find((environment) => environment.id === dualRoute.id)).toEqual(
      expect.objectContaining({
        preferred_open_route: 'local_host',
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

  it('keeps provider environments in the control-plane catalog instead of materializing managed records', () => {
    const provider = buildTestControlPlaneProvider();
    const next = upsertSavedControlPlane(testDesktopPreferences(), {
      provider,
      account: buildTestControlPlaneAccount(provider),
      environments: [buildTestProviderEnvironment(provider)],
      refresh_token: 'refresh-demo-token',
      display_label: 'Demo Portal',
      last_synced_at_ms: 456,
    });

    expect(next.managed_environments).toEqual([
      expect.objectContaining({
        id: 'local',
      }),
    ]);
    expect(next.provider_environments).toEqual([
      expect.objectContaining({
        id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'redeven_portal',
        env_public_id: 'env_demo',
        label: 'Demo Environment',
        remote_catalog_entry: expect.objectContaining({
          description: 'team sandbox',
          namespace_public_id: 'ns_demo',
          namespace_name: 'Demo Team',
          status: 'online',
          lifecycle_status: 'active',
          last_seen_at_unix_ms: 123,
        }),
      }),
    ]);
    expect(next.control_planes[0]?.environments).toEqual([
      expect.objectContaining({
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'redeven_portal',
        env_public_id: 'env_demo',
        label: 'Demo Environment',
      }),
    ]);
  });

  it('merges provider refresh data into an existing provider preference without writing local runtime state', () => {
    const provider = buildTestControlPlaneProvider();
    const existing = testProviderEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Desktop Label',
      preferredOpenRoute: 'local_host',
    });

    const next = upsertSavedControlPlane(testDesktopPreferences({
      provider_environments: [existing],
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

    const merged = next.provider_environments.find((environment) => environment.id === existing.id);

    expect(merged).toEqual(expect.objectContaining({
      id: existing.id,
      label: 'Provider Label',
      preferred_open_route: 'local_host',
      remote_catalog_entry: expect.objectContaining({
        description: 'team sandbox',
        namespace_public_id: 'ns_demo',
        namespace_name: 'Demo Team',
        status: 'offline',
        lifecycle_status: 'suspended',
      }),
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
      env_public_id: 'env_demo',
    }));
    expect(merged).not.toHaveProperty('local_runtime');
  });

  it('keeps provider preferences separate from the single Local Environment state', () => {
    const local = testManagedLocalEnvironment('local', {
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:24001',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      }),
    });
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Desktop Demo',
      preferredOpenRoute: 'local_host',
    });
    const preferences = testDesktopPreferences({
      managed_environments: [local],
      provider_environments: [providerEnvironment],
    });

    expect(preferences.provider_environments[0]).toEqual(expect.objectContaining({
      id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
      label: 'Desktop Demo',
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
      env_public_id: 'env_demo',
      preferred_open_route: 'local_host',
    }));
    expect(preferences.provider_environments[0]).not.toHaveProperty('local_runtime');
    expect(preferences.managed_environments).toEqual([
      expect.objectContaining({
        id: 'local',
        local_hosting: expect.objectContaining({
          access: expect.objectContaining({
            local_ui_bind: '127.0.0.1:24001',
            local_ui_password: 'secret',
            local_ui_password_configured: true,
          }),
        }),
      }),
    ]);
  });

  it('collapses local-only managed records to the single Local Environment while keeping provider preferences separate', () => {
    const existingLocal = testManagedLocalEnvironment('lab', {
      label: 'Local Lab',
      access: {
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      },
    });
    const existingRemoteOnly = testProviderEnvironment('https://cp.example.invalid', 'env_lab', {
      label: 'Remote Lab',
    });

    const next = testDesktopPreferences({
      managed_environments: [existingLocal],
      provider_environments: [existingRemoteOnly],
    });

    const providerEntries = next.provider_environments.filter((environment) => environment.id === existingRemoteOnly.id);

    expect(providerEntries).toHaveLength(1);
    expect(providerEntries[0]).toEqual(expect.objectContaining({
      id: existingRemoteOnly.id,
      label: 'Remote Lab',
    }));
    expect(providerEntries[0]).not.toHaveProperty('local_runtime');
    expect(next.managed_environments).toEqual([
      expect.objectContaining({
        id: existingLocal.id,
        label: 'Local Lab',
        local_hosting: expect.objectContaining({
          access: expect.objectContaining({
            local_ui_bind: '0.0.0.0:24000',
            local_ui_password: 'secret',
            local_ui_password_configured: true,
          }),
        }),
      }),
    ]);
    expect(next.managed_environments.some((environment) => environment.id === existingRemoteOnly.id)).toBe(false);
  });

  it('keeps the existing local state when editing Local Environment settings', () => {
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
        label: 'Local Environment',
        local_hosting: expect.objectContaining({
          scope: expect.objectContaining({
            kind: 'local_environment',
            name: 'local',
          }),
          state_dir: '/tmp/redeven-lab',
        }),
      }),
    ]));
  });

  it('keeps the Local Environment record when deletion is requested directly', () => {
    const removable = testManagedLocalEnvironment('lab');

    const result = deleteManagedEnvironment(testDesktopPreferences({
      managed_environments: [
        testManagedLocalEnvironment('local'),
        removable,
      ],
    }), removable.id);

    expect(result.deleted_environment).toBeNull();
    expect(result.deleted_state_dir).toBe('');
    expect(result.preferences.managed_environments.some((environment) => environment.id === removable.id)).toBe(true);
  });

  it('repairs a legacy provider-backed local environment into provider preference only', () => {
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

    const repairedEntries = next.provider_environments.filter((environment) => (
      environment.provider_origin === provider.provider_origin
      && environment.env_public_id === 'env_demo'
    ));

    expect(repairedEntries).toHaveLength(1);
    expect(repairedEntries[0]).toEqual(expect.objectContaining({
      id: existing.id,
      label: 'Demo Environment',
      preferred_open_route: 'local_host',
      remote_catalog_entry: expect.objectContaining({
        description: 'team sandbox',
        namespace_public_id: 'ns_demo',
        namespace_name: 'Demo Team',
        status: 'online',
        lifecycle_status: 'active',
      }),
      provider_origin: provider.provider_origin,
      provider_id: provider.provider_id,
      env_public_id: 'env_demo',
    }));
    expect(repairedEntries[0]).not.toHaveProperty('local_runtime');
    expect(next.managed_environments).toEqual([
      expect.objectContaining({
        id: 'local',
      }),
    ]);
  });

  it('drops revoked provider entries unless they have durable user preference metadata', () => {
    const provider = buildTestControlPlaneProvider();
    const remoteOnly = testProviderEnvironment('https://cp.example.invalid', 'env_removed');
    const preferredRoute = testProviderEnvironment('https://cp.example.invalid', 'env_kept', {
      preferredOpenRoute: 'local_host',
      lastUsedAtMS: 111,
    });

    const next = upsertSavedControlPlane(testDesktopPreferences({
      provider_environments: [remoteOnly, preferredRoute],
    }), {
      provider,
      account: buildTestControlPlaneAccount(provider),
      environments: [],
      refresh_token: 'refresh-demo-token',
      display_label: 'Demo Portal',
      last_synced_at_ms: 456,
    });

    expect(next.provider_environments.some((environment) => environment.id === remoteOnly.id)).toBe(false);
    expect(next.provider_environments.find((environment) => environment.id === preferredRoute.id)).toEqual(expect.objectContaining({
      id: preferredRoute.id,
      preferred_open_route: 'local_host',
      last_used_at_ms: 111,
      provider_origin: 'https://cp.example.invalid',
      env_public_id: 'env_kept',
    }));
  });

  it('deleting a control plane removes its provider environments even when pinned or recently used', () => {
    const provider = buildTestControlPlaneProvider();
    const otherProvider = buildTestControlPlaneProvider('https://other.example.invalid');
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_kept', {
      label: 'Env Kept',
    });
    const otherProviderEnvironment = testProviderEnvironment(otherProvider.provider_origin, 'env_other', {
      providerID: otherProvider.provider_id,
      label: 'Other Env',
      pinned: true,
      lastUsedAtMS: 222,
    });
    const preferencesWithProviderState = setProviderEnvironmentPinned(
      rememberProviderEnvironmentUse(testDesktopPreferences({
        provider_environments: [
          testProviderEnvironment('https://cp.example.invalid', 'env_removed'),
          providerEnvironment,
          otherProviderEnvironment,
        ],
        control_plane_refresh_tokens: {
          'https://cp.example.invalid|redeven_portal': 'refresh-demo-token',
          'https://other.example.invalid|redeven_portal': 'refresh-other-token',
        },
        control_planes: [{
          provider,
          account: buildTestControlPlaneAccount(provider),
          environments: [buildTestProviderEnvironment(provider)],
          display_label: 'Demo Portal',
          last_synced_at_ms: 456,
        }, {
          provider: otherProvider,
          account: buildTestControlPlaneAccount(otherProvider),
          environments: [buildTestProviderEnvironment(otherProvider, 'env_other')],
          display_label: 'Other Portal',
          last_synced_at_ms: 789,
        }],
      }), providerEnvironment.id),
      providerEnvironment.id,
      true,
    );
    const next = deleteSavedControlPlane(preferencesWithProviderState, 'https://cp.example.invalid', 'redeven_portal');

    expect(next.control_planes).toEqual([
      expect.objectContaining({
        provider: expect.objectContaining({
          provider_origin: 'https://other.example.invalid',
          provider_id: 'redeven_portal',
        }),
      }),
    ]);
    expect(next.control_plane_refresh_tokens).toEqual({
      'https://other.example.invalid|redeven_portal': 'refresh-other-token',
    });
    expect(next.provider_environments).toEqual([
      expect.objectContaining({
        id: otherProviderEnvironment.id,
        provider_origin: 'https://other.example.invalid',
        provider_id: 'redeven_portal',
        env_public_id: 'env_other',
        pinned: true,
      }),
    ]);
    expect(next.managed_environments.map((environment) => environment.id)).toEqual([
      'local',
    ]);
  });

  it('tracks provider-card pin and last-used metadata separately from managed environments', () => {
    const provider = buildTestControlPlaneProvider();
    const initial = testDesktopPreferences({
      provider_environments: [
        testProviderEnvironment(provider.provider_origin, 'env_demo'),
      ],
    });
    const environmentID = initial.provider_environments[0]!.id;
    const used = rememberProviderEnvironmentUse(initial, environmentID);
    const pinned = setProviderEnvironmentPinned(
      used,
      environmentID,
      true,
    );

    expect(pinned.managed_environments).toEqual([
      expect.objectContaining({
        id: 'local',
      }),
    ]);
    expect(pinned.provider_environments).toEqual([
      expect.objectContaining({
        id: environmentID,
        provider_origin: provider.provider_origin,
        provider_id: provider.provider_id,
        env_public_id: 'env_demo',
        pinned: true,
        last_used_at_ms: expect.any(Number),
      }),
    ]);
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
