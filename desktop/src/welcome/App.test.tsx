import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { buildDesktopWelcomeShellViewModel, capabilityUnavailableMessage, shellStatus } from './viewModel';

describe('DesktopWelcomeShell', () => {
  it('describes the chooser surface inside the shared shell model', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: null,
        recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
      },
      surface: 'machine_chooser',
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Choose a machine',
      chooser_heading: 'Open a Redeven machine',
      utility_labels: ['Switch Machine', 'Settings'],
      primary_action_label: 'Open This Device',
      settings_save_label: null,
    });
    expect(shellStatus(snapshot)).toEqual({
      tone: 'disconnected',
      label: 'No machine open',
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
        recent_external_local_ui_urls: [],
      },
      surface: 'this_device_settings',
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'This Device settings',
      chooser_heading: 'Open a Redeven machine',
      utility_labels: ['Switch Machine', 'Settings'],
      primary_action_label: 'Open This Device',
      settings_save_label: 'Save This Device Options',
    });
    expect(snapshot.settings_surface?.window_title).toBe('This Device Options');
    expect(snapshot.settings_surface?.alert.title).toBe('Machine selection stays in the welcome launcher');
  });

  it('uses chooser guidance copy when a workbench capability is unavailable before connection', () => {
    expect(capabilityUnavailableMessage('Deck')).toBe('Choose a machine first to open Deck.');
  });
});
