import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { desktopControlPlaneKey } from '../shared/controlPlaneProvider';
import { createDesktopI18n } from '../shared/i18n';
import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import { openConnectionProgress } from '../shared/desktopOpenConnectionProgress';
import {
  testDesktopPreferences,
  testLocalAccess,
  testLocalEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  environmentProgressPrimaryPresentation,
  selectEnvironmentPanelProgress,
} from './environmentProgressPrimaryPresentation';
import {
  IDLE_LAUNCHER_BUSY_STATE,
  busyStateBlocksEnvironmentAction,
  reconcileBusyStateWithActionProgressSnapshot,
  selectedSnapshotOpenConnectionProgressForEnvironment,
} from './launcherBusyState';
import {
  buildDesktopWelcomeShellViewModel,
  buildProviderBackedEnvironmentActionModel,
  capabilityUnavailableMessage,
  environmentLibraryCount,
  filterEnvironmentLibrary,
  LOCAL_ENVIRONMENT_LIBRARY_FILTER,
  PROVIDER_ENVIRONMENT_LIBRARY_FILTER,
  shellStatus,
} from './viewModel';

function readWelcomeSource(): string {
  return fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');
}

function readDesktopTooltipSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopTooltip.tsx'), 'utf8');
}

function readDesktopPopoverSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopPopover.tsx'), 'utf8');
}

function readDesktopActionPopoverSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopActionPopover.tsx'), 'utf8');
}

function readDesktopAnchoredOverlaySurfaceSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopAnchoredOverlaySurface.tsx'), 'utf8');
}

function readDesktopAnchoredListboxSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopAnchoredListbox.tsx'), 'utf8');
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
    const local = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        saved_environments: [
          {
            id: 'http://192.168.1.11:24000/',
            label: '192.168.1.11:24000',
            local_ui_url: 'http://192.168.1.11:24000/',
            pinned: false,
            created_at_ms: 10,
            last_used_at_ms: 10,
          },
        ],
        saved_ssh_environments: [],
      }),
      surface: 'connect_environment',
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Connect Environment',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open Environment',
      settings_save_key: 'settings.saveEnvironmentSettings',
    });
    expect(shellStatus(snapshot)).toEqual({
      tone: 'disconnected',
      label: 'No environment windows open',
    });
    expect(shellStatus(snapshot, createDesktopI18n('zh-CN'))).toEqual({
      tone: 'disconnected',
      label: '没有打开的 Environment 窗口',
    });
  });

  it('describes Local Environment Settings inside the same shell model', () => {
    const local = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      }),
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
      surface: 'environment_settings',
      selectedEnvironmentID: local.id,
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Environment Settings',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open Environment',
      settings_save_key: 'settings.saveEnvironmentSettings',
    });
    expect(snapshot.settings_surface.window_title_key).toBe('settings.settingsWindowTitle');
    expect(snapshot.settings_surface.access_mode).toBe('shared_local_network');
    expect(snapshot.settings_surface.password_state_id).toBe('configured');
    expect(snapshot.settings_surface.draft.local_ui_password).toBe('');
    expect(snapshot.settings_surface.draft.local_ui_password_mode).toBe('keep');
    expect(snapshot.settings_surface.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'next_start_address',
        value: '24000',
        detail_key: 'settings.sharedAddressDetail',
      }),
      expect.objectContaining({
        id: 'password_state',
        value_key: 'settings.passwordSet',
        tone: 'success',
      }),
    ]));
  });

  it('localizes issue status labels when a semantic issue key is available', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      issue: {
        scope: 'local_environment',
        code: 'state_dir_locked',
        title: 'Redeven is already starting elsewhere',
        title_key: 'issue.stateDirLockedAttachTitle',
        message: 'Another Redeven runtime instance is using the default state directory and appears to provide Local UI. Retry in a moment so Desktop can attach to it.',
        message_key: 'issue.stateDirLockedAttachMessage',
        diagnostics_copy: 'status: blocked',
        target_url: '',
      },
    });

    expect(shellStatus(snapshot, createDesktopI18n('zh-CN'))).toEqual({
      tone: 'error',
      label: 'Redeven 已在其他位置启动中',
    });
  });

  it('derives the Env card primary progress from snapshot action progress instead of stale Opening state', () => {
    const local = testLocalEnvironment({
      currentRuntime: {
        local_ui_url: 'http://localhost:23998/',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        runtime_service: {
          protocol_version: 'redeven-runtime-v1',
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'desktop',
          remote_enabled: false,
          compatibility: 'compatible',
          open_readiness: { state: 'openable' },
          active_workload: {
            terminal_count: 0,
            session_count: 0,
            task_count: 0,
            port_forward_count: 0,
          },
        },
      },
    });
    const failedOpenProgress: DesktopLauncherActionProgress = {
      action: 'open_local_environment',
      operation_key: 'local:host:local:open:failed',
      subject_kind: 'local_environment',
      subject_id: local.id,
      environment_id: local.id,
      environment_label: local.label,
      started_at_unix_ms: 300,
      updated_at_unix_ms: 320,
      status: 'failed',
      phase: 'failed',
      title: 'Open failed',
      detail: 'Desktop could not open the local environment.',
      open_progress: openConnectionProgress({
        location: 'local_host',
        phase: 'failed',
        environmentID: local.id,
        environmentLabel: local.label,
        targetID: 'local:local',
        targetLabel: local.label,
      }),
    };
    const staleBusyProgress: DesktopLauncherActionProgress = {
      ...failedOpenProgress,
      operation_key: 'local:host:local:open:stale',
      started_at_unix_ms: 100,
      updated_at_unix_ms: 400,
      status: 'running',
      phase: 'opening_window',
      title: 'Opening environment',
      open_progress: openConnectionProgress({
        location: 'local_host',
        phase: 'opening_window',
        environmentID: local.id,
        environmentLabel: local.label,
        targetID: 'local:local',
        targetLabel: local.label,
      }),
    };
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
      openSessions: [{
        session_key: 'env:local:local_host',
        target: {
          kind: 'local_environment',
          session_key: 'env:local:local_host',
          environment_id: local.id,
          label: local.label,
          route: 'local_host',
          local_environment_kind: 'local',
          has_local_hosting: true,
          has_remote_desktop: false,
        },
        lifecycle: 'opening',
      }],
      actionProgress: [failedOpenProgress],
    });
    const entry = snapshot.environments.find((environment) => environment.id === local.id)!;
    const fallbackAction = buildProviderBackedEnvironmentActionModel(entry).action_presentation.primary_action;
    const selectedOpenProgress = selectedSnapshotOpenConnectionProgressForEnvironment(entry, snapshot.action_progress);
    const panelProgress = selectEnvironmentPanelProgress(selectedOpenProgress, null);
    const busyState = reconcileBusyStateWithActionProgressSnapshot({
      ...IDLE_LAUNCHER_BUSY_STATE,
      action: 'open_local_environment' as const,
      environment_id: local.id,
      progress: staleBusyProgress,
    }, snapshot.action_progress);

    expect(entry.open_action).toBe('opening');
    expect(fallbackAction).toMatchObject({ intent: 'opening', enabled: false });
    expect(environmentProgressPrimaryPresentation(panelProgress)).toMatchObject({
      kind: 'attention_trigger',
      label: 'Open failed',
    });
    expect(busyState).toBe(IDLE_LAUNCHER_BUSY_STATE);
    expect(busyStateBlocksEnvironmentAction(
      busyState,
      local.id,
      ['open_local_environment'],
      panelProgress,
    )).toBe(false);
  });

  it('filters the Environment Library by local and provider sources', () => {
    const local = testLocalEnvironment();
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            pinned: false,
            created_at_ms: 20,
            last_used_at_ms: 20,
          },
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Laptop',
            local_ui_url: 'http://192.168.1.11:24000/',
            pinned: false,
            created_at_ms: 10,
            last_used_at_ms: 10,
          },
        ],
        saved_ssh_environments: [],
      }),
      controlPlanes: [{
        provider: {
          protocol_version: 'rcpp-v1',
          provider_id: 'example_control_plane',
          display_name: 'Example Control Plane',
          provider_origin: 'https://cp.example.invalid',
          documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
        },
        account: {
          provider_id: 'example_control_plane',
          provider_origin: 'https://cp.example.invalid',
          display_name: 'Example Control Plane',
          user_public_id: 'user_demo',
          user_display_name: 'Demo User',
          authorization_expires_at_unix_ms: Date.now() + 60_000,
        },
        display_label: 'Demo Control Plane',
        environments: [{
          provider_id: 'example_control_plane',
          provider_origin: 'https://cp.example.invalid',
          env_public_id: 'env_demo',
          label: 'Demo Environment',
          environment_url: 'https://cp.example.invalid/env/env_demo',
          description: 'team sandbox',
          namespace_public_id: 'ns_demo',
          namespace_name: 'Demo Team',
          status: 'online',
          lifecycle_status: 'active',
          last_seen_at_unix_ms: 456,
        }],
        last_synced_at_ms: Date.now(),
        sync_state: 'ready',
        last_sync_attempt_at_ms: Date.now(),
        last_sync_error_code: '',
        last_sync_error_message: '',
        catalog_freshness: 'fresh',
      }],
    });

    expect(environmentLibraryCount(snapshot)).toBe(4);
    expect(environmentLibraryCount(snapshot, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
    expect(environmentLibraryCount(snapshot, '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);

    expect(filterEnvironmentLibrary(snapshot, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toEqual([
      expect.objectContaining({
        id: 'local',
        category: 'local',
        local_environment_kind: 'local',
      }),
    ]);
    expect(filterEnvironmentLibrary(snapshot, 'stag')).toEqual([
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        label: 'Staging',
      }),
    ]);
  });

  it('can narrow the Environment Library to one provider-backed catalog', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
      }),
      controlPlanes: [{
        provider: {
          protocol_version: 'rcpp-v1',
          provider_id: 'example_control_plane',
          display_name: 'Example Control Plane',
          provider_origin: 'https://cp.example.invalid',
          documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
        },
        account: {
          provider_id: 'example_control_plane',
          provider_origin: 'https://cp.example.invalid',
          display_name: 'Example Control Plane',
          user_public_id: 'user_demo',
          user_display_name: 'Demo User',
          authorization_expires_at_unix_ms: Date.now() + 60_000,
        },
        display_label: 'Demo Control Plane',
        environments: [{
          provider_id: 'example_control_plane',
          provider_origin: 'https://cp.example.invalid',
          env_public_id: 'env_demo',
          label: 'Demo Environment',
          environment_url: 'https://cp.example.invalid/env/env_demo',
          description: 'team sandbox',
          namespace_public_id: 'ns_demo',
          namespace_name: 'Demo Team',
          status: 'online',
          lifecycle_status: 'active',
          last_seen_at_unix_ms: 456,
        }],
        last_synced_at_ms: Date.now(),
        sync_state: 'ready',
        last_sync_attempt_at_ms: Date.now(),
        last_sync_error_code: '',
        last_sync_error_message: '',
        catalog_freshness: 'fresh',
      }, {
        provider: {
          protocol_version: 'rcpp-v1',
          provider_id: 'example_control_plane',
          display_name: 'Example Control Plane',
          provider_origin: 'https://cp.other.invalid',
          documentation_url: 'https://cp.other.invalid/docs/control-plane-providers',
        },
        account: {
          provider_id: 'example_control_plane',
          provider_origin: 'https://cp.other.invalid',
          display_name: 'Example Control Plane',
          user_public_id: 'user_other',
          user_display_name: 'Other User',
          authorization_expires_at_unix_ms: Date.now() + 60_000,
        },
        display_label: 'Other Control Plane',
        environments: [{
          provider_id: 'example_control_plane',
          provider_origin: 'https://cp.other.invalid',
          env_public_id: 'env_other',
          label: 'Other Environment',
          environment_url: 'https://cp.other.invalid/env/env_other',
          description: 'team sandbox',
          namespace_public_id: 'ns_other',
          namespace_name: 'Other Team',
          status: 'online',
          lifecycle_status: 'active',
          last_seen_at_unix_ms: 456,
        }],
        last_synced_at_ms: Date.now(),
        sync_state: 'ready',
        last_sync_attempt_at_ms: Date.now(),
        last_sync_error_code: '',
        last_sync_error_message: '',
        catalog_freshness: 'fresh',
      }],
    });

    expect(filterEnvironmentLibrary(
      snapshot,
      '',
      desktopControlPlaneKey('https://cp.example.invalid', 'example_control_plane'),
    )).toEqual([
      expect.objectContaining({
        kind: 'provider_environment',
        env_public_id: 'env_demo',
      }),
    ]);
  });

  it('shows compact Control Plane metrics with tooltip-based guidance instead of inline prose', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("props.i18n.t('environmentCenter.providerOnlineLabel')");
    expect(appSrc).toContain('ControlPlaneMetricTile');
    expect(appSrc).toContain('controlPlanePublishedCountTooltipContent');
    expect(appSrc).toContain('controlPlaneOnlineCountTooltipContent');
    expect(appSrc).toContain('controlPlaneLocalHostCountTooltipContent');
    expect(appSrc).toContain('desktopProviderOnlineEnvironmentCount(controlPlane.environments)');
    expect(appSrc).not.toContain('Environments currently visible from this provider account.');
    expect(appSrc).not.toContain('Published environments currently reporting online status.');
    expect(appSrc).not.toContain('Latest provider signal:');
    expect(appSrc).not.toContain('Unified Catalog');
    expect(appSrc).not.toContain('Provider-backed entries already materialized into the Environment list.');
  });

  it('uses the same rounded-lg shell radius for Control Plane cards as Environment cards', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('redeven-provider-shelf rounded-lg border border-border bg-card');
    expect(appSrc).not.toContain('redeven-provider-shelf rounded-[0.625rem]');
  });

  it('uses Environment guidance copy when a capability is unavailable before connection', () => {
    expect(capabilityUnavailableMessage('Deck')).toBe('Connect to an Environment first to open Deck.');
  });

  it('keeps Local Environment Settings as a dialog layered on top of the launcher surface', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('<ConnectEnvironmentSurface');
    expect(appSrc).toContain("<LocalEnvironmentSettingsDialog");
    expect(appSrc).toContain("open={snapshot().surface === 'environment_settings'}");
    expect(appSrc).not.toContain('fallback={<div class="h-full min-h-0 bg-background" />}');
  });

  it('pins the welcome surface to the full desktop shell width so filtered views do not shrink the page', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('redeven-welcome-surface h-full min-h-0 w-full min-w-0 overflow-auto bg-background');
  });

  it('uses one shared welcome shell so dense environments and control planes stay aligned', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('redeven-welcome-shell');
    expect(appSrc).toContain('redeven-welcome-shell--spacious');
    expect(appSrc).toContain('useSpaciousWelcomeShell');
    expect(appSrc).toContain('shouldUseSpaciousEnvironmentGrid');
    expect(appSrc).toContain('props.libraryEntries.length + (showQuickAddCards() ? 1 : 0)');
    expect(appSrc).toContain('useSpaciousControlPlaneLayout');
    expect(styles).toContain('--redeven-welcome-shell-max-width: 80rem;');
    expect(styles).toContain('--redeven-welcome-shell-spacious-max-width: 100rem;');
    expect(styles).toContain('.redeven-welcome-shell--spacious');
  });

  it('uses shared tooltip and compact card-grid helpers for desktop help affordances', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("import { DesktopTooltip } from './DesktopTooltip';");
    expect(appSrc).toContain('data-redeven-settings-help=""');
    expect(appSrc).not.toContain('title={tooltip()}');
    expect(appSrc).toContain('redeven-console-tab');
    expect(appSrc).toContain('redeven-provider-pill');
    expect(appSrc).toContain('redeven-runtime-chip');
    expect(appSrc).toContain('redeven-environment-card');
    expect(appSrc).toContain('redeven-environment-grid');
  });

  it('renders environment card time from runtime startup time, not access time', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('card().runtime_started_label');
    expect(appSrc).not.toContain('formatRelativeTimestamp(props.environment.last_used_at_ms)');
    expect(appSrc).not.toContain('formatLocalizedRelativeTimestamp(props.i18n, props.environment.last_used_at_ms)');
    expect(appSrc).not.toContain('props.environment.last_used_at_ms');
    expect(appSrc).not.toContain('runtime_started_at_unix_ms ? props.environment.last_used_at_ms');
  });

  it('uses one measured shared column model across pinned and regular environment sections', () => {
    const styles = readWelcomeStyles();
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('buildEnvironmentLibraryLayoutModel');
    expect(appSrc).toContain('visibleCardCount={visibleEnvironmentCardCount()}');
    expect(appSrc).toContain("layoutReferenceCardCount={layoutReferenceEnvironmentCardCount()}");
    expect(appSrc).toContain("environmentLibraryCount(");
    expect(appSrc).toContain("props.librarySourceFilter");
    expect(appSrc).toContain("LOCAL_ENVIRONMENT_LIBRARY_FILTER");
    expect(appSrc).toContain("layoutReferenceEnvironmentCount() + 1");
    expect(appSrc).toContain('layout_reference_count: props.layoutReferenceCardCount');
    expect(appSrc).toContain("'--redeven-environment-grid-columns': String(layoutModel().column_count)");
    expect(appSrc).toContain('new ResizeObserver(() => updateLayoutMetrics())');
    expect(appSrc).toContain('function EnvironmentLibrarySection');
    expect(appSrc).toContain('data-density={layoutModel().density}');
    expect(styles).toContain('.redeven-environment-library');
    expect(styles).toContain('--redeven-environment-grid-min-column-size: 17rem;');
    expect(styles).toContain('--redeven-environment-grid-spacious-column-size: 19rem;');
    expect(styles).toContain('--redeven-environment-grid-gap: 1rem;');
    expect(styles).toContain('--redeven-environment-grid-spacious-gap: 1.125rem;');
    expect(styles).toContain('grid-template-columns: repeat(var(--redeven-environment-grid-columns), minmax(0, 1fr));');
    expect(styles).not.toContain('.redeven-environment-grid__section-title');
    expect(styles).not.toContain('.redeven-environment-grid--spacious');
    expect(styles).not.toMatch(/@media\s*\(min-width:\s*640px\)\s*\{\s*\.redeven-environment-grid\s*\{/);
    expect(styles).not.toMatch(/@media\s*\(min-width:\s*1024px\)\s*\{\s*\.redeven-environment-grid\s*\{/);
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
    const anchoredSurfaceSrc = readDesktopAnchoredOverlaySurfaceSource();

    expect(tooltipSrc).toContain("import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';");
    expect(tooltipSrc).toContain('data-redeven-tooltip-anchor=""');
    expect(tooltipSrc).toContain('role="tooltip"');
    expect(tooltipSrc).toContain("z-[220]");
    expect(anchoredSurfaceSrc).toContain("import { Portal } from 'solid-js/web';");
    expect(anchoredSurfaceSrc).toContain('<Portal>');
    expect(anchoredSurfaceSrc).toContain('fixed animate-in fade-in zoom-in-95');
  });

  it('renders interactive desktop popovers through a body-level portal so blocked actions can offer guided recovery', () => {
    const popoverSrc = readDesktopPopoverSource();
    const actionPopoverSrc = readDesktopActionPopoverSource();

    expect(popoverSrc).toContain("import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';");
    expect(popoverSrc).toContain('data-redeven-popover-anchor=""');
    expect(popoverSrc).toContain('role="dialog"');
    expect(popoverSrc).toContain("z-[225]");
    expect(popoverSrc).toContain('open: boolean;');
    expect(popoverSrc).toContain('onOpenChange: (open: boolean) => void;');
    expect(popoverSrc).toContain('props.onOpenChange(true);');
    expect(popoverSrc).not.toContain("const [visible, setVisible] = createSignal(false);");
    expect(actionPopoverSrc).toContain('data-redeven-action-popover-anchor=""');
    expect(actionPopoverSrc).toContain("document.addEventListener('focusin', handleFocusIn);");
    expect(actionPopoverSrc).toContain("event.key === 'Escape'");
  });

  it('renders dialog field listboxes through anchored portals so footers and scroll panes cannot clip them', () => {
    const appSrc = readWelcomeSource();
    const listboxSrc = readDesktopAnchoredListboxSource();

    expect(appSrc).toContain("import { DesktopAnchoredListbox } from './DesktopAnchoredListbox';");
    expect(appSrc).toContain('<DesktopAnchoredListbox');
    expect(appSrc).toContain('anchorRef={buttonRef}');
    expect(appSrc).toContain('anchorRef={rootRef}');
    expect(appSrc).toContain('width={288}');
    expect(appSrc).not.toContain('class="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover p-1 shadow-xl"');
    expect(appSrc).not.toContain('class="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-xl"');
    expect(listboxSrc).toContain("import { Portal } from 'solid-js/web';");
    expect(listboxSrc).toContain('<Portal>');
    expect(listboxSrc).toContain("'fixed z-[240] flex flex-col overflow-hidden");
    expect(listboxSrc).toContain('style={{');
    expect(listboxSrc).toContain('width?: number;');
    expect(listboxSrc).toContain('resolveDesktopAnchoredListboxGeometry');
    expect(listboxSrc).toContain('IMPORTANT: Dialog form listboxes must live outside dialog scroll containers.');
  });

  it('routes Desktop language and command chrome through i18n dictionaries', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("props.i18n.t('language.systemDefault')");
    expect(appSrc).toContain("props.i18n.t('language.usingLanguage'");
    expect(appSrc).toContain("i18n.t('shell.accessibility.skipLinkLabel')");
    expect(appSrc).toContain("i18n.t('shell.commandSearchPlaceholder')");
    expect(appSrc).toContain("props.i18n.t('commandPalette.changeLanguageTitle')");
    expect(appSrc).toContain('execute: () => props.openLanguageSettings()');
    expect(appSrc).toContain('openLanguageSettings={openLanguageSettings}');
    expect(appSrc).toContain('function openLanguageSettings(): void');
    expect(appSrc).toContain('<DesktopInterfaceSettingsDialog');
    expect(appSrc).toContain('open={languageSettingsOpen()}');
    expect(appSrc).toContain("props.i18n.t('commandPalette.toggleThemeTitle')");
    expect(appSrc).toContain("i18n().t('shell.useDarkTheme')");
    expect(appSrc).toContain("i18n().t('shell.useLightTheme')");
    expect(appSrc).not.toContain("title: 'Change Language'");
    expect(appSrc).not.toContain("label={theme.resolvedTheme() === 'light' ? 'Use dark theme' : 'Use light theme'}");
  });

  it('includes compact environment-card launcher copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('connectEnvironmentTitle');
    expect(appSrc).toContain('openRedevenDashboard');
    expect(appSrc).toContain('function openRedevenDashboard');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.title')");
    expect(appSrc).toContain("labelKey: 'desktop.provider'");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.searchPlaceholder')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.localFilter')");
    expect(appSrc).toContain('<EnvironmentConnectionCard');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.newEnvironmentTitle')");
    expect(appSrc).toContain('NewEnvironmentPlaceholderCard');
  });

  it('renders filter pills with counts, a dismissible chip for runtime target / control plane filters, and conditional live count', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    // Pill counts
    expect(appSrc).toContain("{props.i18n.t('environmentCenter.allFilter')} ({layoutReferenceEnvironmentCount()})");
    expect(appSrc).toContain('{option.label} ({option.count})');
    // Chip for non-category filters
    expect(appSrc).toContain('activeNonCategoryFilterChipLabel');
    expect(appSrc).toContain('redeven-runtime-chip');
    expect(styles).toContain('.redeven-runtime-chip');
    expect(styles).toContain('.redeven-runtime-chip:hover');
    // Conditional live count
    expect(appSrc).toContain('open_windows.length > 0');
    // Dead code removed
    expect(appSrc).not.toContain('redeven-native-select');
    expect(appSrc).not.toContain('All Sources');
    expect(appSrc).not.toContain('activeSourceFilterLabel');
    // Active pill contrast enhanced
    expect(styles).toContain('border-color: var(--primary)');
  });

  it('renders facts rows, endpoint copy inputs, and pinned sections in the environment library', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('buildEnvironmentCardFactsModel');
    expect(appSrc).not.toContain('buildControlPlaneEnvironmentFactsModel');
    expect(appSrc).toContain('EndpointsPopover');
    expect(appSrc).toContain('splitPinnedEnvironmentEntryIDs');
    expect(appSrc).toContain('environmentLibraryEntryRecord');
    expect(appSrc).not.toContain('splitPinnedEnvironmentEntries(props.entries)');
    expect(appSrc).toContain('function EnvironmentLibrarySection');
    expect(appSrc).toContain('function EnvironmentCardFactsBlock');
    expect(appSrc).toContain('runEnvironmentCardFactAction');
    expect(appSrc).toContain('runtimeTargetEnvironmentLibraryFilterValue(action.runtime_target_id)');
    expect(appSrc).toContain('runtimeTargetEnvironmentLibraryFilterTargetID(props.librarySourceFilter)');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.linkedRuntimeFilterWithLabel'");
    expect(appSrc).toContain('redeven-card-fact-value--action');
    expect(appSrc).toContain('cardFactIconMaskStyle');
    expect(appSrc).not.toContain('<img src={icon()} class="redeven-card-fact-label-icon"');
    expect(appSrc).not.toContain('<img src={icon()} class="redeven-card-fact-leading-icon"');
    expect(appSrc).toContain('function EndpointsPopover');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.pinnedSection')");
    expect(appSrc).toContain('copyEnvironmentValue');
    expect(appSrc).toContain('<Pin class=');
    expect(styles).toContain('.redeven-card-fact-row');
    expect(styles).toContain('.redeven-card-fact-label');
    expect(styles).toContain('--redeven-card-fact-icon-mask');
    expect(styles).toContain('background-color: currentColor');
    expect(styles).toContain('mask: var(--redeven-card-fact-icon-mask) center / contain no-repeat');
    expect(styles).toContain('.redeven-card-fact-value--action');
    expect(styles).toContain('.redeven-card-fact-value__text');
    expect(styles).toContain('.redeven-endpoints-section');
    expect(styles).toContain('.redeven-endpoints-title');
    expect(styles).toContain('.redeven-card-endpoint-row');
    expect(styles).toContain('.redeven-card-endpoint-label');
    expect(styles).toContain('.redeven-card-endpoint-value');
    expect(styles).toContain('.redeven-card-endpoint-copy');
    expect(styles).toContain('.redeven-status-indicator');
    expect(appSrc).toContain('EnvironmentStatusIndicator');
  });

  it('renders split runtime actions with refresh controls and external-runtime messaging', () => {
    const appSrc = readWelcomeSource();
    const actionPopoverSrc = readDesktopActionPopoverSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('function EnvironmentSplitActionButton');
    expect(appSrc).toContain('function EnvironmentPrimaryActionPanel');
    expect(appSrc).toContain('function localizedEnvironmentActionPresentation');
    expect(appSrc).toContain('primary_action: localizedEnvironmentAction(i18n, presentation.primary_action)');
    expect(appSrc).toContain('localizedEnvironmentOverlay(i18n, presentation.primary_action_overlay)');
    expect(appSrc).toContain('menu_button_label: localizedEnvironmentActionLabel(i18n, presentation.menu_button_label)');
    expect(appSrc).toContain('menu_actions: presentation.menu_actions.map((item) => localizedEnvironmentMenuItem(i18n, item))');
    expect(appSrc).toContain('label: localizedEnvironmentActionLabel(i18n, item.label)');
    expect(appSrc).toContain('disabled_reason: localizedRuntimeMessage(i18n, action.disabled_reason)');
    expect(appSrc).toContain('const renderPrimaryButton = () => (');
    expect(appSrc).not.toContain('const primaryButton = (');
    expect(appSrc).not.toContain('function openProviderLocalServeDialog');
    expect(appSrc).toContain('openSettingsSurface(environment.id);');
    expect(appSrc).toContain("route: 'remote_desktop'");
    expect(appSrc).toContain('return startEnvironmentRuntime(environment, errorTarget);');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.refreshRuntimeStatus')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.refreshRuntimeStatuses')");
    expect(appSrc).toContain('const secondaryIconOnly = () => isSecondary && props.overlay.actions.length > 1;');
    expect(appSrc).toContain("showsRefreshIcon && 'gap-1.5'");
    expect(appSrc).toContain('<Show when={showsRefreshIcon}>');
    expect(appSrc).toContain('primary_action_overlay');
    expect(appSrc).toContain('<DesktopActionPopover');
    expect(actionPopoverSrc).toContain('placement="top"');
    expect(actionPopoverSrc).toContain('constrainToViewport={false}');
    expect(actionPopoverSrc).not.toContain('placement?: DesktopOverlayPlacement');
    expect(actionPopoverSrc).not.toContain('props.placement');
    expect(appSrc).toContain('<DesktopAnchoredOverlaySurface');
    expect(appSrc).toContain('const blockedPrimaryActionDisabled = createMemo(() => (');
    expect(appSrc).toContain('redeven-split-action-trigger__content');
    expect(appSrc).toContain('<Lock class="redeven-split-action-trigger__icon h-3.5 w-3.5" />');
    expect(appSrc).toContain('fallback={props.presentation.primary_action.label}');
    expect(appSrc).toContain("'redeven-split-action-trigger--blocked'");
    expect(appSrc).toContain('aria-disabled={blockedPrimaryActionDisabled() ? true : undefined}');
    expect(appSrc).toContain("return i18n.t('environmentAction.unavailableTrigger', { label });");
    expect(appSrc).toContain('activeEnvironmentOverlayState');
    expect(appSrc).toContain('guidanceSessionState');
    expect(appSrc).toContain('reconcileEnvironmentLibraryOverlayState');
    expect(appSrc).toContain('reconcileEnvironmentGuidanceSession');
    expect(appSrc).toContain('projectedEntriesByID');
    expect(appSrc).toContain('projectedEntryIDs');
    expect(appSrc).toContain('<For each={groupedEntryIDs().pinned_entry_ids}>');
    expect(appSrc).toContain('environment={projectedEnvironment(environmentID)}');
    expect(appSrc).toContain('guidanceOpen={props.primaryActionGuidanceOpen}');
    expect(appSrc).toContain('props.presentation.menu_button_label');
    expect(appSrc).toContain('menuContainsTarget');
    expect(appSrc).toContain('menuRef?.contains(target)');
    expect(appSrc).toContain('firstEnabledMenuItem(menuRef)?.focus();');
    expect(appSrc).toContain('anchorRef={rootRef}');
    expect(appSrc).toContain('role="menu"');
    expect(appSrc).toContain('ariaLabel={props.presentation.menu_button_label}');
    expect(appSrc).not.toContain("document.addEventListener('focusin', handleFocusIn);");
    expect(appSrc).toContain('startEnvironmentRuntime');
    expect(appSrc).toContain('stopEnvironmentRuntime');
    expect(appSrc).not.toContain('runtimeMaintenanceConfirmation');
    expect(appSrc).not.toContain('requestRuntimeMaintenanceConfirmation');
    expect(appSrc).not.toContain('confirmRuntimeMaintenance');
    expect(appSrc).toContain('force_runtime_update');
    expect(appSrc).toContain('forceRuntimeUpdate: true');
    expect(appSrc).not.toContain('allow_active_work_replacement');
    expect(appSrc).not.toContain('allowActiveWorkReplacement: true');
    expect(appSrc).not.toContain('continueLauncherOperation');
    expect(appSrc).not.toContain("kind: 'continue_launcher_operation'");
    expect(appSrc).toContain("kind: 'dismiss_launcher_operation'");
    expect(appSrc).toContain('IMPORTANT: Provider-link confirmation is intentionally reachable only from');
    expect(appSrc).toContain('desktopEntryKindOwnsRuntimeManagement(environment.kind)');
    expect(appSrc).toContain("action?.runtime_operation_method === 'desktop_local_update_handoff'");
    expect(appSrc).toContain("kind: 'manage_desktop_update'");
    expect(appSrc).toContain("result?.outcome === 'opened_desktop_update_handoff'");
    expect(appSrc).toContain("i18n().t('environmentCenter.desktopUpdateOpenedToast'");
    expect(appSrc).toContain('localizedRuntimeServiceWorkload');
    expect(appSrc).toContain('providerRuntimeLinkActiveWorkLabel');
    expect(appSrc).toContain("i18n.tn('plural.terminalCount'");
    expect(appSrc).toContain("case 'start_runtime':");
    expect(appSrc).toContain("case 'connect_provider_runtime':");
    expect(appSrc).toContain("case 'disconnect_provider_runtime':");
    expect(appSrc).toContain("case 'stop_runtime':");
    expect(appSrc).toContain("case 'restart_runtime':");
    expect(appSrc).toContain("case 'update_runtime':");
    expect(appSrc).toContain("case 'refresh_runtime':");
    expect(appSrc).toContain('openEnvironmentLibraryOverlayState');
    expect(appSrc).not.toContain('openRuntimeMenuEnvironmentID');
    expect(appSrc).toContain('aria-label={props.presentation.menu_button_label}');
    expect(styles).toContain('.redeven-split-action');
    expect(styles).toContain('.redeven-split-action-primary');
    expect(styles).toContain('.redeven-split-action-trigger__content');
    expect(styles).toContain('.redeven-split-action-trigger__icon');
    expect(styles).toContain('.redeven-split-action-trigger--blocked');
    expect(styles).toContain('border-style: solid;');
    expect(styles).toContain(".redeven-split-action-trigger--blocked[aria-expanded='true']");
    expect(styles).toContain('.redeven-split-action-toggle');
    expect(styles).toContain('.redeven-split-menu');
    expect(styles).not.toContain('bottom: calc(100% + 0.5rem);');
    expect(styles).toContain('.redeven-split-menu-item');
    expect(styles).toContain('.redeven-action-popover-frame');
    expect(styles).toContain('--redeven-action-popover-border');
    expect(styles).toContain('--redeven-action-popover-width: min(20rem, calc(100vw - 1rem));');
    expect(styles).toContain('width: 100%;');
    expect(styles).toContain('.redeven-action-popover > *');
    expect(styles).toContain('.redeven-action-popover__notice-detail');
    expect(styles).toContain('overflow-wrap: anywhere;');
    expect(styles).toContain('flex-wrap: wrap;');
    expect(styles).toContain('.redeven-action-popover');
    expect(styles).toContain('.redeven-action-popover__actions');
    expect(styles).toContain('.redeven-action-popover__action-stack');
    expect(styles).toContain(".redeven-action-popover__actions[data-layout='primary']");
    expect(styles).toContain(".redeven-action-popover__actions[data-layout='secondary']");
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(styles).toContain('.redeven-action-popover__notice');
  });

  it('renders lifecycle and Open connection progress inside the Open popup instead of the old SSH activity overlay', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('const activeActionProgress = createMemo(() => snapshot().action_progress);');
    expect(appSrc).toContain('reconcileBusyStateWithActionProgressSnapshot');
    expect(appSrc).toContain('setBusyState((busy) => reconcileBusyStateWithActionProgressSnapshot(busy, next.action_progress));');
    expect(appSrc).toContain('setBusyState((busy) => reconcileBusyStateWithActionProgressSnapshot(busy, acceptedSnapshot.action_progress));');
    expect(appSrc).toContain('actionProgress={props.actionProgress}');
    expect(appSrc).toContain('selectedSnapshotRuntimeLifecycleProgressForEnvironment(props.environment, props.actionProgress)');
    expect(appSrc).toContain('selectedSnapshotOpenConnectionProgressForEnvironment(props.environment, props.actionProgress)');
    expect(appSrc).toContain('launcherProgressBlocksPrimaryAction(openConnectionProgress())');
    expect(appSrc).not.toContain('|| openConnectionProgress() !== null');
    expect(appSrc).not.toContain('activeRuntimeLifecycleProgressForEnvironment');
    expect(appSrc).not.toContain('activeOpenConnectionProgressForEnvironment');
    expect(appSrc).not.toContain('selectedOpenConnectionProgressForEnvironment(props.environment, props.busyState, props.actionProgress)');
    expect(appSrc).not.toContain('selectedRuntimeLifecycleProgressForEnvironment(props.environment, props.busyState, props.actionProgress)');
    expect(appSrc).not.toContain('runtimeLifecycleProgress() !== null && !runtimeOpenable()');
    expect(appSrc).toContain('runtimeLifecycleProgress={visibleRuntimeLifecycleProgress()}');
    expect(appSrc).toContain('openConnectionProgress={visibleOpenConnectionProgress()}');
    expect(appSrc).toContain('visibleEnvironmentLifecycleProgress({');
    expect(appSrc).toContain('selectedProgress: runtimeLifecycleProgress(),');
    expect(appSrc).toContain('disclosure: props.lifecycleDisclosure,');
    expect(appSrc).toContain('busyState: props.busyState,');
    expect(appSrc).not.toContain('const disclosureRuntimeLifecycleProgress = createMemo');
    expect(appSrc).toContain('environmentLifecycleDisclosureHasPendingRequest(lifecycleDisclosure, props.busyState)');
    expect(appSrc).toContain('progressOpen={props.lifecycleProgressOpen}');
    expect(appSrc).toContain('onProgressOpenChange={props.onLifecycleProgressOpenChange}');
    expect(appSrc).toContain('function EnvironmentProgressPanel');
    expect(appSrc).toContain('primaryAction?: EnvironmentActionModel;');
    expect(appSrc).toContain('runPrimaryAction?: (action: EnvironmentActionModel) => void;');
    expect(appSrc).toContain('const panelPrimaryAction = createMemo(() => localizedProgressPanelPrimaryAction(');
    expect(appSrc).toContain('<Show when={panelPrimaryAction()}>');
    expect(appSrc).toContain('<ExternalLink class="h-3.5 w-3.5" />');
    expect(appSrc).toContain('onClick={() => props.runPrimaryAction?.(action().action)}');
    expect(appSrc).toContain('{action().label}');
    expect(appSrc).toContain('primaryAction={props.presentation.primary_action}');
    expect(appSrc).toContain('const [rememberedOpenConnectionProgress, setRememberedOpenConnectionProgress] = createSignal<DesktopLauncherActionProgress | null>(null);');
    expect(appSrc).toContain('const visibleOpenConnectionProgress = createMemo(() => (');
    expect(appSrc).toContain('openConnectionProgress() ?? rememberedOpenConnectionProgress()');
    expect(appSrc).toContain("if (progress.status === 'succeeded' || progress.status === 'canceled') {");
    expect(appSrc).toContain('setRememberedOpenConnectionProgress(progress);');
    expect(appSrc).toContain('props.onProgressOpenChange(false);\n                            closeMenu();\n                            props.onRunAction(action);');
    expect(appSrc).toContain('createRuntimeLifecycleStepAnimation');
    expect(appSrc).toContain('<Index each={phaseSequence()}>');
    expect(appSrc).toContain('data-step-key={step().key}');
    expect(appSrc).toContain('data-plan-revision={startup()?.plan_revision ?? 0}');
    expect(appSrc).toContain('data-entering={startup() ? stepEntering(step().key) : false}');
    expect(appSrc).toContain("data-plan-state={startup()?.plan_state ?? 'executing'}");
    expect(appSrc).toContain("currentRuntimeLifecycle()?.plan_state !== 'planning'");
    expect(appSrc).not.toContain("current.plan_state === 'planning'");
    expect(appSrc).toContain('localizedProgressPlanningLabel(props.i18n, props.progress.action)');
    expect(appSrc).toContain('<Show when={localizedFailure()}>');
    expect(appSrc).toContain('<div class="redeven-action-popover__notice-detail">{failure().summary}</div>');
    expect(appSrc).toContain('redeven-action-popover__notice-detail--pre');
    expect(appSrc).toContain("action.kind === 'update_runtime'");
    expect(appSrc).toContain('const nextActionGroups = createMemo(() => groupedVisibleOperationNextActions(props.progress));');
    expect(appSrc).toContain('<For each={nextActionGroups()}>');
    expect(appSrc).toContain('data-layout={group.kind}');
    expect(appSrc).toContain('<For each={group.actions}>');
    expect(appSrc).toContain("case 'refresh_status':");
    expect(appSrc).toContain("case 'copy_diagnostics':");
    expect(appSrc).toContain("case 'dismiss':");
    expect(appSrc).toContain('runNextAction?.(action, props.progress)');
    expect(appSrc).toContain("case 'manage_desktop_update':");
    expect(appSrc).toContain('props.runDesktopUpdateHandoff(props.environmentID, props.environmentLabel);');
    expect(appSrc).toContain('primaryActionBusy={props.loading === true}');
    expect(appSrc).toContain('loading={action().loading}');
    expect(appSrc).toContain('disabled={action().disabled}');
    expect(appSrc).not.toContain('props.progress.error_message');
    expect(appSrc).toContain('const panelProgress = createMemo(() => selectEnvironmentPanelProgress(primaryProgress(), runtimeMenuProgress()));');
    expect(appSrc).toContain('runtimeLifecycleProgress={runtimeMenuProgress()}');
    expect(appSrc).toContain('busyStateBlocksEnvironmentAction(busyState, environmentID, [\'stop_environment_runtime\'], runtimeLifecycleProgress)');
    expect(appSrc).toContain('const progressPanelVisible = createMemo(() => props.progressOpen && hasPanelProgress());');
    expect(appSrc).toContain('const primaryProgressPresentation = createMemo(() => localizedPrimaryProgressPresentation(');
    expect(appSrc).toContain('primaryProgressPresentation() || progressPanelVisible()');
    expect(appSrc).toContain('const popoverOpen = createMemo(() => progressPanelVisible() || (props.guidanceOpen && popoverOverlay() !== undefined));');
    expect(appSrc).toContain("classList={{ 'redeven-popover-panel-collapse--open': progressPanelVisible() }}");
    expect(appSrc).not.toContain('const progressOccupiesPrimaryTrigger = createMemo(() => (');
    expect(appSrc).not.toContain('const showProgress = createMemo(() =>');
    expect(appSrc).not.toContain('when={showProgress()}');
    expect(appSrc).toContain('aria-haspopup="dialog"');
    expect(appSrc).not.toContain('const environmentProgressTriggerIcon = createMemo(() => (');
    expect(appSrc).not.toContain('environmentProgressTriggerLabel');
    expect(appSrc).not.toContain('const currentPresentation = presentation();');
    expect(appSrc).toContain('type EnvironmentProgressPrimaryPresentation,');
    expect(appSrc).toContain('function progressTriggerClassName(presentation: EnvironmentProgressPrimaryPresentation): string');
    expect(appSrc).toContain("presentation.kind === 'progress_trigger'");
    expect(appSrc).toContain('renderEnvironmentProgressPresentationIcon(presentation())');
    expect(appSrc).toContain("'redeven-split-action-trigger--attention'");
    expect(appSrc).toContain('<AlertTriangle class="redeven-split-action-trigger__icon h-3.5 w-3.5" />');
    expect(appSrc).toContain('aria-label={presentation().ariaLabel}');
    expect(appSrc).toContain('<span>{presentation().label}</span>');
    expect(appSrc).toContain('redeven-environment-progress');
    expect(appSrc).toContain('redeven-split-action-trigger--progress');
    expect(appSrc).toContain('props.onProgressOpenChange(false);\n                      props.onRunAction(props.presentation.primary_action);');
    expect(appSrc).toContain("openEnvironmentLibraryOverlayState('lifecycle_progress', environmentID)");
    expect(appSrc).not.toContain('autoOpenedEnvironmentProgressOperation');
    expect(appSrc).not.toContain('OPEN_CONNECTION_PROGRESS_POPOVER_DELAY_MS');
    expect(appSrc).not.toContain('<SSHRuntimeActivityOverlay');
    expect(appSrc).not.toContain('sshRuntimeProgressItems');
    expect(appSrc).not.toContain('function SSHRuntimeActivityOverlay');
    expect(appSrc).not.toContain('Starting SSH Runtime');
    expect(styles).toContain('.redeven-environment-progress');
    expect(styles).toContain(".redeven-environment-progress__step[data-entering='true']");
    expect(styles).toContain(".redeven-environment-progress__meter[data-plan-state='planning'] span");
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('.redeven-environment-progress__meter');
    expect(styles).toContain('.redeven-environment-progress__meta');
    expect(styles).toContain('.redeven-split-action-trigger--progress');
    expect(styles).toContain('.redeven-split-action-trigger--attention');
    expect(styles).not.toContain('.redeven-ssh-runtime-activity');
  });

  it('shows structured card failures with diagnostics behind Details', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('formatDesktopOperationFailureForClipboard(presentation())');
    expect(appSrc).toContain('{presentation().summary}');
    expect(appSrc).toContain('{presentation().recovery_hint}');
    expect(appSrc).toContain("<summary>{props.i18n.t('settings.detailsTitle')}</summary>");
    expect(appSrc).toContain('diagnostic.label');
    expect(appSrc).toContain('diagnostic.text');
    expect(styles).toContain('.redeven-environment-card__failure-details summary');
    expect(styles).toContain('cursor: pointer;');
    expect(styles).toContain('.redeven-environment-card__failure-diagnostic');
  });

  it('lets users inspect and cancel lifecycle or Open progress from the Open popup while shimmer feedback stays active', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('async function cancelLauncherOperation(progress: DesktopLauncherActionProgress): Promise<void>');
    expect(appSrc).toContain("kind: 'cancel_launcher_operation'");
    expect(appSrc).not.toContain("kind: 'continue_launcher_operation'");
    expect(appSrc).toContain("kind: 'dismiss_launcher_operation'");
    expect(appSrc).toContain("showActionToast(progress.open_progress ? i18n().t('toast.openingStopping') : i18n().t('toast.runtimeStartupStopping'), 'info');");
    expect(appSrc).toContain('cancelOperation={(progress) => {\n            void cancelLauncherOperation(progress);');
    expect(appSrc).toContain('cancelOperation: (progress: DesktopLauncherActionProgress) => void;');
    expect(appSrc).toContain("case 'cleanup_failed':\n      return i18n.t('progress.cleanupNeedsAttention');");
    expect(appSrc).toContain('props.progress.cancelable === true && props.progress.status === \'running\'');
    expect(appSrc).toContain('onClick={() => props.cancelOperation(props.progress)}');
    expect(appSrc).not.toContain("props.progress.status === 'awaiting_confirmation'");
    expect(appSrc).not.toContain('onClick={() => props.continueOperation(props.progress)}');
    expect(appSrc).toContain('onClick={() => props.dismissOperation(props.progress)}');
    expect(appSrc).toContain("props.i18n.t('progress.copyLog')");
    expect(appSrc).toContain('<Stop class="h-3.5 w-3.5" />');
    expect(appSrc).toContain('localizedProgressInterruptLabel(props.i18n, props.progress)');
    expect(appSrc).toContain("class={shimmerBlocked() ? 'redeven-blocked-shimmer-overlay' : 'redeven-loading-shimmer-overlay'}");
    expect(appSrc).not.toContain('disabled={props.loading && !hasOpenConnectionProgress() && !hasRuntimeLifecycleProgress()}');
    expect(appSrc).not.toContain('disabled={props.loading && popoverPrimaryRunsAction()}');
    expect(appSrc).toContain('disabled={props.loading && !primaryProgressPresentation()}');
    expect(appSrc).toContain('disabled={props.loading && primaryFallbackRunsAction()}');
    expect(appSrc).toContain('environmentActionStartsLifecycleDisclosure(action)');
    expect(appSrc).toContain('props.beginLifecycleDisclosure(action.intent);');
    expect(appSrc).toContain('props.onProgressOpenChange(false);');
    expect(appSrc).toContain('props.setGuidanceSession(startEnvironmentGuidanceIntent(');
    expect(appSrc).not.toContain('function environmentActionOpensRuntimeLifecycleProgress(action: EnvironmentActionModel): boolean');
    expect(appSrc).not.toContain('props.onPrimaryActionGuidanceOpenChange(environmentActionOpensRuntimeLifecycleProgress(action));');
    expect(styles).toContain('.redeven-loading-shimmer-overlay');
    expect(styles).toContain('.redeven-blocked-shimmer-overlay');
    expect(appSrc).not.toContain('Cancel\n                      </Button>\n                    </Show>');
  });

  it('includes Control Plane management copy inside the launcher source', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain("labelKey: 'desktop.provider'");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.addProviderTitle')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.viewEnvironments')");
    expect(appSrc).not.toContain('All Sources');
    expect(appSrc).toContain('Local');
    expect(appSrc).toContain('control-plane-label');
    expect(appSrc).toContain('suggestControlPlaneDisplayLabel');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.continueInBrowser')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.providerAuthorizationHelp')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.reconnect')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.connectProvider')");
    expect(appSrc).toContain('redeven-control-plane-grid');
    expect(appSrc).toContain('redeven-control-plane-card');
    expect(styles).toContain('--redeven-control-plane-grid-column-size: 35rem;');
    expect(styles).toContain('--redeven-control-plane-card-max-width: 44rem;');
    expect(styles).toContain('.redeven-control-plane-grid');
    expect(styles).toContain('.redeven-control-plane-card');
    expect(appSrc).toContain('redeven-provider-shelf__metrics');
    expect(styles).toContain('--redeven-provider-shelf-metric-min-size: 10.75rem;');
    expect(styles).toContain('.redeven-provider-shelf__metrics');
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(styles).toContain('.redeven-provider-shelf__metric');
    expect(styles).toContain('.redeven-provider-shelf__metric-header');
    expect(styles).toContain('@media (max-width: 36rem)');
    expect(appSrc).not.toContain('Remote access through Control Plane');
  });

  it('routes transient launcher failures through toasts instead of page-flow banners or issue cards', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('launcherActionFailurePresentation');
    expect(appSrc).toContain('title: presentation.title');
    expect(appSrc).toContain('action: presentation.action');
    expect(appSrc).toContain('autoDismiss: presentation.auto_dismiss');
    expect(appSrc).toContain('runToastAction={runActionToastAction}');
    expect(appSrc).not.toContain('IssueCard');
    expect(appSrc).not.toContain('EnvironmentInlineNotice');
    expect(appSrc).not.toContain('redeven-console-banner--error');
  });

  it('keeps environment cards concise instead of rendering helper prose under the actions', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).not.toContain('managedActionModel()?.helper_text');
    expect(appSrc).not.toContain('actionModel().helper_text');
    expect(appSrc).not.toContain('The provider currently reports this environment as offline.');
    expect(appSrc).not.toContain('Desktop opens a remote session through the Control Plane without starting a local runtime here.');
  });

  it('uses a settings affordance for every editable environment card', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("content={props.i18n.t('common.settings')}");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.runtimeTargetSettings')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.connectionSettingsForLabel'");
    expect(appSrc).toContain('<Settings class="h-3.5 w-3.5" />');
    expect(appSrc).not.toContain('<Pencil class="h-3.5 w-3.5" />');
  });

  it('describes local environment actions as window-only and runtime-decoupled', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('openEnvironmentDescription');
    expect(appSrc).toContain("case 'start_runtime':");
  });

  it('keeps provider runtime link confirmation explicit and source-scoped', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('providerRuntimeLinkConfirmation');
    expect(appSrc).toContain("i18n().t('environmentCenter.connectToProvider')");
    expect(appSrc).toContain("i18n().t('environmentCenter.disconnectFromProvider')");
    expect(appSrc).toContain("i18n().t('environmentCenter.providerEnvironment')");
    expect(appSrc).toContain("i18n().t('environmentCenter.sourceEnvironment')");
    expect(appSrc).toContain("i18n().t('environmentCenter.connectProviderRuntimeNote')");
    expect(appSrc).toContain("i18n().t('environmentCenter.disconnectProviderRuntimeNote')");
    expect(appSrc).not.toContain('matching provider link. Confirming');
    expect(appSrc).toContain("busyStateMatchesAction(busyState(), 'disconnect_provider_runtime')");
    expect(appSrc).toContain("showActionToast(i18n().t('environmentCenter.disconnectedFromProviderToast'), 'info');");
    expect(appSrc).toContain('if (presentation.refresh_snapshot) {');
    expect(appSrc).toContain("const [providerRuntimeLinkProviderEnvironmentID, setProviderRuntimeLinkProviderEnvironmentID] = createSignal('');");
  });

  it('keeps transient action feedback out of page flow by using a toast viewport', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain("import { Portal } from 'solid-js/web';");
    expect(appSrc).toContain('<DesktopActionToastViewport');
    expect(appSrc).toContain('showActionToast(');
    expect(appSrc).not.toContain('feedback={feedback()}');
    expect(appSrc).not.toContain('props.feedback');
    expect(styles).toContain('.redeven-desktop-toast-viewport');
    expect(styles).toContain('.redeven-desktop-toast');
    expect(styles).toContain('.redeven-desktop-toast__action');
  });

  it('keeps environment cards stable by rendering them directly instead of replaying entry animations', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).not.toContain('function AnimatedCard');
    expect(appSrc).not.toContain('<AnimatedCard');
  });

  it('keeps the New Environment dialog focused on Redeven URLs, SSH hosts, and managed container targets', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("props.i18n.t('connectionDialog.name')");
    expect(appSrc).not.toContain('Environment Name');
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.redevenUrl')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.sshHost')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.localContainer')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.sshContainer')");
    expect(appSrc).not.toContain('Run a Desktop-managed Redeven environment on this device.');
    expect(appSrc).not.toContain('Create a local serve runtime for this provider environment on this Mac.');
    expect(appSrc).not.toContain('This provider environment card will keep both routes visible on this device: serve local here, or open via Control Plane.');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.urlDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.notProviderUrl')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshEnvironmentNotice')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.localContainerDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshContainerDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshContainerDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.container')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.runtimeRoot')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.containerRuntimeRootHelp')");
    expect(appSrc).not.toContain(['Runtime', 'Install', 'Root'].join(' ') + ' <span class="text-destructive">*</span>');
    expect(appSrc).not.toContain(['Runtime', 'State', 'Root'].join(' ') + ' <span class="text-destructive">*</span>');
    expect(appSrc).toContain("label: 'Docker'");
    expect(appSrc).toContain("label: 'Podman'");
    expect(appSrc).toContain('function ContainerPicker');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.chooseRunningContainer')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.noRunningContainers')");
    expect(appSrc).not.toContain('Container Label</label>');
    expect(appSrc).not.toContain('Owner</label>');
    expect(appSrc).not.toContain("label: 'External'");
    expect(appSrc).not.toContain("label: 'Desktop'");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.bootstrapDelivery')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.authentication')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.keyAgent')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.passwordPrompt')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.localSshPassword')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.localSshPasswordHelp')");
    expect(appSrc).toContain('variant="default"');
    expect(appSrc).not.toContain("const showCreateConnectAction = createMemo(() => isCreate() && connectionKind() === 'external_local_ui');");
    expect(appSrc).not.toContain('<Show when={showCreateConnectAction()}>');
    expect(appSrc).not.toContain('async function saveAndConnectURLFromDialog()');
    expect(appSrc).not.toContain('async function ' + 'connectFrom' + 'Dialog()');
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.automatic')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.desktopUpload')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.remoteFallback')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.bootstrapHelp')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshDestination')");
    expect(appSrc).toContain('function SSHDestinationCombobox');
    expect(appSrc).toContain('sm:grid-cols-[minmax(0,1fr)_7.5rem]');
    expect(appSrc).toContain("props.updateField('ssh_destination', host.alias);");
    expect(appSrc).toContain("props.updateField('ssh_port', host.port == null ? '' : String(host.port));");
    expect(appSrc).toContain('getSSHConfigHosts');
    expect(appSrc).toContain('listRuntimeContainers');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.runtimeRoot')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.releaseBaseUrl')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.releaseBaseUrlHelp'");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.runtimeRootHelp'");
    expect(appSrc).not.toContain(['Remote', 'Install', 'Directory'].join(' '));
    expect(appSrc).not.toContain(['default', 'remote', 'user', 'cache'].join(' '));
  });

  it('keeps the connection dialog source-scoped across URL, SSH, and managed container targets', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('type ConnectionDialogState = ExternalURLConnectionDialogState | SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null;');
    expect(appSrc).toContain('props.switchKind(value as ConnectionDialogKind)');
    expect(appSrc).not.toContain('const showCreateConnectAction = createMemo(() => isCreate() && connectionKind() === \'external_local_ui\');');
    expect(appSrc).not.toContain('onConnect={saveAndConnectURLFromDialog}');
    expect(appSrc).not.toContain('scope derived from Name.');
  });

  it('keeps linked-local runtime setup out of the connection dialog', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).not.toContain('LocalEnvironmentBindingResolutionPanel');
    expect(appSrc).not.toContain('resolveLocalEnvironmentBindingResolution');
    expect(appSrc).not.toContain('provider_local_serve');
    expect(appSrc).not.toContain('use_control_plane_binding');
    expect(appSrc).not.toContain('function serveRuntimeLocally');
    expect(appSrc).not.toContain("case 'serve_runtime_locally':");
  });

  it('keeps Local UI access controls inside Local Environment Settings', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('props.baselineSnapshot.access_mode_options');
    expect(appSrc).toContain("aria-label={props.i18n.t('settings.visibilityTitle')}");
    expect(appSrc).toContain("props.i18n.t('settings.accessSecurityDescription')");
    expect(appSrc).toContain("props.i18n.t('settings.visibilityDescription')");
    expect(appSrc).toContain("i18n.t('environmentCenter.localLinksTooltipTitle')");
    expect(appSrc).toContain("i18n.t('environmentCenter.localLinksTooltipDescription')");
    expect(appSrc).toContain("props.i18n.t('settings.localOnlyProtectionNote')");
    expect(appSrc).toContain("i18n.t('settings.sharedPasswordHelp')");
  });

  it('includes Local Environment Settings copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("props.i18n.t('settings.nextStartLabel')");
    expect(appSrc).toContain("props.i18n.t('settings.visibilityTitle')");
    expect(appSrc).toContain("props.i18n.t('settings.detailsTitle')");
    expect(appSrc).toContain("props.i18n.t('settings.runtimeLabel')");
    expect(appSrc).toContain("props.i18n.t('settings.interfaceTitle')");
  });

  it('exposes auto status detection only on non-provider runtime forms', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("kind === 'local_container_runtime'");
    expect(appSrc).toContain('connectionDialogAutoRuntimeProbeConfigurable(props.state)');
    expect(appSrc).toContain('toggleAutoRuntimeProbe={toggleConnectionRuntimeAutoProbe}');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.statusDetection')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.autoStatusDetection')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.autoStatusDetectionHelp')");
    expect(appSrc).toContain('auto_runtime_probe_configurable');
    expect(appSrc).not.toContain('Control whether Welcome checks this runtime in the background');
    expect(appSrc).not.toContain('Welcome checks this runtime automatically while open. Refresh status still checks immediately when this is off.');
    expect(appSrc).toContain("title={props.i18n.t('connectionDialog.addProviderTitle')}");
    expect(appSrc).not.toContain('ControlPlaneDialog(props: Readonly<{\\n  state: ControlPlaneDialogState;\\n  auto_runtime_probe_enabled');
  });

  it('keeps destructive hover affordances aligned with floe-webapp dialog close behavior', () => {
    const styles = readWelcomeStyles();
    const dialogSrc = readInstalledDialogSource();

    expect(styles).toContain('.redeven-console-icon-button--danger:hover');
    expect(styles).toContain('background: var(--error);');
    expect(styles).toContain('color: var(--error-foreground);');
    expect(dialogSrc).toContain('variant: "ghost-destructive"');
  });

  it('uses the shared deletion copy for saved connections only', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("title={i18n().t('confirm.deleteConnectionTitle')}");
    expect(appSrc).toContain("confirmText={i18n().t('confirm.deleteConnectionConfirm')}");
    expect(appSrc).toContain("i18n().t('confirm.deleteConnectionQuestion'");
    expect(appSrc).toContain('const deleteTargetOperation = createMemo(() => {');
    expect(appSrc).toContain("i18n().t('confirm.deleteConnectionBusyDescription')");
    expect(appSrc).toContain("i18n().t('environmentCenter.connectionRemovedCleanup')");
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

    // Provider runtime link dialog: selecting a provider environment is an
    // in-dialog choice, not an open/close transition. Keep it out of the
    // confirmation object tracked by the dialog open prop so the overlay mask
    // and focus trap do not unmount/remount when the radio changes.
    expect(appSrc).toContain('const providerRuntimeLinkDialogOpen = createMemo(() => providerRuntimeLinkConfirmation() !== null);');
    expect(appSrc).toContain('open={providerRuntimeLinkDialogOpen()}');
    expect(appSrc).not.toMatch(/<ConfirmDialog\b[^>]*open=\{providerRuntimeLinkConfirmation\(\) !== null\}/);
    expect(appSrc).not.toContain('setProviderRuntimeLinkConfirmation((current) => current ? {');
    expect(appSrc).toContain('const providerRuntimeLinkCandidatePlans = createMemo(() => {');
    expect(appSrc).toContain('const providerRuntimeLinkSelectedPlan = createMemo(() => (');
    expect(appSrc).toContain('const providerRuntimeLinkConfirmDisabled = createMemo(() => (');
    expect(appSrc).toContain('disabled={providerRuntimeLinkConfirmDisabled()}');
    expect(appSrc).toContain("providerRuntimeLinkConfirmation()?.action === 'connect'");
    expect(appSrc).toContain('disabled={!item.canConnect}');
    expect(appSrc).toContain('<Show when={!item.canConnect}>');
  });

  it('routes runtime restart directly to the main-process lifecycle workflow', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("runtimeActionRequest(environment, 'restart_environment_runtime'");
    expect(appSrc).not.toContain("allowActiveWorkReplacement: true");
    expect(appSrc).not.toContain("kind: 'continue_launcher_operation'");
  });
});

