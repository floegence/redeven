import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  buildExternalLocalUIDesktopTarget,
} from '../main/desktopTarget';
import {
  testDesktopPreferences,
  testManagedAccess,
  testManagedLocalEnvironment,
  testManagedSession,
} from '../testSupport/desktopTestHelpers';
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

function readWelcomeStyles(): string {
  return fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8');
}

function readInstalledDialogSource(): string {
  return fs.readFileSync(
    path.join(
      __dirname,
      '..',
      '..',
      'node_modules',
      '@floegence',
      'floe-webapp-core',
      'dist',
      'components',
      'ui',
      'Dialog.js',
    ),
    'utf8',
  );
}

describe('DesktopWelcomeShell', () => {
  it('describes Connect Environment inside the shared shell model', () => {
    const managedLocal = testManagedLocalEnvironment('default', {
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal],
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
      }),
      surface: 'connect_environment',
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Connect Environment',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open Environment',
      settings_save_label: 'Save Local Environment Settings',
    });
    expect(shellStatus(snapshot)).toEqual({
      tone: 'disconnected',
      label: 'No environment windows open',
    });
  });

  it('describes Local Environment Settings inside the same shell model', () => {
    const managedLocal = testManagedLocalEnvironment('default', {
      access: testManagedAccess({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      }),
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal],
      }),
      surface: 'managed_environment_settings',
      selectedManagedEnvironmentID: managedLocal.id,
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Environment Settings',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open Environment',
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
    const managedLocal = testManagedLocalEnvironment();
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal],
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
      }),
      openSessions: [
        testManagedSession(managedLocal, 'http://localhost:23998/'),
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

    expect(environmentLibraryCount(snapshot, 'all')).toBe(3);
    expect(environmentLibraryCount(snapshot, 'open')).toBe(2);
    expect(environmentLibraryCount(snapshot, 'recent')).toBe(1);
    expect(environmentLibraryCount(snapshot, 'saved')).toBe(2);

    expect(filterEnvironmentLibrary(snapshot, 'open')).toEqual([
      expect.objectContaining({
        id: 'local:default',
        category: 'managed',
        is_open: true,
        open_action_label: 'Focus',
      }),
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
    expect(appSrc).toContain("open={snapshot().surface === 'managed_environment_settings'}");
    expect(appSrc).not.toContain('fallback={<div class="h-full min-h-0 bg-background" />}');
  });

  it('uses shared tooltip and compact card-grid helpers for desktop help affordances', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("import { DesktopTooltip } from './DesktopTooltip';");
    expect(appSrc).toContain('data-redeven-settings-help=""');
    expect(appSrc).not.toContain('title={tooltip()}');
    expect(appSrc).toContain('redeven-console-tab');
    expect(appSrc).toContain('redeven-console-filter');
    expect(appSrc).toContain('redeven-environment-card');
    expect(appSrc).toContain('redeven-environment-grid');
  });

  it('routes welcome action controls through shared pointer-ready button classes', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('redeven-console-icon-button');
    expect(appSrc).toContain('redeven-console-chip-button');
    expect(styles).toContain('.redeven-console-icon-button');
    expect(styles).toContain('.redeven-console-chip-button');
    expect(styles).toContain('cursor: pointer;');
  });

  it('renders desktop tooltips through a body-level portal so dialogs do not clip them', () => {
    const tooltipSrc = readDesktopTooltipSource();

    expect(tooltipSrc).toContain("import { Portal } from 'solid-js/web';");
    expect(tooltipSrc).toContain('data-redeven-tooltip-anchor=""');
    expect(tooltipSrc).toContain('<Portal>');
    expect(tooltipSrc).toContain('role="tooltip"');
    expect(tooltipSrc).toContain('fixed z-[220]');
  });

  it('includes compact environment-card launcher copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Connect Environment');
    expect(appSrc).toContain('Environments');
    expect(appSrc).toContain('Control Planes');
    expect(appSrc).toContain('Search environments...');
    expect(appSrc).toContain('Local Environment');
    expect(appSrc).toContain('<EnvironmentConnectionCard');
    expect(appSrc).toContain('New Environment');
    expect(appSrc).toContain('NewEnvironmentPlaceholderCard');
  });

  it('includes Control Plane management copy inside the launcher source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Control Planes');
    expect(appSrc).toContain('Add Control Plane');
    expect(appSrc).toContain('Continue in Browser');
    expect(appSrc).toContain('revocable desktop authorization');
    expect(appSrc).toContain('Expired');
    expect(appSrc).toContain('Connect Provider');
  });

  it('includes SSH connection mode copy inside the connection dialog source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("label: 'Redeven URL'");
    expect(appSrc).toContain("label: 'SSH'");
    expect(appSrc).toContain('Desktop reuses only the exact Desktop-managed Redeven release, installs it on demand when needed, and tunnels its Local UI over SSH.');
    expect(appSrc).toContain('Bootstrap Delivery');
    expect(appSrc).toContain("label: 'Automatic'");
    expect(appSrc).toContain("label: 'Desktop Upload'");
    expect(appSrc).toContain("label: 'Remote Install'");
    expect(appSrc).toContain('SSH Destination');
    expect(appSrc).toContain('Remote Install Directory');
    expect(appSrc).toContain('Release Base URL');
    expect(appSrc).toContain('Set an internal release mirror when this desktop cannot use GitHub directly.');
    expect(appSrc).toContain('Keep the default remote cache or pin a custom absolute install directory.');
    expect(appSrc).toContain('Leave blank to use the default remote user cache:');
  });

  it('includes scope-first Local Environment Settings copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Local Environment always uses the launcher-owned local scope on this machine.');
    expect(appSrc).toContain('Visibility');
    expect(appSrc).toContain('Details');
    expect(appSrc).toContain('Runtime');
    expect(appSrc).toContain('Next start');
  });

  it('keeps destructive hover affordances aligned with floe-webapp dialog close behavior', () => {
    const styles = readWelcomeStyles();
    const dialogSrc = readInstalledDialogSource();

    expect(styles).toContain('.redeven-console-icon-button--danger:hover');
    expect(styles).toContain('background: var(--error);');
    expect(styles).toContain('color: var(--error-foreground);');
    expect(dialogSrc).toContain('variant: "ghost-destructive"');
  });

  it('memoizes the Dialog open prop so overlay-mask focus trap does not thrash on every keystroke', () => {
    const appSrc = readWelcomeSource();

    // ConnectionDialog: state -> open must go through a memo accessor.
    // `props.state !== null` evaluated inline would re-track props.state on every
    // re-read, re-running the overlay-mask effect (cleanup restores focus to the
    // previously-focused element, body re-autofocuses the first focusable) on every
    // state update - which makes typing in any input of the dialog impossible.
    expect(appSrc).not.toMatch(/<Dialog\b[^>]*open=\{props\.state\s*!==\s*null\}/);
    expect(appSrc).toMatch(/const isOpen = createMemo\(\(\) => props\.state !== null\)/);
    expect(appSrc).toMatch(/const isOpen = createMemo\(\(\) => props\.open\)/);
  });
});
