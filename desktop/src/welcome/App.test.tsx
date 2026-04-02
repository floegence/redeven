import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  buildDesktopWelcomeShellViewModel,
  capabilityUnavailableMessage,
  environmentLibraryCount,
  filterEnvironmentLibrary,
  shellStatus,
} from './viewModel';

describe('DesktopWelcomeShell', () => {
  it('describes Connect Environment inside the shared shell model', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: null,
        saved_environments: [
          {
            id: 'http://192.168.1.11:24000/',
            label: '192.168.1.11:24000',
            local_ui_url: 'http://192.168.1.11:24000/',
            source: 'saved',
            last_used_at_ms: 10,
          },
        ],
        recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
      },
      surface: 'connect_environment',
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Connect Environment',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open This Device',
      settings_save_label: 'Save This Device Options',
    });
    expect(shellStatus(snapshot)).toEqual({
      tone: 'disconnected',
      label: 'No environment open',
    });
  });

  it('describes This Device Options inside the same shell model', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        pending_bootstrap: {
          controlplane_url: 'https://region.example.invalid',
          env_id: 'env_123',
          env_token: 'token-123',
        },
        saved_environments: [],
        recent_external_local_ui_urls: [],
      },
      surface: 'this_device_settings',
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'This Device Options',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open This Device',
      settings_save_label: 'Save This Device Options',
    });
    expect(snapshot.settings_surface.window_title).toBe('This Device Options');
    expect(snapshot.settings_surface.access_mode).toBe('shared_local_network');
    expect(snapshot.settings_surface.password_state_label).toBe('Password configured');
    expect(snapshot.settings_surface.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'bind_address',
        value: '0.0.0.0:24000',
        detail: 'Local network preset',
      }),
      expect.objectContaining({
        id: 'password_state',
        value: 'Password configured',
        tone: 'success',
      }),
    ]));
  });

  it('filters the Environment Library by current, recent, and saved connections', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: null,
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            source: 'saved',
            last_used_at_ms: 20,
          },
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Laptop',
            local_ui_url: 'http://192.168.1.11:24000/',
            source: 'recent_auto',
            last_used_at_ms: 10,
          },
        ],
        recent_external_local_ui_urls: [
          'http://192.168.1.12:24000/',
          'http://192.168.1.11:24000/',
        ],
      },
      externalStartup: {
        local_ui_url: 'http://192.168.1.12:24000/',
        local_ui_urls: ['http://192.168.1.12:24000/'],
      },
      activeSessionTarget: {
        kind: 'external_local_ui',
        external_local_ui_url: 'http://192.168.1.12:24000/',
      },
    });

    expect(environmentLibraryCount(snapshot, 'all')).toBe(2);
    expect(environmentLibraryCount(snapshot, 'current')).toBe(1);
    expect(environmentLibraryCount(snapshot, 'recent')).toBe(1);
    expect(environmentLibraryCount(snapshot, 'saved')).toBe(1);

    expect(filterEnvironmentLibrary(snapshot, 'current')).toEqual([
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        category: 'saved',
        is_current: true,
      }),
    ]);
    expect(filterEnvironmentLibrary(snapshot, 'recent')).toEqual([
      expect.objectContaining({
        id: 'http://192.168.1.11:24000/',
        category: 'recent_auto',
      }),
    ]);
    expect(filterEnvironmentLibrary(snapshot, 'saved', 'stag')).toEqual([
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        label: 'Staging',
      }),
    ]);
  });

  it('uses Environment guidance copy when a capability is unavailable before connection', () => {
    expect(capabilityUnavailableMessage('Deck')).toBe('Connect to an Environment first to open Deck.');
  });
});
