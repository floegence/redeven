import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { desktopControlPlaneKey } from '../shared/controlPlaneProvider';
import {
  testDesktopPreferences,
  testManagedAccess,
  testManagedControlPlaneEnvironment,
  testManagedLocalEnvironment,
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

function readManagedEnvironmentBindingResolutionSource(): string {
  return fs.readFileSync(path.join(__dirname, 'managedEnvironmentBindingResolution.ts'), 'utf8');
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
            pinned: false,
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
      settings_save_label: 'Save Local Default Environment Settings',
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
      settings_save_label: 'Save Local Default Environment Settings',
    });
    expect(snapshot.settings_surface.window_title).toBe('Local Default Environment Settings');
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
    const managedLocal = testManagedLocalEnvironment();
    const localServe = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal, localServe],
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            source: 'saved',
            pinned: false,
            last_used_at_ms: 20,
          },
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Laptop',
            local_ui_url: 'http://192.168.1.11:24000/',
            source: 'recent_auto',
            pinned: false,
            last_used_at_ms: 10,
          },
        ],
        saved_ssh_environments: [],
        recent_external_local_ui_urls: [
          'http://192.168.1.12:24000/',
          'http://192.168.1.11:24000/',
        ],
      }),
      controlPlanes: [{
        provider: {
          protocol_version: 'rcpp-v1',
          provider_id: 'redeven_portal',
          display_name: 'Redeven Portal',
          provider_origin: 'https://cp.example.invalid',
          documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
        },
        account: {
          provider_id: 'redeven_portal',
          provider_origin: 'https://cp.example.invalid',
          display_name: 'Redeven Portal',
          user_public_id: 'user_demo',
          user_display_name: 'Demo User',
          authorization_expires_at_unix_ms: Date.now() + 60_000,
        },
        display_label: 'Demo Portal',
        environments: [{
          provider_id: 'redeven_portal',
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

    expect(environmentLibraryCount(snapshot)).toBe(5);
    expect(environmentLibraryCount(snapshot, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toBe(2);
    expect(environmentLibraryCount(snapshot, '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);

    expect(filterEnvironmentLibrary(snapshot, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toEqual([
      expect.objectContaining({
        id: 'local:default',
        category: 'managed',
        managed_environment_kind: 'local',
      }),
      expect.objectContaining({
        kind: 'managed_environment',
        category: 'managed',
        managed_environment_kind: 'controlplane',
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
    const providerLocalServe = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [
          testManagedLocalEnvironment(),
          providerLocalServe,
        ],
      }),
      controlPlanes: [{
        provider: {
          protocol_version: 'rcpp-v1',
          provider_id: 'redeven_portal',
          display_name: 'Redeven Portal',
          provider_origin: 'https://cp.example.invalid',
          documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
        },
        account: {
          provider_id: 'redeven_portal',
          provider_origin: 'https://cp.example.invalid',
          display_name: 'Redeven Portal',
          user_public_id: 'user_demo',
          user_display_name: 'Demo User',
          authorization_expires_at_unix_ms: Date.now() + 60_000,
        },
        display_label: 'Demo Portal',
        environments: [{
          provider_id: 'redeven_portal',
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
          provider_id: 'redeven_portal',
          display_name: 'Redeven Portal',
          provider_origin: 'https://cp.other.invalid',
          documentation_url: 'https://cp.other.invalid/docs/control-plane-providers',
        },
        account: {
          provider_id: 'redeven_portal',
          provider_origin: 'https://cp.other.invalid',
          display_name: 'Redeven Portal',
          user_public_id: 'user_other',
          user_display_name: 'Other User',
          authorization_expires_at_unix_ms: Date.now() + 60_000,
        },
        display_label: 'Other Portal',
        environments: [{
          provider_id: 'redeven_portal',
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
      desktopControlPlaneKey('https://cp.example.invalid', 'redeven_portal'),
    )).toEqual([
      expect.objectContaining({
        kind: 'managed_environment',
        env_public_id: 'env_demo',
      }),
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
    expect(appSrc).toContain("open={snapshot().surface === 'managed_environment_settings'}");
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

  it('renders facts rows, endpoint copy inputs, and pinned sections in the environment library', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('buildEnvironmentCardFactsModel');
    expect(appSrc).not.toContain('buildControlPlaneEnvironmentFactsModel');
    expect(appSrc).toContain('buildEnvironmentCardEndpointsModel');
    expect(appSrc).toContain('splitPinnedEnvironmentEntries');
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
    expect(appSrc).toContain('Refresh runtime status');
    expect(appSrc).toContain('Refresh runtime statuses');
    expect(appSrc).toContain('primary_action_tooltip');
    expect(appSrc).toContain('props.presentation.menu_button_label');
    expect(appSrc).toContain('startEnvironmentRuntime');
    expect(appSrc).toContain('stopEnvironmentRuntime');
    expect(appSrc).toContain("case 'start_runtime':");
    expect(appSrc).toContain("case 'stop_runtime':");
    expect(appSrc).toContain("case 'refresh_runtime':");
    expect(appSrc).toContain('aria-label={props.presentation.menu_button_label}');
    expect(styles).toContain('.redeven-split-action');
    expect(styles).toContain('.redeven-split-action-toggle');
    expect(styles).toContain('.redeven-split-menu');
    expect(styles).toContain('.redeven-split-menu-item');
  });

  it('includes Control Plane management copy inside the launcher source', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('Control Planes');
    expect(appSrc).toContain('Add Control Plane');
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
    expect(appSrc).toContain('showActionToast(presentation.message, presentation.tone);');
    expect(appSrc).not.toContain('IssueCard');
    expect(appSrc).not.toContain('EnvironmentInlineNotice');
    expect(appSrc).not.toContain('redeven-console-banner--error');
  });

  it('keeps environment cards concise instead of rendering helper prose under the actions', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).not.toContain('managedActionModel()?.helper_text');
    expect(appSrc).not.toContain('actionModel().helper_text');
    expect(appSrc).not.toContain('Open the managed environment or adjust startup settings before the next launch.');
    expect(appSrc).not.toContain('The provider currently reports this environment as offline.');
    expect(appSrc).not.toContain('Desktop opens a remote session through the Control Plane without starting a local runtime here.');
  });

  it('describes managed environment actions as window-only and runtime-decoupled', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Open the selected desktop-managed environment window');
    expect(appSrc).toContain("case 'start_runtime':");
    expect(appSrc).not.toContain('Open or attach the selected desktop-managed environment');
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
  });

  it('keeps environment cards stable by rendering them directly instead of replaying entry animations', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).not.toContain('function AnimatedCard');
    expect(appSrc).not.toContain('<AnimatedCard');
  });

  it('includes SSH connection mode copy inside the connection dialog source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Name</label>');
    expect(appSrc).not.toContain('Environment Name');
    expect(appSrc).toContain("label: 'Redeven URL'");
    expect(appSrc).toContain("label: 'SSH Host'");
    expect(appSrc).toContain('Run a Desktop-managed Redeven environment on this device.');
    expect(appSrc).toContain('Local environments are created independently and are not bound directly to a provider environment.');
    expect(appSrc).toContain('Create a local serve runtime for this provider environment on this Mac.');
    expect(appSrc).toContain('This provider environment card will keep both routes visible on this device: serve local here, or open via Control Plane.');
    expect(appSrc).toContain('Connect straight to a Redeven runtime that already exposes its own Environment URL');
    expect(appSrc).toContain('This is not the Control Plane URL.');
    expect(appSrc).toContain('Deploy a Desktop-managed environment to a machine you can reach over SSH.');
    expect(appSrc).toContain('Desktop reuses shared release artifacts on that host, but each Environment Instance stays isolated unless you explicitly reuse its Instance ID.');
    expect(appSrc).toContain('keeps runtime state isolated per Environment Instance.');
    expect(appSrc).toContain('Bootstrap Delivery');
    expect(appSrc).toContain("label: 'Automatic'");
    expect(appSrc).toContain("label: 'Desktop Upload'");
    expect(appSrc).toContain("label: 'Remote Install'");
    expect(appSrc).toContain('SSH Destination');
    expect(appSrc).toContain('Environment Instance ID');
    expect(appSrc).toContain('Remote Install Directory');
    expect(appSrc).toContain('Release Base URL');
    expect(appSrc).toContain('Set an internal release mirror when this desktop cannot use GitHub directly.');
    expect(appSrc).toContain('Default behavior creates an isolated Environment Instance on that host.');
    expect(appSrc).toContain('Leave blank to use the default remote user cache:');
  });

  it('explains local scope behavior separately from the single visible Name field', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('Desktop will store local state under an automatic');
    expect(appSrc).toContain('scope derived from Name.');
    expect(appSrc).toContain('Next scope:');
    expect(appSrc).toContain('Renaming this environment only changes how it appears in Desktop.');
    expect(appSrc).toContain('Local state stays under');
  });

  it('keeps managed edit saves from rejecting a filled display name just because the hidden local scope field is blank', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("localEnvironmentName === '' && !(state.mode === 'edit' && trimString(state.environment_id) !== '')");
    expect(appSrc).toContain("environment_name: localEnvironmentName || undefined");
    expect(appSrc).toContain("environment_name: trimString(current.environment_name) || deriveManagedEnvironmentScopeNameFromName(current.label)");
  });

  it('shows explicit Control Plane binding-resolution guidance inside the managed environment dialog', () => {
    const appSrc = readWelcomeSource();
    const bindingResolutionSrc = readManagedEnvironmentBindingResolutionSource();

    expect(appSrc).toContain("import {\n  describeManagedEnvironmentBindingResolution,");
    expect(appSrc).toContain('ManagedEnvironmentBindingResolutionPanel');
    expect(appSrc).toContain('resolveManagedEnvironmentBindingResolution');
    expect(appSrc).toContain('bindingResolution()');
    expect(appSrc).toContain('saveActionLabel');
    expect(appSrc).toContain('connectActionLabel');
    expect(bindingResolutionSrc).toContain('Desktop will save local-serve settings for this provider environment on this device.');
    expect(bindingResolutionSrc).toContain('The same provider environment card will keep both routes visible: local serve here, or open via Control Plane.');
    expect(bindingResolutionSrc).toContain('Desktop already manages a Local Serve for');
    expect(bindingResolutionSrc).toContain('Desktop cannot take over that Local Serve host from this launcher session.');
    expect(bindingResolutionSrc).toContain('Save & Focus');
    expect(bindingResolutionSrc).toContain('Already Opening');
  });

  it('explains Local UI Bind examples inside the managed environment form', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('aria-label="Local UI Bind examples"');
    expect(appSrc).toContain('Choose where the Local UI listens');
    expect(appSrc).toContain('These examples show patterns, not fixed values.');
    expect(appSrc).toContain('Only this machine');
    expect(appSrc).toContain('localhost:<port>');
    expect(appSrc).toContain('127.0.0.1:<port>');
    expect(appSrc).toContain('One local-network address');
    expect(appSrc).toContain('<your-device-ip>:<port>');
    expect(appSrc).toContain('For example, your device IP might look like 192.168.1.24 on a home or office network.');
    expect(appSrc).toContain('All IPv4 addresses');
    expect(appSrc).toContain('0.0.0.0:<port>');
    expect(appSrc).toContain('Replace');
    expect(appSrc).toContain('or IP literals are supported here.');
    expect(appSrc).toContain('Use a password if other devices can reach this address.');
  });

  it('includes scope-first Local Environment Settings copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('This environment keeps its own local scope on this machine.');
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

  it('distinguishes managed-environment deletion copy from saved connection deletion copy', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("title={deleteTarget()?.kind === 'managed_environment' ? 'Delete Environment' : 'Delete Connection'}");
    expect(appSrc).toContain("confirmText={deleteTarget()?.kind === 'managed_environment' ? 'Delete Environment' : 'Delete Connection'}");
    expect(appSrc).toContain("title={props.environment.kind === 'managed_environment' ? 'Delete environment' : 'Delete connection'}");
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