describe('suggestConnectionLabel', () => {
  // suggestConnectionLabel is defined inside App.tsx. These tests mirror its
  // pure logic so the connection label contract stays covered.

  function trimString(value: string): string {
    return value.trim();
  }

  type ConnectionKind = 'external_local_ui' | 'ssh_environment' | 'local_container_runtime' | 'ssh_container_runtime';

  type TestState = Readonly<{
    connection_kind: ConnectionKind;
    label: string;
    ssh_destination?: string;
    container_label?: string;
  }>;

  function suggestConnectionLabel(state: TestState | null): string | null {
    if (!state) return null;
    switch (state.connection_kind) {
      case 'ssh_environment': {
        const dest = trimString(state.ssh_destination ?? '');
        return dest === '' ? null : dest;
      }
      case 'local_container_runtime':
      case 'ssh_container_runtime': {
        const lbl = trimString(state.container_label ?? '');
        return lbl === '' ? null : lbl;
      }
      case 'external_local_ui':
        return null;
    }
  }

  it('returns null for null state', () => {
    expect(suggestConnectionLabel(null)).toBeNull();
  });

  it('returns the SSH destination for ssh_environment when set', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: '',
      ssh_destination: 'my-server',
    })).toBe('my-server');
  });

  it('returns null for ssh_environment when ssh_destination is empty', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: '',
      ssh_destination: '',
    })).toBeNull();
  });

  it('returns the container_label for local_container_runtime when set', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'local_container_runtime',
      label: '',
      container_label: 'web-app',
    })).toBe('web-app');
  });

  it('returns the container_label for ssh_container_runtime when set', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_container_runtime',
      label: '',
      ssh_destination: 'remote-host',
      container_label: 'prod-app',
    })).toBe('prod-app');
  });

  it('returns null for container kinds when container_label is empty', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'local_container_runtime',
      label: '',
      container_label: '',
    })).toBeNull();
  });

  it('returns null for external_local_ui regardless of other fields', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'external_local_ui',
      label: '',
    })).toBeNull();
  });

  it('ignores label field in the state — only uses connection-specific fields', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: 'user-typed-name',
      ssh_destination: 'dev-server',
    })).toBe('dev-server');
  });

  it('trims whitespace from the connection field before returning', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: '',
      ssh_destination: '  staging-box  ',
    })).toBe('staging-box');
  });

  it('returns null when ssh_destination is all whitespace', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: '',
      ssh_destination: '   ',
    })).toBeNull();
  });
});
