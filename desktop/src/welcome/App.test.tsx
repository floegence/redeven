import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { desktopControlPlaneKey } from '../shared/controlPlaneProvider';
import {
  testDesktopPreferences,
  testLocalAccess,
  testLocalEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  buildDesktopWelcomeShellViewModel,
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
      settings_save_label: 'Save Local Environment Settings',
    });
    expect(shellStatus(snapshot)).toEqual({
      tone: 'disconnected',
      label: 'No environment windows open',
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
            last_used_at_ms: 20,
          },
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Laptop',
            local_ui_url: 'http://192.168.1.11:24000/',
            pinned: false,
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

    expect(appSrc).toContain('Online Now');
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
    expect(appSrc).toContain('redeven-environment-card');
    expect(appSrc).toContain('redeven-environment-grid');
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
    expect(appSrc).not.toContain('class="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover p-1 shadow-xl"');
    expect(appSrc).not.toContain('class="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-xl"');
    expect(listboxSrc).toContain("import { Portal } from 'solid-js/web';");
    expect(listboxSrc).toContain('<Portal>');
    expect(listboxSrc).toContain("'fixed z-[240] flex flex-col overflow-hidden");
    expect(listboxSrc).toContain('style={{');
    expect(listboxSrc).toContain('resolveDesktopAnchoredListboxGeometry');
    expect(listboxSrc).toContain('IMPORTANT: Dialog form listboxes must live outside dialog scroll containers.');
  });

  it('includes compact environment-card launcher copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Connect Environment');
    expect(appSrc).toContain('Open Redeven Dashboard');
    expect(appSrc).toContain('function openRedevenDashboard');
    expect(appSrc).toContain('Environments');
    expect(appSrc).toContain('Providers');
    expect(appSrc).toContain('Search environments...');
    expect(appSrc).toContain('Local Environment');
    expect(appSrc).toContain('<EnvironmentConnectionCard');
    expect(appSrc).toContain('New Environment');
    expect(appSrc).toContain('NewEnvironmentPlaceholderCard');
  });

  it('renders facts rows, endpoint copy inputs, and pinned sections in the environment library', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('buildEnvironmentCardFactsModel');
    expect(appSrc).not.toContain('buildControlPlaneEnvironmentFactsModel');
    expect(appSrc).toContain('buildEnvironmentCardEndpointsModel');
    expect(appSrc).toContain('splitPinnedEnvironmentEntryIDs');
    expect(appSrc).toContain('environmentLibraryEntryRecord');
    expect(appSrc).not.toContain('splitPinnedEnvironmentEntries(props.entries)');
    expect(appSrc).toContain('function EnvironmentLibrarySection');
    expect(appSrc).toContain('function EnvironmentCardFactsBlock');
    expect(appSrc).toContain('function EnvironmentCardEndpointBlock');
    expect(appSrc).toContain('Pinned');
    expect(appSrc).toContain('copyEnvironmentValue');
    expect(appSrc).toContain('<Pin class=');
    expect(styles).toContain('.redeven-card-fact-row');
    expect(styles).toContain('.redeven-card-fact-label');
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
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('function EnvironmentSplitActionButton');
    expect(appSrc).toContain('function EnvironmentPrimaryActionPanel');
    expect(appSrc).toContain('const renderPrimaryButton = () => (');
    expect(appSrc).not.toContain('const primaryButton = (');
    expect(appSrc).not.toContain('function openProviderLocalServeDialog');
    expect(appSrc).toContain('openSettingsSurface(environment.id);');
    expect(appSrc).toContain("route: 'remote_desktop'");
    expect(appSrc).toContain('return startEnvironmentRuntime(environment, errorTarget);');
    expect(appSrc).toContain('Refresh runtime status');
    expect(appSrc).toContain('Refresh runtime statuses');
    expect(appSrc).toContain('const secondaryIconOnly = () => isSecondary && props.overlay.actions.length > 1;');
    expect(appSrc).toContain("showsRefreshIcon && 'gap-1.5'");
    expect(appSrc).toContain('<Show when={showsRefreshIcon}>');
    expect(appSrc).toContain('primary_action_overlay');
    expect(appSrc).toContain('<DesktopActionPopover');
    expect(appSrc).toContain('<DesktopAnchoredOverlaySurface');
    expect(appSrc).toContain('const blockedPrimaryActionDisabled = createMemo(() => (');
    expect(appSrc).toContain('redeven-split-action-trigger__content');
    expect(appSrc).toContain('<Lock class="redeven-split-action-trigger__icon h-3.5 w-3.5" />');
    expect(appSrc).toContain('fallback={props.presentation.primary_action.label}');
    expect(appSrc).toContain("'redeven-split-action-trigger--blocked'");
    expect(appSrc).toContain('aria-disabled={blockedPrimaryActionDisabled() ? true : undefined}');
    expect(appSrc).toContain('return `${label} is unavailable. Show recovery options.`;');
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
    expect(appSrc).toContain('runtimeMaintenanceConfirmation');
    expect(appSrc).toContain('requestRuntimeMaintenanceConfirmation');
    expect(appSrc).toContain('confirmRuntimeMaintenance');
    expect(appSrc).toContain('force_runtime_update');
    expect(appSrc).toContain('forceRuntimeUpdate: true');
    expect(appSrc).toContain('allow_active_work_replacement');
    expect(appSrc).toContain('allowActiveWorkReplacement: true');
    expect(appSrc).toContain('IMPORTANT: Provider-link confirmation is intentionally reachable only from');
    expect(appSrc).toContain('desktopEntryKindOwnsRuntimeManagement(environment.kind)');
    expect(appSrc).toContain('This interrupts the background runtime service for this environment.');
    expect(appSrc).toContain('Desktop will install the bundled Redeven runtime and start it again on this SSH host.');
    expect(appSrc).toContain('Active work:');
    expect(appSrc).toContain('formatRuntimeServiceWorkload');
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
    expect(styles).toContain('.redeven-action-popover');
    expect(styles).toContain('.redeven-action-popover__actions');
    expect(styles).toContain('.redeven-action-popover__notice');
  });

  it('keeps SSH runtime bootstrap progress visible outside dismissible popovers', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('const activeActionProgress = createMemo(() => snapshot().action_progress);');
    expect(appSrc).toContain('<SSHRuntimeActivityOverlay');
    expect(appSrc).toContain('progressItems={sshRuntimeProgressItems()}');
    expect(appSrc).toContain('actionProgress={props.actionProgress}');
    expect(appSrc).toContain('activeProgressForEnvironment(props.environment.id, props.busyState, props.actionProgress)');
    expect(appSrc).toContain('function SSHRuntimeActivityOverlay');
    expect(appSrc).toContain('<Portal>');
    expect(appSrc).toContain('Starting SSH Runtime');
    expect(appSrc).not.toContain('function SSHRuntimeProgressPanel');
    expect(styles).toContain('.redeven-ssh-runtime-activity');
    expect(styles).toContain('position: fixed;');
    expect(styles).toContain('.redeven-ssh-runtime-activity__item');
    expect(styles).not.toContain('.redeven-ssh-runtime-progress');
  });

  it('lets users cancel long-running SSH startup operations from the activity overlay', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('async function cancelLauncherOperation(progress: DesktopLauncherActionProgress): Promise<void>');
    expect(appSrc).toContain("kind: 'cancel_launcher_operation'");
    expect(appSrc).toContain("showActionToast('SSH runtime startup is stopping.', 'info');");
    expect(appSrc).toContain('cancelOperation={cancelLauncherOperation}');
    expect(appSrc).toContain('cancelOperation: (progress: DesktopLauncherActionProgress) => void;');
    expect(appSrc).toContain("progress.deleted_subject\n                        ? 'Connection removed'");
    expect(appSrc).toContain("progress.status === 'cleanup_failed'\n                            ? 'Cleanup needs attention'");
    expect(appSrc).toContain('progress.cancelable === true && progress.status === \'running\'');
    expect(appSrc).toContain('onClick={() => props.cancelOperation(progress)}');
    expect(appSrc).toContain('<Stop class="h-3 w-3" />');
    expect(appSrc).toContain("{progress.interrupt_label || 'Stop'}");
    expect(appSrc).not.toContain('Cancel\n                      </Button>\n                    </Show>');
  });

  it('includes Control Plane management copy inside the launcher source', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('Providers');
    expect(appSrc).toContain('Add Provider');
    expect(appSrc).toContain('View Environments');
    expect(appSrc).toContain('All Sources');
    expect(appSrc).toContain('Local');
    expect(appSrc).toContain('control-plane-label');
    expect(appSrc).toContain('suggestControlPlaneDisplayLabel');
    expect(appSrc).toContain('Continue in Browser');
    expect(appSrc).toContain('revocable desktop authorization');
    expect(appSrc).toContain('Reconnect');
    expect(appSrc).toContain('Connect Provider');
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

    expect(appSrc).toContain('content="Settings"');
    expect(appSrc).toContain("title={isContainerRuntimeTarget() ? 'Runtime target settings' : props.environment.kind === 'local_environment' ? 'Environment settings' : 'Connection settings'}");
    expect(appSrc).toContain('Connection settings for ${props.environment.label}');
    expect(appSrc).toContain('<Settings class="h-3.5 w-3.5" />');
    expect(appSrc).not.toContain('<Pencil class="h-3.5 w-3.5" />');
  });

  it('describes local environment actions as window-only and runtime-decoupled', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Open the selected Local Environment window');
    expect(appSrc).toContain("case 'start_runtime':");
  });

  it('keeps provider runtime link confirmation explicit and source-scoped', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('providerRuntimeLinkConfirmation');
    expect(appSrc).toContain('Connect to provider');
    expect(appSrc).toContain('Disconnect from provider');
    expect(appSrc).toContain('Provider Environment');
    expect(appSrc).toContain('Source environment: <span');
    expect(appSrc).toContain('the selected provider can request sessions through this running runtime');
    expect(appSrc).toContain('Existing local work keeps running');
    expect(appSrc).toContain('without restarting the runtime');
    expect(appSrc).toContain("busyStateMatchesAction(busyState(), 'disconnect_provider_runtime')");
    expect(appSrc).toContain("showActionToast('Disconnected from provider.', 'info');");
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

    expect(appSrc).toContain('Name</label>');
    expect(appSrc).not.toContain('Environment Name');
    expect(appSrc).toContain("label: 'Redeven URL'");
    expect(appSrc).toContain("label: 'SSH Host'");
    expect(appSrc).toContain("label: 'Local Container'");
    expect(appSrc).toContain("label: 'SSH Container'");
    expect(appSrc).not.toContain('Run a Desktop-managed Redeven environment on this device.');
    expect(appSrc).not.toContain('Create a local serve runtime for this provider environment on this Mac.');
    expect(appSrc).not.toContain('This provider environment card will keep both routes visible on this device: serve local here, or open via Control Plane.');
    expect(appSrc).toContain('Connect straight to a Redeven runtime that already exposes its own Environment URL');
    expect(appSrc).toContain('This is not the Provider URL.');
    expect(appSrc).toContain('Deploy a Desktop-owned Local Environment profile to a host you can reach over SSH.');
    expect(appSrc).toContain('Desktop reuses shared release artifacts on that host and keeps one runtime state set there.');
    expect(appSrc).toContain("Desktop reuses only the exact Desktop-managed Redeven release on that host, installs it on demand when needed, and stores runtime state in that host's single runtime profile.");
    expect(appSrc).toContain('Save a runtime target inside a running container on this device.');
    expect(appSrc).toContain('Save a runtime target inside a running container on an SSH host.');
    expect(appSrc).toContain('bridge stream, not through published container ports');
    expect(appSrc).toContain('Container <span class="text-destructive">*</span>');
    expect(appSrc).toContain('Runtime Root <span class="text-destructive">*</span>');
    expect(appSrc).toContain("label: 'Docker'");
    expect(appSrc).toContain("label: 'Podman'");
    expect(appSrc).toContain('function ContainerPicker');
    expect(appSrc).toContain('Choose a running container');
    expect(appSrc).toContain('No running containers found. Start the container outside Redeven, then refresh this list.');
    expect(appSrc).not.toContain('Container Label</label>');
    expect(appSrc).not.toContain('Owner</label>');
    expect(appSrc).not.toContain("label: 'External'");
    expect(appSrc).not.toContain("label: 'Desktop'");
    expect(appSrc).toContain('Bootstrap Delivery');
    expect(appSrc).toContain('Authentication');
    expect(appSrc).toContain("label: 'Key / agent'");
    expect(appSrc).toContain("label: 'Password prompt'");
    expect(appSrc).toContain('does not store the SSH password');
    expect(appSrc).toContain("const showCreateConnectAction = createMemo(() => isCreate() && connectionKind() === 'external_local_ui');");
    expect(appSrc).toContain('<Show when={showCreateConnectAction()}>');
    expect(appSrc).toContain('async function saveAndConnectURLFromDialog()');
    expect(appSrc).not.toContain('async function ' + 'connectFrom' + 'Dialog()');
    expect(appSrc).toContain("label: 'Automatic'");
    expect(appSrc).toContain("label: 'Desktop Upload'");
    expect(appSrc).toContain("label: 'Remote Install'");
    expect(appSrc).toContain('SSH Destination');
    expect(appSrc).toContain('function SSHDestinationCombobox');
    expect(appSrc).toContain('sm:grid-cols-[minmax(0,1fr)_7.5rem]');
    expect(appSrc).toContain("props.updateField('ssh_destination', host.alias);");
    expect(appSrc).toContain("props.updateField('ssh_port', host.port == null ? '' : String(host.port));");
    expect(appSrc).toContain('getSSHConfigHosts');
    expect(appSrc).toContain('listRuntimeContainers');
    expect(appSrc).toContain('Remote Install Directory');
    expect(appSrc).toContain('Release Base URL');
    expect(appSrc).toContain('Set an internal release mirror when this desktop cannot use GitHub directly.');
    expect(appSrc).toContain('Leave blank to use the default remote user cache:');
  });

  it('keeps the connection dialog source-scoped across URL, SSH, and managed container targets', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('type ConnectionDialogState = ExternalURLConnectionDialogState | SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null;');
    expect(appSrc).toContain('props.switchKind(value as ConnectionDialogKind)');
    expect(appSrc).toContain('const showCreateConnectAction = createMemo(() => isCreate() && connectionKind() === \'external_local_ui\');');
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
    expect(appSrc).toContain('aria-label="Visibility presets"');
    expect(appSrc).toContain('This Redeven profile keeps one Local Environment runtime for the current binding.');
    expect(appSrc).toContain('Choose how the Local Environment is exposed on the next desktop-managed start');
    expect(appSrc).toContain('Published environments that can link to this Local Environment.');
    expect(appSrc).toContain('Local Links counts provider environments that can bind to this Local Environment profile for local use.');
    expect(appSrc).toContain('Loopback bind keeps the runtime on this device only. No password is required.');
    expect(appSrc).toContain('Shared local network access requires a password before other devices can open this Environment.');
  });

  it('includes Local Environment Settings copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Next start');
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

  it('uses the shared deletion copy for saved connections only', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('title="Delete Connection"');
    expect(appSrc).toContain('confirmText="Delete Connection"');
    expect(appSrc).toContain('Remove <span class="font-semibold">{deleteTarget()?.label}</span> from the Environment Library?');
    expect(appSrc).toContain('const deleteTargetOperation = createMemo(() => {');
    expect(appSrc).toContain('The connection is involved in a background task. Desktop will remove it now, then cancel or clean up that task in the background.');
    expect(appSrc).toContain('Connection removed. Startup cleanup is running in the background.');
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
  });

  it('restarts SSH runtime maintenance through the SSH start flow when no runtime record exists yet', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("confirmation.action === 'restart' && target.kind === 'ssh_environment' && target.runtime_maintenance");
    expect(appSrc).toContain("await startEnvironmentRuntime(latestTarget, 'connect', { allowActiveWorkReplacement: true });");
  });
});
