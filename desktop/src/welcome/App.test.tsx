import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  buildExternalLocalUIDesktopTarget,
  buildManagedLocalDesktopTarget,
} from '../main/desktopTarget';
import {
  buildDesktopWelcomeShellViewModel,
  capabilityUnavailableMessage,
  environmentLibraryCount,
  filterEnvironmentLibrary,
  shellStatus,
} from './viewModel';

function readWelcomeSource(): string {
  return fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');
}

function readDesktopTooltipSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopTooltip.tsx'), 'utf8');
}

describe('DesktopWelcomeShell', () => {
  it('describes Connect Environment inside the shared shell model', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        local_ui_password_configured: false,
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
        saved_ssh_environments: [],
        recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
        control_planes: [],
      },
      surface: 'connect_environment',
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Connect Environment',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open Local Environment',
      settings_save_label: 'Save Local Environment Settings',
    });
    expect(shellStatus(snapshot)).toEqual({
      tone: 'disconnected',
      label: 'No environment windows open',
    });
  });

  it('describes Local Environment Settings inside the same shell model', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
        pending_bootstrap: {
          controlplane_url: 'https://region.example.invalid',
          env_id: 'env_123',
          env_token: 'token-123',
        },
        saved_environments: [],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [],
        control_planes: [],
      },
      surface: 'local_environment_settings',
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Local Environment Settings',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open Local Environment',
      settings_save_label: 'Save Local Environment Settings',
    });
    expect(snapshot.settings_surface.window_title).toBe('Local Environment Settings');
    expect(snapshot.settings_surface.access_mode).toBe('shared_local_network');
    expect(snapshot.settings_surface.password_state_label).toBe('Password configured');
    expect(snapshot.settings_surface.draft.local_ui_password).toBe('');
    expect(snapshot.settings_surface.draft.local_ui_password_mode).toBe('keep');
    expect(snapshot.settings_surface.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'next_start_address',
        value: 'Your device IP:24000',
        detail: 'Other devices on your local network can open the Local Environment.',
      }),
      expect.objectContaining({
        id: 'password_state',
        value: 'Password configured',
        tone: 'success',
      }),
    ]));
  });

  it('filters the Environment Library by open, recent, and saved connections', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        local_ui_password_configured: false,
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
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [
          'http://192.168.1.12:24000/',
          'http://192.168.1.11:24000/',
        ],
        control_planes: [],
      },
      openSessions: [
        {
          session_key: 'managed_local',
          target: buildManagedLocalDesktopTarget(),
          startup: {
            local_ui_url: 'http://localhost:23998/',
            local_ui_urls: ['http://localhost:23998/'],
          },
        },
        {
          session_key: 'url:http://192.168.1.12:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.12:24000/', { label: 'Staging' }),
          startup: {
            local_ui_url: 'http://192.168.1.12:24000/',
            local_ui_urls: ['http://192.168.1.12:24000/'],
          },
        },
      ],
    });

    expect(environmentLibraryCount(snapshot, 'all')).toBe(2);
    expect(environmentLibraryCount(snapshot, 'open')).toBe(1);
    expect(environmentLibraryCount(snapshot, 'recent')).toBe(1);
    expect(environmentLibraryCount(snapshot, 'saved')).toBe(1);

    expect(filterEnvironmentLibrary(snapshot, 'open')).toEqual([
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        category: 'saved',
        is_open: true,
        open_action_label: 'Focus',
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

  it('keeps Local Environment Settings as a dialog layered on top of the launcher surface', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('<ConnectEnvironmentSurface');
    expect(appSrc).toContain("<LocalEnvironmentSettingsDialog");
    expect(appSrc).toContain("open={snapshot().surface === 'local_environment_settings'}");
    expect(appSrc).not.toContain('fallback={<div class="h-full min-h-0 bg-background" />}');
  });

  it('uses shared tooltip and aligned header rails for desktop help affordances', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("import { DesktopTooltip } from './DesktopTooltip';");
    expect(appSrc).toContain('data-redeven-settings-help=""');
    expect(appSrc).not.toContain('title={tooltip()}');
    expect(appSrc).toContain('const PANEL_HEADER_BADGES_CLASS =');
    expect(appSrc).toContain('const PANEL_HEADER_ACTIONS_CLASS =');
  });

  it('renders desktop tooltips through a body-level portal so dialogs do not clip them', () => {
    const tooltipSrc = readDesktopTooltipSource();

    expect(tooltipSrc).toContain("import { Portal } from 'solid-js/web';");
    expect(tooltipSrc).toContain('data-redeven-tooltip-anchor=""');
    expect(tooltipSrc).toContain('<Portal>');
    expect(tooltipSrc).toContain('role="tooltip"');
    expect(tooltipSrc).toContain('fixed z-[220]');
  });

  it('includes Control Plane management copy inside the launcher source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Control Planes');
    expect(appSrc).toContain('Add Control Plane');
    expect(appSrc).toContain('Desktop Session Token');
    expect(appSrc).toContain('fixed provider protocol');
  });

  it('includes SSH connection mode copy inside the connection dialog source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("label: 'Redeven URL'");
    expect(appSrc).toContain("label: 'SSH'");
    expect(appSrc).toContain('Desktop installs a matching Redeven runtime on demand and tunnels its Local UI over SSH.');
    expect(appSrc).toContain('SSH Destination');
    expect(appSrc).toContain('Remote Install Directory');
    expect(appSrc).toContain('Forwarded UI:');
  });
});
