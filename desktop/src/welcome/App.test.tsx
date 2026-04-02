import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { buildDesktopWelcomeShellViewModel, capabilityUnavailableMessage, shellStatus } from './viewModel';

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

  it('describes This Device settings inside the same shell model', () => {
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
      surface_title: 'This Device Settings',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open This Device',
      settings_save_label: 'Save This Device Options',
    });
    expect(snapshot.settings_surface.window_title).toBe('This Device Options');
    expect(snapshot.settings_surface.alert.title).toBe('Environment selection stays in Connect Environment');
  });

  it('uses Environment guidance copy when a capability is unavailable before connection', () => {
    expect(capabilityUnavailableMessage('Deck')).toBe('Connect to an Environment first to open Deck.');
  });
});
