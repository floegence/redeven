// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSettingsResponse, FilesystemScope } from '../pages/settings/types';
import {
  normalizeFilesystemScopeDraft,
  saveFilesystemRootWritePermission,
  updateFilesystemRootWritePermission,
} from './filesystemScopeSettings';

const localApiMocks = vi.hoisted(() => ({
  fetchLocalApiJSON: vi.fn(),
}));

vi.mock('./localApi', () => ({
  fetchLocalApiJSON: localApiMocks.fetchLocalApiJSON,
}));

function buildSettings(scope: FilesystemScope | null): AgentSettingsResponse {
  return {
    config_path: '/tmp/redeven/config.json',
    connection: {
      controlplane_base_url: '',
      environment_id: 'env-1',
      agent_instance_id: 'agent-1',
      direct: {
        ws_url: '',
        channel_id: '',
        channel_init_expire_at_unix_s: 0,
        default_suite: 1,
        e2ee_psk_set: false,
      },
    },
    runtime: {
      agent_home_dir: '/Users/alice',
      shell: '/bin/zsh',
      filesystem_scope: scope,
    },
    logging: { log_format: '', log_level: '' },
    codespaces: { code_server_port_min: 0, code_server_port_max: 0 },
    permission_policy: null,
    ai: null,
  };
}

beforeEach(() => {
  localApiMocks.fetchLocalApiJSON.mockReset();
});

describe('filesystem scope settings helpers', () => {
  it('normalizes missing runtime scope into Home plus read-only Computer roots', () => {
    const scope = normalizeFilesystemScopeDraft('/Users/alice', null);

    expect(scope).toEqual({
      schema_version: 1,
      default_root_id: 'home',
      roots: [
        {
          id: 'home',
          label: 'Home',
          path: '/Users/alice',
          kind: 'home',
          permissions: { read: true, write: true },
          hidden: false,
          system: true,
        },
        {
          id: 'computer',
          label: 'Computer',
          path: '/',
          kind: 'computer',
          permissions: { read: true, write: false },
          hidden: false,
          system: true,
        },
      ],
    });
  });

  it('updates root write permission without mutating the source scope', () => {
    const source = normalizeFilesystemScopeDraft('/Users/alice', {
      schema_version: 1,
      default_root_id: 'home',
      roots: [
        {
          id: 'home',
          label: 'Home',
          path: '/Users/alice',
          kind: 'home',
          permissions: { read: true, write: true },
          system: true,
        },
        {
          id: 'computer',
          label: 'Computer',
          path: '/',
          kind: 'computer',
          permissions: { read: true, write: false },
          system: true,
        },
      ],
    });

    const next = updateFilesystemRootWritePermission(source, 'computer', true);

    expect(source.roots.find((root) => root.id === 'computer')?.permissions.write).toBe(false);
    expect(next.roots.find((root) => root.id === 'computer')?.permissions).toEqual({ read: true, write: true });
  });

  it('saves sidebar write toggles through the same runtime settings payload shape', async () => {
    const currentSettings = buildSettings(null);
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (_url: string, init?: RequestInit) => ({
      settings: buildSettings(JSON.parse(String(init?.body ?? '{}')).filesystem_scope as FilesystemScope),
    }));

    const result = await saveFilesystemRootWritePermission(currentSettings, 'computer', true);

    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        agent_home_dir: '/Users/alice',
        shell: '/bin/zsh',
        filesystem_scope: {
          schema_version: 1,
          default_root_id: 'home',
          roots: [
            {
              id: 'home',
              label: 'Home',
              path: '/Users/alice',
              kind: 'home',
              permissions: { read: true, write: true },
              hidden: false,
              system: true,
            },
            {
              id: 'computer',
              label: 'Computer',
              path: '/',
              kind: 'computer',
              permissions: { read: true, write: true },
              hidden: false,
              system: true,
            },
          ],
        },
      }),
    });
    expect(result.filesystemScope.roots.find((root) => root.id === 'computer')?.permissions.write).toBe(true);
  });
});
