import { Show, createEffect, createMemo, createRenderEffect, createResource, createSignal, lazy, onCleanup, onMount, untrack } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createUIFirstSelection, deferAfterPaint, type FloeComponent, type UIFirstSelectionEvent, useCommand, useLayout, useNotification, useTheme } from '@floegence/floe-webapp-core';
import { ActivityAppsMain, FloeRegistryRuntime } from '@floegence/floe-webapp-core/app';
import { NotesOverlayIcon } from '@floegence/floe-webapp-core/notes';
import {
  AlertTriangle,
  Activity,
  Code,
  Copy,
  Files,
  Globe,
  Grid3x3,
  Highlighter,
  LayoutDashboard,
  Refresh,
  Search,
  Settings,
  Shield,
  Terminal,
  X,
} from '@floegence/floe-webapp-core/icons';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { CodexNavigationIcon } from './icons/CodexIcon';
import {
  ActivityBarCodespacesIcon,
  ActivityBarFolderIcon,
  ActivityBarMonitorIcon,
  ActivityBarPortsIcon,
  ActivityBarSettingsIcon,
  ActivityBarSwitchIcon,
  ActivityBarTerminalIcon,
} from './icons/ActivityBarDockIcons';
import { FlowerNavigationIcon } from './icons/FlowerSoftAuraIcon';
import {
  BottomBarItem,
  DisplayModePageShell,
  KeepAliveStack,
  Panel,
  PanelContent,
  Shell,
  StatusIndicator,
  TopBarIconButton,
  type ActivityBarItem,
} from '@floegence/floe-webapp-core/layout';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import {
  createArtifactDirectReconnectConfig,
  createProxyRuntimeTunnelReconnectConfig,
} from '@floegence/floe-webapp-boot';
import {
  RequireTLS,
  type ClientObserverLike,
} from '@floegence/flowersec-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import {
  EnvContext,
  type EnvSettingsOrigin,
  type EnvSettingsSection,
  type EnvWorkbenchOverviewEntryRequest,
  type EnvWorkbenchFilePreviewActivationRequest,
  type EnvWorkbenchSurfaceActivationRequest,
  type OpenTerminalInDirectoryRequest,
} from './pages/EnvContext';
import {
  type FlowerFileOpenRequest,
  type FlowerCompanionPresenceProjection,
  type FlowerComposerHandoffRequest,
  type FlowerThreadFocusRequest,
  type FlowerTurnLauncherAnchor,
  type FlowerTurnLauncherIntent,
  type FlowerTurnLauncherSubmitInput,
} from '../../../../flower_ui/src';
import { flowerTurnAdmissionUncertainIdentity } from '../../../../flower_ui/src/flowerTurnAdmission';
import type { ContextActionExecutionContext } from './contextActions/protocol';
import { createFlowerLinkedContextNavigation } from './flower/linkedContextNavigation';
import { buildPluginPanelModel } from './plugins/pluginInventoryProjection';
import type { PluginLifecycleCommand, PluginOpenSurfaceResult, PluginSurfaceLaunchTarget } from './plugins/pluginTypes';
import { hasRWXPermissions } from './pages/aiPermissions';
import { useRedevenRpc } from './protocol/redeven_v1';
import { RuntimeUpdateContext } from './maintenance/RuntimeUpdateContext';
import { createAgentMaintenanceController } from './maintenance/createAgentMaintenanceController';
import { createRuntimeUpdatePromptCoordinator } from './maintenance/createRuntimeUpdatePromptCoordinator';
import { createAgentVersionModel } from './maintenance/createAgentVersionModel';
import { DownloadContext } from './downloads/DownloadContext';
import { DownloadTaskButton } from './downloads/DownloadTaskButton';
import { createDownloadManager } from './downloads/createDownloadManager';
import { createRuntimeDownloadSource } from './downloads/runtimeDownloadSource';
import { resolveDownloadPlatformSink } from './downloads/downloadPlatformResolver';
import {
  LOCAL_FAST_RECONNECT_POLICY,
  REMOTE_FAST_RECONNECT_POLICY,
  classifyReconnectFailure,
  createRuntimeReconnectController,
  type ReconnectAvailability,
} from './reconnect/createRuntimeReconnectController';
import { ConnectionRecoveryView } from './reconnect/ConnectionRecoveryView';
import { createDebugConsoleController } from './debugConsole/createDebugConsoleController';
import { TopBarBrandButton } from './TopBarBrandButton';
import { EnvAppThemePicker } from './EnvAppThemePicker';
import { Tooltip } from './primitives/Tooltip';
import { NotesOverlay } from './notes/NotesOverlay';
import { resolveNotesOverlayViewportHosts } from './notes/notesOverlayShellViewport';
import { createFileBrowserSurfaceController } from './widgets/createFileBrowserSurfaceController';
import { createFilePreviewController } from './widgets/createFilePreviewController';
import { FileBrowserSurfaceContext } from './widgets/FileBrowserSurfaceContext';
import { FilePreviewContext, type FilePreviewOpenOptions } from './widgets/FilePreviewContext';
import { openFileBrowserSurface } from './widgets/openFileBrowserSurface';
import { basenameFromAbsolutePath, normalizeAbsolutePath } from './utils/askFlowerPath';
import { createClientId } from './utils/clientId';
import { fileItemFromPath } from './utils/filePreviewItem';
import { reloadCurrentPage } from './utils/windowNavigation';
import { resolveEnvSidebarVisibilityMotion, shouldEnvTabOpenSidebar } from './envSidebarVisibilityMotion';
import { createUIPresentationEventRecorder } from './services/uiPresentationTransactions';
import { TerminalSessionCatalogProvider } from './services/terminalSessionCatalog';
import { preloadTerminalFeatureResources } from './services/terminalFeaturePreload';
import { buildDesktopShellCommandPaletteEntries } from './services/desktopShellCommandPalette';
import {
  desktopShellBridgeAvailable,
  getRuntimeMaintenanceContextFromDesktopShell,
  notifyRuntimeMaintenanceStartedInDesktopShell,
  openConnectionCenter,
  openDashboardInDesktopShell,
  performRuntimeMaintenanceActionInDesktopShell,
  runtimeMaintenanceMethodUsesDesktop,
  type RuntimeMaintenanceContext,
} from './services/desktopShellBridge';
import {
  fetchLocalApiJSON,
  getEnvAppAccessStatus,
  uploadLocalApiFile,
  unlockEnvAppAccess,
  type EnvAppAccessStatus,
} from './services/localApi';
import {
  AccessUnlockError,
  formatAccessUnlockRetryAfter,
  getAccessUnlockRetryAfterMs,
  isKnownAccessUnlockErrorCode,
} from './services/accessUnlockError';
import { clearLocalAccessResumeToken, writeLocalAccessResumeToken } from './services/localAccessAuth';
import { getSandboxWindowInfo } from './services/sandboxWindowRegistry';
import { consumeAccessResumeTokenFromWindow } from './accessResume';
import { CODE_SPACE_ID_ENV_UI, FLOE_APP_AGENT, FLOE_APP_CODE, FLOE_APP_PORT_FORWARD, type LauncherFloeApp } from './services/floeproxyContract';
import {
  connectArtifactEntry,
  type EnvironmentDetailRequest,
  getEnvPublicIDFromSession,
  getLocalAccessStatus,
  getLocalRuntime,
  refreshLocalRuntime,
  getEnvironment,
  mintEnvProxyEntryTicket,
  mintLocalDirectConnectArtifact,
  mintEnvEntryTicketForApp,
  unlockLocalAccess,
  type EnvironmentDetail,
  type LocalAccessStatus,
  type LocalRuntimeInfo,
} from './services/controlplaneApi';
import { desktopThemeBridge } from './services/desktopTheme';
import {
  notifyDesktopSessionAppReady,
  readDesktopSessionContextSnapshot,
  readDesktopTransportRecoverySnapshot,
  requestDesktopTransportRecoveryNow,
  subscribeDesktopTransportRecovery,
} from './services/desktopSessionContext';
import { controlPlaneOriginFromSandboxLocation } from './services/sandboxOrigins';
import { readUIStorageItem, writeUIStorageItem } from './services/uiStorage';
import { requestWorkbenchRenderTransaction } from './workbench/workbenchRenderBoundary';
import {
  allowLoopbackControlplaneHTTP,
  resolveLocalTransportSecurityPolicy,
} from './security/localTransportSecurity';
import {
  readNetworkExposureWarningSuppressed,
  suppressNetworkExposureWarning,
} from './security/networkExposureWarningPreference';
import {
  ENV_DEFAULT_SURFACE_ID,
  isEnvSurfaceId,
  normalizePersistedEnvViewMode,
  type EnvOpenSurfaceOptions,
  type EnvSurfaceId,
  type EnvViewMode,
  type EnvWorkbenchHandoffAnchor,
} from './envViewMode';
import { LanguagePreferenceMenu, useI18n } from './i18n';
import { activityFlowerFrameStyle as serializeActivityFlowerFrameStyle, resolveActivityFlowerOverlayFrame } from './activityFlowerFrame';

type EnvActivitySelectionMetadata = Readonly<{
  source: 'activity-bar' | 'mobile-tab-bar';
  opts?: Readonly<{ openSidebar?: boolean }>;
  mobileSidebarOpen?: boolean;
}>;

type ActivityFlowerPresentation = 'collapsed' | 'expanded';

const FLOWER_RELATED_SURFACE_SELECTOR = [
  '.flower-thread-switcher-popover',
  '.flower-turn-launcher-window',
  '.flower-turn-launcher-related-surface',
  '.flower-chat-context-preview-window',
  '.flower-subagent-detail-window',
  '.flower-working-dir-picker',
  '.flower-provider-dialog',
  '[data-flower-floating-layer]',
].join(', ');

const EMPTY_FLOWER_COMPANION_PRESENCE: FlowerCompanionPresenceProjection = {
  priority_status: 'idle',
  priority_count: 0,
  attention_count: 0,
  unread_failed_count: 0,
  running_count: 0,
  queued_count: 0,
  unread_canceled_count: 0,
  unread_completed_count: 0,
};

const ACTIVE_SURFACE_STORAGE_KEY = 'redeven_envapp_active_tab';
const DESKTOP_VIEW_MODE_STORAGE_KEY = 'redeven_envapp_desktop_view_mode';
const ACCESS_RESUME_TIMEOUT_MS = 15_000;
const WORKBENCH_HANDOFF_ANCHOR_MAX_AGE_MS = 1_500;
const NOTES_OVERLAY_KEYBIND = 'mod+.';

const PLUGIN_CENTER_ACTIVITY_ID = 'plugin-center';
const PLUGIN_SURFACE_ACTIVITY_ID = 'plugin-surface';
const FLOWERSEC_CONNECT_RESOURCES = {
  outboundRecordChunkBytes: 64 * 1024,
  webSocketLimits: {
    maxInboundQueuedBytes: 4 * 1024 * 1024,
    outboundLowWatermarkBytes: 256 * 1024,
    outboundHighWatermarkBytes: 1024 * 1024,
    outboundHardLimitBytes: 4 * 1024 * 1024,
    outboundDrainTimeoutMs: 10_000,
  },
  yamuxLimits: {
    maxActiveStreams: 64,
    maxInboundStreams: 32,
    maxFrameBytes: 256 * 1024,
    preferredOutboundFrameBytes: 64 * 1024,
    maxStreamReceiveBytes: 256 * 1024,
    maxSessionReceiveBytes: 16 * 1024 * 1024,
  },
} as const;

const EnvTerminalPage = lazy(() => import('./pages/EnvTerminalPage').then((module) => ({ default: module.EnvTerminalPage })));
const EnvMonitorPage = lazy(() => import('./pages/EnvMonitorPage').then((module) => ({ default: module.EnvMonitorPage })));
const EnvFileBrowserPage = lazy(() => import('./pages/EnvFileBrowserPage').then((module) => ({ default: module.EnvFileBrowserPage })));
const EnvCodespacesPage = lazy(() => import('./pages/EnvCodespacesPage').then((module) => ({ default: module.EnvCodespacesPage })));
const EnvPortForwardsPage = lazy(() => import('./pages/EnvPortForwardsPage').then((module) => ({ default: module.EnvPortForwardsPage })));
const EnvAIPage = lazy(() => import('./pages/EnvAIPage').then((module) => ({ default: module.EnvAIPage })));
const CodexActivitySurface = lazy(() => import('./codex/CodexActivitySurface').then((module) => ({ default: module.CodexActivitySurface })));
const EnvSettingsPage = lazy(() => import('./pages/EnvSettingsPage').then((module) => ({ default: module.EnvSettingsPage })));
const PluginPanel = lazy(() => import('./plugins/PluginPanel').then((module) => ({ default: module.PluginPanel })));
const PluginCenterView = lazy(() => import('./plugins/PluginCenterView').then((module) => ({ default: module.PluginCenterView })));
const PluginSurfaceFrame = lazy(() => import('./plugins/PluginSurfaceFrame').then((module) => ({ default: module.PluginSurfaceFrame })));
const DebugConsoleWindow = lazy(() => import('./debugConsole/DebugConsoleWindow').then((module) => ({ default: module.DebugConsoleWindow })));
const AuditLogDialog = lazy(() => import('./widgets/AuditLogDialog').then((module) => ({ default: module.AuditLogDialog })));
const FlowerTurnLauncherWindow = lazy(() => import('./widgets/FlowerTurnLauncherWindow').then((module) => ({ default: module.FlowerTurnLauncherWindow })));
const FilePreviewHost = lazy(() => import('./widgets/FilePreviewHost').then((module) => ({ default: module.FilePreviewHost })));
const FileBrowserSurfaceHost = lazy(() => import('./widgets/FileBrowserSurfaceHost').then((module) => ({ default: module.FileBrowserSurfaceHost })));
const EnvWorkbenchPage = lazy(() => import('./workbench/EnvWorkbenchPage').then((module) => ({ default: module.EnvWorkbenchPage })));

type EnvActivitySurfaceId = EnvSurfaceId | 'settings' | typeof PLUGIN_CENTER_ACTIVITY_ID | typeof PLUGIN_SURFACE_ACTIVITY_ID;

function CodexActivitySidebarHost(props: Readonly<{
  onHostChange: (host: HTMLElement | null) => void;
}>) {
  let host!: HTMLDivElement;

  onMount(() => {
    props.onHostChange(host);
  });
  onCleanup(() => {
    props.onHostChange(null);
  });

  return <div ref={host} data-codex-activity-sidebar-host class="h-full min-h-0 w-full" />;
}

type EnvSessionSource =
  | 'local_runtime'
  | 'provider_environment'
  | 'ssh_environment'
  | 'external_local_ui'
  | 'runtime_gateway'
  | 'region_sandbox';

type EnvSessionIdentity = Readonly<{
  source: EnvSessionSource;
  displayName: string;
  displayID: string;
}>;

type FlowerFileActionOpenTarget = Readonly<{
  path?: string;
}>;

type AccessGatePhase = 'checking' | 'unlock_required' | 'resuming' | 'resume_blocked' | 'ready';

const ACCESS_GATE_IDS = {
  title: 'redeven-access-gate-title',
  description: 'redeven-access-gate-description',
  passwordInput: 'redeven-access-password',
  passwordHelp: 'redeven-access-password-help',
  resumeHint: 'redeven-access-resume-hint',
  error: 'redeven-access-error',
  notice: 'redeven-access-notice',
} as const;

class AccessResumeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessResumeTimeoutError';
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return String(error.message || '').trim();
  }
  return String(error ?? '').trim();
}

function requirePluginOpenSurfaceResult(value: unknown): PluginOpenSurfaceResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Plugin surface open response is invalid.');
  }
  const record = value as Partial<Record<keyof PluginOpenSurfaceResult, unknown>>;
  const requiredFields: Array<keyof PluginOpenSurfaceResult> = [
    'plugin_id',
    'plugin_instance_id',
    'surface_id',
    'surface_instance_id',
    'active_fingerprint',
    'asset_ticket',
    'asset_ticket_id',
    'bridge_nonce',
  ];
  for (const field of requiredFields) {
    if (!String(record[field] ?? '').trim()) {
      throw new Error(`Plugin surface open response is missing ${field}.`);
    }
  }
  return value as PluginOpenSurfaceResult;
}

function localizedAccessUnlockErrorMessage(error: unknown, i18n: ReturnType<typeof useI18n>): string {
  if (error instanceof AccessUnlockError) {
    const code = String(error.code ?? '').trim().toUpperCase();
    if (isKnownAccessUnlockErrorCode(code)) {
      switch (code) {
        case 'ACCESS_PASSWORD_INVALID':
          return i18n.t('accessGate.errors.invalidPassword');
        case 'ACCESS_PASSWORD_RETRY_LATER':
          return i18n.t('accessGate.errors.retryLater');
        case 'ACCESS_PASSWORD_REQUIRED':
          return i18n.t('accessGate.enterPasswordToContinueError');
        default:
          break;
      }
    }
  }
  return getErrorMessage(error);
}

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function envAppNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

const envAppModuleStartedAtMs = envAppNowMs();

function normalizeWorkbenchHandoffAnchor(value: unknown): EnvWorkbenchHandoffAnchor | null {
  const candidate = value as { clientX?: unknown; clientY?: unknown } | null;
  const clientX = Number(candidate?.clientX);
  const clientY = Number(candidate?.clientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }
  return { clientX, clientY };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new AccessResumeTimeoutError(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isAccessResumeAuthFailure(error: unknown): boolean {
  const candidate = error as { code?: unknown; status?: unknown } | null;
  const statusCode = Number(candidate?.status ?? 0);
  const errorCode = Number(candidate?.code ?? 0);
  return statusCode === 401 || errorCode === 401;
}

function readPersistedDesktopViewMode(): EnvViewMode | null {
  const explicit = String(readUIStorageItem(DESKTOP_VIEW_MODE_STORAGE_KEY) ?? '').trim();
  const normalized = normalizePersistedEnvViewMode(explicit);
  if (explicit === 'deck' && normalized === 'workbench') {
    writeUIStorageItem(DESKTOP_VIEW_MODE_STORAGE_KEY, normalized);
  }
  return normalized;
}

function persistDesktopViewMode(mode: EnvViewMode): void {
  writeUIStorageItem(DESKTOP_VIEW_MODE_STORAGE_KEY, mode);
}

function readPersistedActiveSurface(): EnvSurfaceId | null {
  const v = String(readUIStorageItem(ACTIVE_SURFACE_STORAGE_KEY) ?? '').trim();
  if (isEnvSurfaceId(v)) return v;
  return null;
}

function persistActiveSurface(surfaceId: EnvSurfaceId): void {
  writeUIStorageItem(ACTIVE_SURFACE_STORAGE_KEY, surfaceId);
}

const ENV_DISPLAY_MODE_SWITCHER_OPTIONS = [
  { id: 'activity', icon: Terminal },
  { id: 'workbench', icon: Grid3x3 },
] as const satisfies ReadonlyArray<{
  id: EnvViewMode;
  icon: typeof Terminal;
}>;

function EnvDisplayModeSwitcher(props: {
  mode: EnvViewMode;
  onChange: (mode: EnvViewMode) => void;
}) {
  const i18n = useI18n();
  return (
    <div
      class="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
      role="tablist"
      aria-label={i18n.t('uiCopy.shell.displayMode')}
    >
      {ENV_DISPLAY_MODE_SWITCHER_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = () => props.mode === option.id;
        return (
          <button
            type="button"
            role="tab"
            aria-selected={active()}
            class={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors ${
              active()
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            }`}
            onClick={() => props.onChange(option.id)}
          >
            <Icon class="h-3.5 w-3.5" />
            <span>{option.id === 'activity' ? i18n.t('uiCopy.shell.activityMode') : i18n.t('uiCopy.shell.workbenchMode')}</span>
          </button>
        );
      })}
    </div>
  );
}

export function EnvAppShell() {
  const desktopBootstrapReadyMs = Math.max(0, envAppNowMs() - envAppModuleStartedAtMs);
  const layout = useLayout();
  const theme = useTheme();
  const i18n = useI18n();
  const localTransportSecurity = resolveLocalTransportSecurityPolicy(window.location.hostname);
  const initialDesktopSessionContext = readDesktopSessionContextSnapshot();
  const [desktopTransportRecovery, setDesktopTransportRecovery] = createSignal(
    readDesktopTransportRecoverySnapshot(),
  );
  onMount(() => {
    const unsubscribe = subscribeDesktopTransportRecovery(setDesktopTransportRecovery);
    onCleanup(unsubscribe);
  });
  const shellTheme = desktopThemeBridge();
  const setThemeSourceWithRenderBoundary = (source: 'system' | 'light' | 'dark') => {
    requestWorkbenchRenderTransaction('theme');
    if (shellTheme) {
      return shellTheme.setSource(source).source === source;
    }
    theme.setTheme(source);
    return theme.theme() === source;
  };
  const setShellThemeWithRenderBoundary = (mode: 'light' | 'dark', presetName: string) => {
    requestWorkbenchRenderTransaction('theme');
    if (shellTheme) {
      return shellTheme.setShellTheme(mode, presetName).shellThemes[mode] === presetName;
    }
    theme.setShellPreset(presetName);
    return theme.shellPresetForMode(mode)?.name === presetName;
  };
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const cmd = useCommand();
  const notify = useNotification();
  const downloadManager = createDownloadManager({
    source: createRuntimeDownloadSource(() => protocol.client()),
    sink: resolveDownloadPlatformSink(),
  });
  const filePreviewController = createFilePreviewController({
    client: () => protocol.client(),
    rpc: () => rpc,
    canWrite: () => Boolean(env()?.permissions?.can_write),
    onSaved: (path) => {
      notify.success(i18n.t('filePreview.savedTitle'), i18n.t('filePreview.savedMessage', { path }));
    },
    onSaveError: (path, message) => {
      notify.error(i18n.t('filePreview.saveFailedTitle'), i18n.t('filePreview.saveFailedMessage', { path, message }));
    },
  });
  const [filePreviewHostRequested, setFilePreviewHostRequested] = createSignal(false);
  const fileBrowserSurfaceController = createFileBrowserSurfaceController();
  const [fileBrowserSurfaceHostRequested, setFileBrowserSurfaceHostRequested] = createSignal(false);

  type ProtocolConnectConfig = Parameters<typeof protocol.connect>[0];
  const topBarTooltip = (label: string): string | false => (layout.isMobile() ? false : label);
  const notesOverlayShortcutLabel = createMemo(() => cmd.getKeybindDisplay(NOTES_OVERLAY_KEYBIND));
  const headerLogoSrc = createMemo(() =>
    `${import.meta.env.BASE_URL}${theme.resolvedTheme() === 'dark' ? 'logo-dark.svg' : 'logo.svg'}`,
  );
  const [localRuntime, setLocalRuntime] = createSignal<LocalRuntimeInfo | null>(null);
  const isLocalMode = createMemo(() => localRuntime() !== null);
  const initialAccessResumeToken = typeof window !== 'undefined' ? consumeAccessResumeTokenFromWindow(window) : '';
  if (initialAccessResumeToken) {
    writeLocalAccessResumeToken(initialAccessResumeToken);
  }

  const [localAccessStatus, setLocalAccessStatus] = createSignal<LocalAccessStatus | null>(null);
  const [localAccessChecked, setLocalAccessChecked] = createSignal(false);
  const [localAccessPassword, setLocalAccessPassword] = createSignal('');
  const [localAccessError, setLocalAccessError] = createSignal<string | null>(null);
  const [localAccessUnlocking, setLocalAccessUnlocking] = createSignal(false);
  const [localAccessChannelReady, setLocalAccessChannelReady] = createSignal(false);
  const [localAccessResumeToken, setLocalAccessResumeToken] = createSignal(initialAccessResumeToken);
  const [localAccessRetryUntilMs, setLocalAccessRetryUntilMs] = createSignal(0);

  const [remoteAccessStatus, setRemoteAccessStatus] = createSignal<EnvAppAccessStatus | null>(null);
  const [remoteAccessChecked, setRemoteAccessChecked] = createSignal(false);
  const [remoteAccessPassword, setRemoteAccessPassword] = createSignal('');
  const [remoteAccessError, setRemoteAccessError] = createSignal<string | null>(null);
  const [remoteAccessUnlocking, setRemoteAccessUnlocking] = createSignal(false);
  const [remoteAccessChannelReady, setRemoteAccessChannelReady] = createSignal(false);
  const [remoteAccessResumeToken, setRemoteAccessResumeToken] = createSignal(initialAccessResumeToken);
  const [remoteAccessRetryUntilMs, setRemoteAccessRetryUntilMs] = createSignal(0);
  const [accessRetryNowMs, setAccessRetryNowMs] = createSignal(Date.now());
  const [networkSecurityDetailsOpen, setNetworkSecurityDetailsOpen] = createSignal(false);
  const [networkExposureWarningDismissed, setNetworkExposureWarningDismissed] = createSignal(false);
  const [networkExposureWarningSuppressed, setNetworkExposureWarningSuppressed] = createSignal(
    readNetworkExposureWarningSuppressed(),
  );

  let accessPasswordInput: HTMLInputElement | undefined;

  const accessStatus = createMemo(() => (isLocalMode() ? localAccessStatus() : remoteAccessStatus()));
  const accessChecked = createMemo(() => (isLocalMode() ? localAccessChecked() : remoteAccessChecked()));
  const accessPassword = createMemo(() => (isLocalMode() ? localAccessPassword() : remoteAccessPassword()));
  const accessError = createMemo(() => (isLocalMode() ? localAccessError() : remoteAccessError()));
  const accessUnlocking = createMemo(() => (isLocalMode() ? localAccessUnlocking() : remoteAccessUnlocking()));
  const accessChannelReady = createMemo(() => (isLocalMode() ? localAccessChannelReady() : remoteAccessChannelReady()));
  const accessResumeToken = createMemo(() => (isLocalMode() ? localAccessResumeToken() : remoteAccessResumeToken()));
  const accessRetryUntilMs = createMemo(() => (isLocalMode() ? localAccessRetryUntilMs() : remoteAccessRetryUntilMs()));
  const accessRetryRemainingMs = createMemo(() => Math.max(0, accessRetryUntilMs() - accessRetryNowMs()));
  const accessRetryActive = createMemo(() => accessRetryRemainingMs() > 0);
  const accessPasswordRequired = createMemo(() => Boolean(accessStatus()?.password_required));
  const networkExposureActive = createMemo(() => (
    (localTransportSecurity.network && window.location.protocol === 'http:')
    || localAccessStatus()?.exposure?.scope === 'network'
    || initialDesktopSessionContext?.local_ui_exposure?.scope === 'network'
  ));
  const networkExposureURLs = createMemo(() => {
    const reported = localAccessStatus()?.urls?.map((value) => String(value ?? '').trim()).filter(Boolean) ?? [];
    if (reported.length > 0) return reported;
    if (localTransportSecurity.network) return [`${window.location.origin}/`];
    return [];
  });
  const networkExposureWarningVisible = createMemo(() => (
    networkExposureActive()
    && !networkExposureWarningDismissed()
    && !networkExposureWarningSuppressed()
  ));
  const accessServerUnlocked = createMemo(() => Boolean(accessStatus()?.unlocked));
  const accessPending = createMemo(() => !accessChecked());
  const [accessRecoveryBusy, setAccessRecoveryBusy] = createSignal(false);
  const accessLocked = createMemo(() => {
    if (!accessPasswordRequired()) return false;
    if (isLocalMode()) return !accessServerUnlocked();
    return !String(accessResumeToken() ?? '').trim();
  });
  const accessResumePending = createMemo(() => {
    if (isLocalMode()) return false;
    return accessPasswordRequired() && !accessPending() && !accessLocked() && !accessChannelReady();
  });
  const accessGatePhase = createMemo<AccessGatePhase>(() => {
    if (accessPending()) return 'checking';
    if (accessLocked()) return 'unlock_required';
    if (accessResumePending()) return accessRecoveryBusy() ? 'resuming' : 'resume_blocked';
    return 'ready';
  });
  const accessGateVisible = createMemo(() => accessGatePhase() !== 'ready');
  const accessRecoverable = createMemo(() => accessPasswordRequired() && !accessPending() && !accessLocked());
  const accessRetryDuration = () => formatAccessUnlockRetryAfter(accessRetryRemainingMs(), {
    minute: i18n.t('accessGate.minuteAbbreviation'),
    second: i18n.t('accessGate.secondAbbreviation'),
  });

  const setCurrentAccessPassword = (value: string) => {
    if (isLocalMode()) {
      setLocalAccessPassword(value);
    } else {
      setRemoteAccessPassword(value);
    }
    setCurrentAccessError(null);
  };

  const setCurrentAccessError = (value: string | null) => {
    if (isLocalMode()) {
      setLocalAccessError(value);
      return;
    }
    setRemoteAccessError(value);
  };

  const setCurrentAccessUnlocking = (value: boolean) => {
    if (isLocalMode()) {
      setLocalAccessUnlocking(value);
      return;
    }
    setRemoteAccessUnlocking(value);
  };

  const setCurrentAccessChannelReady = (value: boolean) => {
    if (isLocalMode()) {
      setLocalAccessChannelReady(value);
      return;
    }
    setRemoteAccessChannelReady(value);
  };

  const setCurrentAccessResumeToken = (value: string) => {
    if (isLocalMode()) {
      setLocalAccessResumeToken(value);
      writeLocalAccessResumeToken(value);
      return;
    }
    setRemoteAccessResumeToken(value);
  };

  const setCurrentAccessRetryUntil = (value: number) => {
    const next = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    setAccessRetryNowMs(Date.now());
    if (isLocalMode()) {
      setLocalAccessRetryUntilMs(next);
      return;
    }
    setRemoteAccessRetryUntilMs(next);
  };

  const markCurrentAccessLocked = (message: string) => {
    if (isLocalMode()) {
      setLocalAccessStatus((current) => ({
        password_required: true,
        unlocked: false,
        ...(current?.exposure ? { exposure: current.exposure } : {}),
        ...(current?.urls ? { urls: current.urls } : {}),
      }));
      setLocalAccessChecked(true);
      clearLocalAccessResumeToken();
    } else {
      setRemoteAccessStatus({ password_required: true, unlocked: false });
      setRemoteAccessChecked(true);
    }
    setCurrentAccessChannelReady(false);
    setCurrentAccessResumeToken('');
    setCurrentAccessRetryUntil(0);
    setCurrentAccessError(message);
  };

  const setRecoverableAccessError = (message: string) => {
    setCurrentAccessChannelReady(false);
    setCurrentAccessError(message);
    setManualError(null);
  };

  const handleAccessRecoveryFailure = (error: unknown) => {
    const message = getErrorMessage(error);
    if (isAccessResumeAuthFailure(error)) {
      markCurrentAccessLocked(i18n.t('accessGate.passwordExpiredError'));
      return;
    }
    if (accessRecoverable()) {
      setRecoverableAccessError(message || i18n.t('accessGate.prepareSecureSessionFailedError'));
      return;
    }
    if (message) {
      setManualError(message);
    }
  };

  createEffect(() => {
    if (accessRetryRemainingMs() <= 0) return;
    const handle = window.setInterval(() => setAccessRetryNowMs(Date.now()), 1_000);
    onCleanup(() => window.clearInterval(handle));
  });

  const probeRemoteRuntimeAvailability = async (): Promise<ReconnectAvailability> => {
    const id = envId();
    if (!id) {
      return { status: 'unknown', access: 'unknown' };
    }

    try {
      const request = environmentDetailRequest() ?? { source: 'controlplane' as const, envId: id };
      const detail = await getEnvironment(request);
      return {
        status: String(detail?.status ?? '').trim().toLowerCase() === 'offline' ? 'offline' : 'online',
        access: 'unknown',
      };
    } catch (error) {
      return {
        status: 'unknown',
        access: 'unknown',
        failure: classifyReconnectFailure(error),
      };
    }
  };

  const probeLocalRuntimeAvailability = async (): Promise<ReconnectAvailability> => {
    const status = await getLocalAccessStatus();
    if (!status) {
      return {
        status: 'offline',
        access: 'unknown',
        failure: classifyReconnectFailure({ code: 'LOCAL_RUNTIME_UNAVAILABLE' }),
      };
    }

    if (status.password_required && !status.unlocked) {
      markCurrentAccessLocked(i18n.t('accessGate.passwordExpiredError'));
      return {
        status: 'online',
        access: 'locked',
        failure: {
          code: 'authentication_failed',
          retryable: false,
          technical_detail: '',
        },
      };
    }

    setLocalAccessStatus(status);
    setLocalAccessChecked(true);
    setCurrentAccessChannelReady(false);
    setCurrentAccessError(null);
    return { status: 'online', access: 'ready' };
  };

  const [envId, setEnvId] = createSignal(getEnvPublicIDFromSession());
  const environmentDetailRequest = createMemo<EnvironmentDetailRequest | null>(() => {
    const id = envId() || null;
    if (!id) return null;
    if (accessGateVisible()) return null;
    return {
      source: isLocalMode() ? 'local' : 'controlplane',
      envId: isLocalMode() ? localRuntime()?.env_public_id || 'env_local' : id,
    };
  });

  const [env, { refetch: refetchEnv }] = createResource<EnvironmentDetail | null, EnvironmentDetailRequest | null>(
    environmentDetailRequest,
    (request) => (request ? getEnvironment(request) : null),
  );

  const [manualError, setManualError] = createSignal<string | null>(null);
  const [runtimeConnectionEstablished, setRuntimeConnectionEstablished] = createSignal(false);

  createEffect(() => {
    if (isLocalMode() && localTransportSecurity.error) {
      setManualError(i18n.t('networkExposure.policyError', { message: localTransportSecurity.error }));
    }
  });
  const [connectionAttemptSeq, setConnectionAttemptSeq] = createSignal(0);
  const [auditOpen, setAuditOpen] = createSignal(false);
  const canViewAudit = createMemo(() => Boolean(env()?.permissions?.can_admin));
  const canAdmin = createMemo(() => Boolean(env()?.permissions?.can_admin || env()?.permissions?.is_owner));
  const controlplaneStatus = createMemo(() => String(env()?.status ?? '').trim());
  const canUseFlower = createMemo(() => !accessGateVisible());
  const canUseCodex = createMemo(() => env.state === 'ready' && hasRWXPermissions(env()));

  const [pendingAutoOpenAI, setPendingAutoOpenAI] = createSignal(false);
  const [pendingAutoOpenCodex, setPendingAutoOpenCodex] = createSignal(false);
  const [desktopViewMode, setDesktopViewMode] = createSignal<EnvViewMode>('workbench');
  const viewMode = createMemo<EnvViewMode>(() => (layout.isMobile() ? 'activity' : desktopViewMode()));
  const [lastActivitySurface, setLastActivitySurface] = createSignal<EnvSurfaceId>(ENV_DEFAULT_SURFACE_ID);
  const [lastRequestedSurface, setLastRequestedSurface] = createSignal<EnvSurfaceId>(ENV_DEFAULT_SURFACE_ID);
  const [workbenchSurfaceActivationSeq, setWorkbenchSurfaceActivationSeq] = createSignal(0);
  const [workbenchSurfaceActivation, setWorkbenchSurfaceActivation] = createSignal<EnvWorkbenchSurfaceActivationRequest | null>(null);
  const [workbenchOverviewEntrySeq, setWorkbenchOverviewEntrySeq] = createSignal(0);
  const [workbenchOverviewEntry, setWorkbenchOverviewEntry] = createSignal<EnvWorkbenchOverviewEntryRequest | null>(null);
  const [workbenchFilePreviewActivationSeq, setWorkbenchFilePreviewActivationSeq] = createSignal(0);
  const [workbenchFilePreviewActivation, setWorkbenchFilePreviewActivation] = createSignal<EnvWorkbenchFilePreviewActivationRequest | null>(null);
  const [filesMobileSidebarOpen, setFilesMobileSidebarOpen] = createSignal(false);
  const [activityFlowerPresentation, setActivityFlowerPresentation] = createSignal<ActivityFlowerPresentation>('collapsed');
  const [activityFlowerPresence, setActivityFlowerPresence] = createSignal<FlowerCompanionPresenceProjection>(EMPTY_FLOWER_COMPANION_PRESENCE);
  const [activityFlowerComposerFocusRequest, setActivityFlowerComposerFocusRequest] = createSignal(0);
  const [activityFlowerComposerHandoffRequest, setActivityFlowerComposerHandoffRequest] = createSignal<FlowerComposerHandoffRequest | null>(null);
  const [activityFlowerQuickDraft, setActivityFlowerQuickDraft] = createSignal('');
  const [activityFlowerOverlayHost, setActivityFlowerOverlayHost] = createSignal<HTMLElement | null>(null);
  const [activityFlowerFullPageHost, setActivityFlowerFullPageHost] = createSignal<HTMLElement | null>(null);
  const [activityFlowerMountContainer, setActivityFlowerMountContainer] = createSignal<HTMLDivElement | null>(null);
  const [activityFlowerFrameStyle, setActivityFlowerFrameStyle] = createSignal<Record<string, string>>({});
  const [activityFlowerOverlayFramed, setActivityFlowerOverlayFramed] = createSignal(false);
  const [activityFlowerMobileRailStyle, setActivityFlowerMobileRailStyle] = createSignal<Record<string, string>>({});
  const [activityFlowerMountRequested, setActivityFlowerMountRequested] = createSignal(false);
  const [activityFlowerVisualViewportBottomOffset, setActivityFlowerVisualViewportBottomOffset] = createSignal(0);
  const [activityFlowerComposing, setActivityFlowerComposing] = createSignal(false);
  let activityFlowerBottomBarAnchorRef: HTMLDivElement | undefined;
  let activityFlowerQuickInputRef: HTMLInputElement | undefined;
  let activityFlowerPanelRef: HTMLDivElement | undefined;
  let activityFlowerCompositionCommit = '';
  const toggleFilesMobileSidebar = () => setFilesMobileSidebarOpen((open) => !open);
  let initialActivitySurface: EnvSurfaceId | null = null;

  type EnvFlowerTurnHandoffContext = Readonly<{
    mode: EnvViewMode;
    activeSurface: EnvSurfaceId;
    activityFlowerOriginPlacement?: 'collapsed' | 'expanded' | 'full_page';
    workbenchAnchor?: EnvWorkbenchHandoffAnchor;
  }>;

  const [flowerTurnLauncherOpen, setFlowerTurnLauncherOpen] = createSignal(false);
  const [flowerTurnLauncherIntent, setFlowerTurnLauncherIntent] = createSignal<FlowerTurnLauncherIntent | null>(null);
  const [flowerTurnLauncherAnchor, setFlowerTurnLauncherAnchor] = createSignal<FlowerTurnLauncherAnchor | null>(null);
  const [flowerTurnLauncherHandoff, setFlowerTurnLauncherHandoff] = createSignal<EnvFlowerTurnHandoffContext | null>(null);
  const [notesOverlayOpen, setNotesOverlayOpen] = createSignal(false);
  const [activityNotesViewportAnchor, setActivityNotesViewportAnchor] = createSignal<HTMLElement | null>(null);
  const [workbenchNotesViewportAnchor, setWorkbenchNotesViewportAnchor] = createSignal<HTMLElement | null>(null);
  const notesViewportAnchor = createMemo(() => (
    viewMode() === 'workbench' ? workbenchNotesViewportAnchor() : activityNotesViewportAnchor()
  ));
  const [notesViewportHosts, setNotesViewportHosts] = createSignal<readonly HTMLElement[]>([]);
  const [codexSidebarHost, setCodexSidebarHost] = createSignal<HTMLElement | null>(null);
  let notesViewportHostsRevision = 0;
  const openNotesOverlay = () => setNotesOverlayOpen(true);
  const closeNotesOverlay = () => setNotesOverlayOpen(false);
  const toggleNotesOverlay = () => setNotesOverlayOpen((open) => !open);
  const [openTerminalInDirectoryRequestSeq, setOpenTerminalInDirectoryRequestSeq] = createSignal(0);
  const [openTerminalInDirectoryRequest, setOpenTerminalInDirectoryRequest] = createSignal<OpenTerminalInDirectoryRequest | null>(null);
  const activeSurface = createMemo<EnvSurfaceId>(() => {
    if (viewMode() === 'activity') {
      const activeTab = layout.sidebarActiveTab();
      return isEnvSurfaceId(activeTab) ? activeTab : lastActivitySurface();
    }
    return lastRequestedSurface();
  });

  const [settingsSeq, setSettingsSeq] = createSignal(0);
  const bumpSettingsSeq = () => setSettingsSeq((n) => n + 1);
  const debugConsole = createDebugConsoleController({
    protocolStatus: () => protocol.status(),
  });
  const [debugConsoleMountRequested, setDebugConsoleMountRequested] = createSignal(false);

  const [settingsFocusSeq, setSettingsFocusSeq] = createSignal(0);
  const [settingsFocusSection, setSettingsFocusSection] = createSignal<EnvSettingsSection | null>(null);
  const [settingsOrigin, setSettingsOrigin] = createSignal<EnvSettingsOrigin>(null);
  const [pluginsPanelOpen, setPluginsPanelOpen] = createSignal(false);
  const [pluginCenterSelectedPluginID, setPluginCenterSelectedPluginID] = createSignal<string | undefined>();
  const [activePluginSurface, setActivePluginSurface] = createSignal<PluginOpenSurfaceResult | null>(null);
  const [languageMenuOpenSeq, setLanguageMenuOpenSeq] = createSignal(0);
  const [themeMenuOpenSeq, setThemeMenuOpenSeq] = createSignal(0);
  const [aiThreadFocusRequest, setAIThreadFocusRequest] = createSignal<FlowerThreadFocusRequest | null>(null);
  const [activityFlowerFocusRequest, setActivityFlowerFocusRequest] = createSignal<FlowerThreadFocusRequest | null>(null);
  let aiThreadFocusRequestSequence = 0;
  let activityFlowerFocusRequestSequence = 0;
  let lastWorkbenchPointerAnchor: (EnvWorkbenchHandoffAnchor & { observedAtMs: number }) | null = null;

  const recordWorkbenchPointerAnchor = (event: MouseEvent | PointerEvent) => {
    const anchor = normalizeWorkbenchHandoffAnchor(event);
    if (!anchor) return;
    lastWorkbenchPointerAnchor = {
      ...anchor,
      observedAtMs: envAppNowMs(),
    };
  };

  const resolveWorkbenchHandoffAnchor = (
    explicitAnchor?: EnvWorkbenchHandoffAnchor,
  ): EnvWorkbenchHandoffAnchor | undefined => {
    const normalizedExplicit = normalizeWorkbenchHandoffAnchor(explicitAnchor);
    if (normalizedExplicit) {
      return normalizedExplicit;
    }

    const observed = lastWorkbenchPointerAnchor;
    if (!observed) {
      return undefined;
    }
    if (envAppNowMs() - observed.observedAtMs > WORKBENCH_HANDOFF_ANCHOR_MAX_AGE_MS) {
      return undefined;
    }
    return {
      clientX: observed.clientX,
      clientY: observed.clientY,
    };
  };

  onMount(() => {
    window.addEventListener('pointerdown', recordWorkbenchPointerAnchor, true);
    window.addEventListener('contextmenu', recordWorkbenchPointerAnchor, true);
  });

  onCleanup(() => {
    window.removeEventListener('pointerdown', recordWorkbenchPointerAnchor, true);
    window.removeEventListener('contextmenu', recordWorkbenchPointerAnchor, true);
  });

  createEffect(() => {
    const anchor = notesViewportAnchor();
    notesViewportHostsRevision += 1;
    const revision = notesViewportHostsRevision;

    if (!anchor) {
      setNotesViewportHosts([]);
      return;
    }

    deferAfterPaint(() => {
      if (notesViewportHostsRevision !== revision) return;
      setNotesViewportHosts(resolveNotesOverlayViewportHosts(anchor));
    });
  });

  const openSettings = (section?: EnvSettingsSection, options?: { origin?: EnvSettingsOrigin }) => {
    setPluginsPanelOpen(false);
    setPluginCenterSelectedPluginID(undefined);
    setSettingsFocusSection(section ?? 'config');
    setSettingsFocusSeq((n) => n + 1);
    setViewMode('activity');
    setSettingsOrigin(options?.origin ?? null);
    activateActivitySurface('settings', { persist: false });
  };

  const returnFromSettingsOrigin = () => {
    const origin = settingsOrigin();
    setSettingsOrigin(null);
    if (origin?.kind === 'flower') {
      openSurface(origin.returnSurfaceId, { reason: 'direct_navigation', focus: true, ensureVisible: true });
    }
  };

  const openDebugConsole = (options?: { query?: string }) => {
    setDebugConsoleMountRequested(true);
    debugConsole.show(options);
  };

  const pluginInventorySource = () => __REDEVEN_PLUGIN_UI_ENABLED__ && pluginsPanelOpen();
  const [pluginInventoryProjection, { refetch: refetchPluginInventory }] = createResource(
    pluginInventorySource,
    async () => (await import('./plugins/pluginApi')).loadPluginInventoryProjection(),
  );

  const pluginPanelModel = createMemo(() => buildPluginPanelModel(
    pluginInventoryProjection() ?? { items: [] },
    pluginInventoryProjection.error ? getErrorMessage(pluginInventoryProjection.error) : undefined,
    { canOpenSurfaces: protocol.status() === 'connected' && canAdmin() },
  ));

  const openPluginCenter = (selectedPluginID?: string) => {
    if (!__REDEVEN_PLUGIN_UI_ENABLED__) return;
    setPluginsPanelOpen(false);
    setActivePluginSurface(null);
    setPluginCenterSelectedPluginID(selectedPluginID);
    setViewMode('activity', { surfaceId: activeSurface() });
    activateActivitySurface(PLUGIN_CENTER_ACTIVITY_ID, { persist: false });
  };

  const closePluginCenter = () => {
    setPluginCenterSelectedPluginID(undefined);
    activateActivitySurface(lastActivitySurface(), { persist: false });
  };

  const closePluginSurface = () => {
    setActivePluginSurface(null);
    activateActivitySurface(lastActivitySurface(), { persist: false });
  };

  const openPluginSurface = async (target: PluginSurfaceLaunchTarget) => {
    if (!__REDEVEN_PLUGIN_UI_ENABLED__) return;
    setPluginsPanelOpen(false);
    setPluginCenterSelectedPluginID(undefined);
    try {
      const result = await (await import('./plugins/pluginApi')).executePluginLifecycleCommand({
        type: 'open_surface',
        pluginInstanceID: target.pluginInstanceID,
        surfaceID: target.surfaceID,
        placement: target.preferredPlacement,
      });
      setActivePluginSurface(requirePluginOpenSurfaceResult(result));
      setViewMode('activity', { surfaceId: lastActivitySurface() });
      activateActivitySurface(PLUGIN_SURFACE_ACTIVITY_ID, { persist: false });
    } catch (error) {
      notify.error('Plugin surface unavailable', getErrorMessage(error));
      const pluginID = pluginInventoryProjection()?.items.find((item) => item.defaultLaunchTarget?.pluginInstanceID === target.pluginInstanceID)?.pluginID;
      openPluginCenter(pluginID);
    }
  };

  const handlePluginCenterCommand = async (command: PluginLifecycleCommand) => {
    if (!__REDEVEN_PLUGIN_UI_ENABLED__) return;
    if (command.type === 'open_surface') {
      await openPluginSurface({
        pluginInstanceID: command.pluginInstanceID,
        surfaceID: command.surfaceID,
        preferredPlacement: command.placement,
      });
      return;
    }
    await (await import('./plugins/pluginApi')).executePluginLifecycleCommand(command);
    await refetchPluginInventory();
  };

  const setDebugConsoleEnabled = (enabled: boolean) => {
    if (enabled) {
      openDebugConsole();
      return;
    }
    void debugConsole.closeConsole();
  };

  const flowerTurnExecutionContext = (): ContextActionExecutionContext => {
    const desktopCtx = readDesktopSessionContextSnapshot();
    const sessionSource = desktopCtx?.session_source;
    const normalizedSessionSource =
      sessionSource === 'local_runtime' ||
      sessionSource === 'provider_environment' ||
      sessionSource === 'ssh_environment' ||
      sessionSource === 'external_local_ui' ||
      sessionSource === 'runtime_gateway'
        ? sessionSource
        : isLocalMode()
          ? 'local_runtime'
          : 'region_sandbox';
    const sourceEnvPublicID = String(desktopCtx?.env_public_id ?? envId() ?? '').trim()
      || (isLocalMode() ? String(localRuntime()?.env_public_id ?? '').trim() : '');
    return {
      current_target_id: sourceEnvPublicID || 'current',
      source_env_public_id: sourceEnvPublicID || undefined,
      runtime_hint: 'auto',
      session_source: normalizedSessionSource,
    };
  };

  const withFlowerTurnExecutionContext = (intent: FlowerTurnLauncherIntent): FlowerTurnLauncherIntent => {
    if (!intent.context_action || typeof intent.context_action !== 'object') {
      return intent;
    }
    const contextAction = intent.context_action as { execution_context?: ContextActionExecutionContext } & Record<string, unknown>;
    return {
      ...intent,
      context_action: {
        ...contextAction,
        execution_context: {
          ...contextAction.execution_context,
          ...flowerTurnExecutionContext(),
        },
      },
    };
  };

  const consumeOpenTerminalInDirectoryRequest = (requestId: string) => {
    const normalizedRequestId = String(requestId ?? '').trim();
    if (!normalizedRequestId) return;

    setOpenTerminalInDirectoryRequest((current) => {
      if (!current) return current;
      return current.requestId === normalizedRequestId ? null : current;
    });
  };

  const consumeWorkbenchSurfaceActivation = (requestId: string) => {
    const normalizedRequestId = String(requestId ?? '').trim();
    if (!normalizedRequestId) return;

    setWorkbenchSurfaceActivation((current) => {
      if (!current) return current;
      return current.requestId === normalizedRequestId ? null : current;
    });
  };

  const requestWorkbenchOverviewEntry = () => {
    setWorkbenchOverviewEntry({
      requestId: createClientId('workbench-overview'),
      reason: 'mode_switch',
    });
    setWorkbenchOverviewEntrySeq((n) => n + 1);
  };

  const consumeWorkbenchOverviewEntry = (requestId: string) => {
    const normalizedRequestId = String(requestId ?? '').trim();
    if (!normalizedRequestId) return;

    setWorkbenchOverviewEntry((current) => {
      if (!current) return current;
      return current.requestId === normalizedRequestId ? null : current;
    });
  };

  const consumeWorkbenchFilePreviewActivation = (requestId: string) => {
    const normalizedRequestId = String(requestId ?? '').trim();
    if (!normalizedRequestId) return;

    setWorkbenchFilePreviewActivation((current) => {
      if (!current) return current;
      return current.requestId === normalizedRequestId ? null : current;
    });
  };

  const focusAIThread = (threadId: string) => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    aiThreadFocusRequestSequence += 1;
    setAIThreadFocusRequest({
      request_id: `env-ai-focus-${aiThreadFocusRequestSequence}`,
      thread_id: tid,
    });
  };

  const consumeAIThreadFocusRequest = (requestId: string) => {
    const normalizedRequestId = String(requestId ?? '').trim();
    if (!normalizedRequestId) return;
    setAIThreadFocusRequest((current) => (
      current?.request_id === normalizedRequestId ? null : current
    ));
  };

  const focusActivityFlowerThread = (threadId: string) => {
    const tid = trimString(threadId);
    if (!tid) return;
    activityFlowerFocusRequestSequence += 1;
    setActivityFlowerFocusRequest({
      request_id: `env-activity-flower-focus-${activityFlowerFocusRequestSequence}`,
      thread_id: tid,
    });
  };

  const consumeActivityFlowerFocusRequest = (requestId: string) => {
    const normalizedRequestId = trimString(requestId);
    if (!normalizedRequestId) return;
    setActivityFlowerFocusRequest((current) => (
      current?.request_id === normalizedRequestId ? null : current
    ));
  };

  const activityFlowerPlacement = createMemo<'collapsed' | 'expanded' | 'full_page'>(() => (
    viewMode() === 'activity' && layout.sidebarActiveTab() === 'ai'
      ? 'full_page'
      : activityFlowerPresentation()
  ));
  const activityFlowerMountHost = createMemo<HTMLElement | null>(() => (
    activityFlowerPlacement() === 'full_page' && activityFlowerFullPageHost()?.isConnected
      ? activityFlowerFullPageHost()
      : activityFlowerOverlayHost()
  ));

  const syncActivityFlowerFrame = () => {
    if (typeof window === 'undefined') return;
    const visualViewport = window.visualViewport;
    const viewportScale = visualViewport?.scale ?? 1;
    const nextBottomOffset = viewportScale === 1 ? Math.max(
      0,
      window.innerHeight - ((visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? window.innerHeight)),
    ) : 0;
    const bottomOffsetChanged = nextBottomOffset !== activityFlowerVisualViewportBottomOffset();
    setActivityFlowerVisualViewportBottomOffset(nextBottomOffset);
    if (bottomOffsetChanged) window.requestAnimationFrame(syncActivityFlowerFrame);
    const placement = activityFlowerPlacement();
    const overlayStyle = activityFlowerOverlayHost() ? getComputedStyle(activityFlowerOverlayHost()!) : null;
    const safeAreaValue = (name: string) => Math.max(0, Number.parseFloat(overlayStyle?.getPropertyValue(name) ?? '') || 0);
    const safeArea = {
      top: safeAreaValue('--flower-safe-area-top'),
      right: safeAreaValue('--flower-safe-area-right'),
      bottom: safeAreaValue('--flower-safe-area-bottom'),
      left: safeAreaValue('--flower-safe-area-left'),
    };
    const viewport = {
      left: visualViewport?.offsetLeft ?? 0,
      top: visualViewport?.offsetTop ?? 0,
      width: visualViewport?.width ?? window.innerWidth,
      height: visualViewport?.height ?? window.innerHeight,
      safeArea,
    };
    const mobileTabBar = layout.isMobile()
      ? document.querySelector('[data-floe-shell-slot="mobile-tab-bar"]')
      : null;
    if (mobileTabBar instanceof HTMLElement && mobileTabBar.isConnected) {
      const mobileTabBarRect = mobileTabBar.getBoundingClientRect();
      const viewportLeft = viewport.left + safeArea.left;
      const viewportRight = viewport.left + viewport.width - safeArea.right;
      const viewportTop = viewport.top + safeArea.top;
      const viewportBottom = viewport.top + viewport.height - safeArea.bottom;
      const railInset = 12;
      const railHeight = 44;
      const railWidth = Math.min(544, Math.max(0, viewportRight - viewportLeft - railInset * 2));
      const railTop = Math.max(
        viewportTop + railInset,
        Math.min(mobileTabBarRect.top, viewportBottom) - 8 - railHeight,
      );
      setActivityFlowerMobileRailStyle({
        left: `${viewportLeft + (viewportRight - viewportLeft - railWidth) / 2}px`,
        top: `${railTop}px`,
        width: `${railWidth}px`,
        height: `${railHeight}px`,
      });
    } else {
      setActivityFlowerMobileRailStyle({});
    }
    if (placement !== 'expanded') {
      setActivityFlowerOverlayFramed(false);
      return;
    }
    const frame = resolveActivityFlowerOverlayFrame({
      viewport,
      anchor: activityFlowerBottomBarAnchorRef?.isConnected
        ? activityFlowerBottomBarAnchorRef.getBoundingClientRect()
        : null,
    });
    if (frame) {
      setActivityFlowerFrameStyle(serializeActivityFlowerFrameStyle(frame));
      setActivityFlowerOverlayFramed(true);
    } else {
      setActivityFlowerOverlayFramed(false);
    }
  };

  onMount(() => {
    const scheduleSync = () => window.requestAnimationFrame(() => {
      if (activityFlowerBottomBarAnchorRef) observer?.observe(activityFlowerBottomBarAnchorRef);
      const mobileTabBar = document.querySelector('[data-floe-shell-slot="mobile-tab-bar"]');
      if (mobileTabBar instanceof HTMLElement) observer?.observe(mobileTabBar);
      syncActivityFlowerFrame();
    });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleSync);
    window.addEventListener('resize', scheduleSync);
    window.visualViewport?.addEventListener('resize', scheduleSync);
    window.visualViewport?.addEventListener('scroll', scheduleSync);
    createEffect(() => {
      activityFlowerPlacement();
      const fullPageHost = activityFlowerFullPageHost();
      if (fullPageHost) observer?.observe(fullPageHost);
      scheduleSync();
    });
    onCleanup(() => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('scroll', scheduleSync);
    });
  });

  const openActivityFlowerCompanion = (options: Readonly<{ focusComposer?: boolean }> = {}) => {
    if (!canUseFlower()) return;
    if (activityFlowerPlacement() !== 'full_page') setActivityFlowerPresentation('expanded');
    if (options.focusComposer) {
      setActivityFlowerComposerFocusRequest((request) => request + 1);
    }
  };

  const collapseActivityFlowerCompanion = (restoreFocus = true) => {
    if (activityFlowerPlacement() === 'full_page') return;
    if (restoreFocus) activityFlowerQuickInputRef?.focus({ preventScroll: true });
    setActivityFlowerPresentation('collapsed');
  };

  const focusActivityFlowerComposer = () => {
    openActivityFlowerCompanion({ focusComposer: true });
  };

  const handoffActivityFlowerQuickDraft = (value: string) => {
    if (!trimString(value) || activityFlowerComposing()) return;
    const input = activityFlowerQuickInputRef;
    setActivityFlowerComposerHandoffRequest({
      request_id: createClientId(),
      text: value,
      selection_start: input?.selectionStart ?? value.length,
      selection_end: input?.selectionEnd ?? value.length,
      is_composing: false,
      source: 'activity_bottom_bar',
    });
    openActivityFlowerCompanion();
  };

  const consumeActivityFlowerComposerHandoff = (requestID: string) => {
    setActivityFlowerComposerHandoffRequest((current) => {
      if (current?.request_id !== requestID) return current;
      setActivityFlowerQuickDraft('');
      return null;
    });
  };

  const openFlowerTurnLauncher = (intent: FlowerTurnLauncherIntent, anchor?: FlowerTurnLauncherAnchor) => {
    if (!canUseFlower()) {
      notify.error(i18n.t('shell.notifications.permissionDeniedTitle'), i18n.t('shell.notifications.rwxPermissionRequired'));
      return;
    }
    const capturedMode = viewMode();
    if (activityFlowerPanelRef?.contains(document.activeElement)) {
      activityNotesViewportAnchor()?.focus({ preventScroll: true });
    }
    const contextualIntent = withFlowerTurnExecutionContext(intent);
    setFlowerTurnLauncherIntent(contextualIntent);
    setFlowerTurnLauncherAnchor(anchor ?? null);
    setFlowerTurnLauncherHandoff({
      mode: capturedMode,
      activeSurface: activeSurface(),
      ...(capturedMode === 'activity' ? { activityFlowerOriginPlacement: activityFlowerPlacement() } : {}),
      ...(capturedMode === 'workbench' ? { workbenchAnchor: resolveWorkbenchHandoffAnchor() } : {}),
    });
    setFlowerTurnLauncherOpen(true);
  };

  const openTerminalInDirectory = (
    workingDir: string,
    options?: {
      preferredName?: string;
      openStrategy?: 'focus_latest_or_create' | 'create_new';
      workbenchAnchor?: EnvWorkbenchHandoffAnchor;
    },
  ) => {
    const normalizedWorkingDir = normalizeAbsolutePath(workingDir);
    if (!normalizedWorkingDir) {
      notify.error(i18n.t('shell.notifications.invalidDirectoryTitle'), i18n.t('shell.notifications.invalidTerminalDirectory'));
      return;
    }

    const preferredName = String(options?.preferredName ?? '').trim();
    const targetMode = viewMode();
    const workbenchAnchor = targetMode === 'workbench'
      ? resolveWorkbenchHandoffAnchor(options?.workbenchAnchor)
      : undefined;
    if (targetMode !== 'workbench') {
      setOpenTerminalInDirectoryRequest({
        requestId: createClientId(),
        workingDir: normalizedWorkingDir,
        preferredName: preferredName || basenameFromAbsolutePath(normalizedWorkingDir),
        targetMode,
      });
      setOpenTerminalInDirectoryRequestSeq((n) => n + 1);
    }
    openSurface('terminal', {
      reason: 'handoff_open_terminal',
      focus: true,
      ensureVisible: workbenchAnchor ? false : true,
      centerViewport: workbenchAnchor ? false : undefined,
      openStrategy: options?.openStrategy ?? (targetMode === 'workbench' ? 'create_new' : undefined),
      workbenchAnchor,
      terminalPayload: {
        workingDir: normalizedWorkingDir,
        preferredName: preferredName || basenameFromAbsolutePath(normalizedWorkingDir),
      },
    });
  };

  const openFileBrowserAtPath = async (
    path: string,
    options?: {
      homePath?: string;
      title?: string;
      openStrategy?: 'focus_latest_or_create' | 'create_new';
    },
  ): Promise<void> => {
    const normalizedPath = normalizeAbsolutePath(path);
    if (!normalizedPath) {
      notify.error(i18n.t('shell.notifications.browseFilesUnavailableTitle'), i18n.t('shell.notifications.invalidDirectoryPath'));
      return;
    }

    const normalizedHomePath = normalizeAbsolutePath(options?.homePath ?? '');
    const normalizedTitle = String(options?.title ?? '').trim();
    if (viewMode() === 'workbench') {
      openSurface('files', {
        reason: 'handoff_browse_files',
        focus: true,
        ensureVisible: true,
        openStrategy: options?.openStrategy,
        fileBrowserPayload: {
          path: normalizedPath,
          homePath: normalizedHomePath || undefined,
          title: normalizedTitle || undefined,
        },
      });
      return;
    }

    setFileBrowserSurfaceHostRequested(true);
    await openFileBrowserSurface({
      input: {
        path: normalizedPath,
        homePath: normalizedHomePath || undefined,
        title: normalizedTitle || undefined,
      },
      controller: fileBrowserSurfaceController,
    });
  };

  const openFilePreview = async (
    item: FileItem,
    options?: FilePreviewOpenOptions,
  ): Promise<void> => {
    setFilePreviewHostRequested(true);
    const normalizedPath = normalizeAbsolutePath(item?.path ?? '');
    if (!normalizedPath) {
      notify.error(i18n.t('shell.notifications.previewUnavailableTitle'), i18n.t('shell.notifications.invalidFilePath'));
      return;
    }
    if (item?.type && item.type !== 'file') {
      notify.error(i18n.t('shell.notifications.previewUnavailableTitle'), i18n.t('shell.notifications.onlyFilesPreviewed'));
      return;
    }

    const normalizedItem: FileItem = {
      ...item,
      id: String(item?.id ?? '').trim() || normalizedPath,
      type: 'file',
      path: normalizedPath,
      name: String(item?.name ?? '').trim() || basenameFromAbsolutePath(normalizedPath) || 'File',
    };

    if (!layout.isMobile() && viewMode() === 'workbench') {
      const reusePolicy = options?.reusePolicy ?? 'same_file_or_create';
      const openStrategy = reusePolicy === 'single_surface' ? 'same_file_or_create' : reusePolicy;
      setWorkbenchFilePreviewActivation({
        requestId: createClientId('workbench-preview'),
        item: normalizedItem,
        focus: options?.focus ?? true,
        ensureVisible: options?.ensureVisible ?? true,
        openStrategy,
      });
      setWorkbenchFilePreviewActivationSeq((n) => n + 1);
      return;
    }

    await filePreviewController.openPreview(normalizedItem);
  };

  const resolveFlowerFileActionPath = async (
    request: FlowerFileOpenRequest,
    action: 'preview' | 'browse_directory',
  ): Promise<string> => {
    const threadID = String(request.thread_id ?? '').trim();
    if (!threadID) return '';
    const target = await fetchLocalApiJSON<FlowerFileActionOpenTarget>(
      `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/file-action-open-target`,
      {
        method: 'POST',
        body: JSON.stringify({
          message_id: String(request.message_id ?? '').trim(),
          block_index: Math.floor(Number(request.block_index)),
          item_id: String(request.item_id ?? '').trim(),
          action_id: String(request.action_id ?? '').trim(),
          action,
        }),
      },
    );
    return String(target.path ?? '').trim();
  };

  const openFlowerFileBrowser = async (request: FlowerFileOpenRequest): Promise<void> => {
    const path = await resolveFlowerFileActionPath(request, 'browse_directory');
    if (!path) return;
    await openFileBrowserAtPath(path, {
      title: 'Flower file context',
      openStrategy: 'focus_latest_or_create',
    });
  };

  const openFlowerFilePreview = async (request: FlowerFileOpenRequest): Promise<void> => {
    const path = await resolveFlowerFileActionPath(request, 'preview');
    if (!path) return;
    await openFilePreview(fileItemFromPath(path), {
      focus: true,
      reusePolicy: 'same_file_or_create',
    });
  };

  const {
    openCanonicalReferenceTarget: openFlowerCanonicalReferenceTarget,
    openLinkedFilePreview: openFlowerLinkedFilePreview,
    openLinkedDirectoryBrowser: openFlowerLinkedDirectoryBrowser,
  } = createFlowerLinkedContextNavigation({
    openFilePreview,
    openFileBrowserAtPath,
    notifyInvalidFilePath: () => {
      notify.error(i18n.t('shell.notifications.previewUnavailableTitle'), i18n.t('shell.notifications.invalidFilePath'));
    },
    notifyInvalidDirectoryPath: () => {
      notify.error(i18n.t('shell.notifications.browseFilesUnavailableTitle'), i18n.t('shell.notifications.invalidDirectoryPath'));
    },
  });

  const closeFlowerTurnLauncher = (restoreOrigin = true) => {
    const handoff = flowerTurnLauncherHandoff();
    if (restoreOrigin && handoff?.mode === 'activity') {
      setActivityFlowerPresentation(handoff.activityFlowerOriginPlacement === 'expanded' ? 'expanded' : 'collapsed');
    }
    setFlowerTurnLauncherOpen(false);
    setFlowerTurnLauncherIntent(null);
    setFlowerTurnLauncherAnchor(null);
    setFlowerTurnLauncherHandoff(null);
  };

  const handoffFlowerTurn = (context: EnvFlowerTurnHandoffContext, threadId: string) => {
    const tid = trimString(threadId);
    if (!tid) {
      throw new Error(i18n.t('flowerChat.router.missingThreadID'));
    }
    const target = context;

    if (target.mode === 'activity' || layout.isMobile()) {
      setViewMode('activity', { surfaceId: target.activeSurface, focusSurface: false });
      focusActivityFlowerThread(tid);
      if (target.activeSurface !== 'ai') openActivityFlowerCompanion();
      return;
    }

    focusAIThread(tid);

    if (viewMode() !== 'workbench') {
      setViewMode('workbench', { surfaceId: 'ai', focusSurface: false, requestWorkbenchOverview: false });
      queueMicrotask(() => {
        openSurface('ai', {
          reason: 'handoff_ask_flower',
          focus: true,
          ensureVisible: !target.workbenchAnchor,
          centerViewport: !target.workbenchAnchor,
          openStrategy: 'focus_latest_or_create',
          workbenchAnchor: target.workbenchAnchor,
        });
      });
      return;
    }

    openSurface('ai', {
      reason: 'handoff_ask_flower',
      focus: true,
      ensureVisible: !target.workbenchAnchor,
      centerViewport: !target.workbenchAnchor,
      openStrategy: 'focus_latest_or_create',
      workbenchAnchor: target.workbenchAnchor,
    });
  };

  const submitFlowerTurnLauncher = async (input: FlowerTurnLauncherSubmitInput): Promise<void> => {
    if (protocol.status() !== 'connected') {
      const message = i18n.t('shell.notifications.connectingToRuntime');
      notify.error(i18n.t('shell.notifications.notConnectedTitle'), message);
      throw new Error(message);
    }
    if (!canUseFlower()) {
      const message = i18n.t('shell.notifications.rwxPermissionRequired');
      notify.error(i18n.t('shell.notifications.permissionDeniedTitle'), message);
      throw new Error(message);
    }

    const trimmedPrompt = trimString(input.prompt);
    if (!trimmedPrompt) {
      const message = i18n.t('shell.notifications.enterQuestionBeforeSending');
      notify.error(i18n.t('shell.notifications.missingMessageTitle'), message);
      throw new Error(message);
    }

    const handoffContext = flowerTurnLauncherHandoff();
    try {
      const { createEnvLocalFlowerSurfaceAdapter } = await import('./flower/envLocalFlowerSurfaceAdapter');
      const adapter = createEnvLocalFlowerSurfaceAdapter({
        envPublicID: trimString(envId()),
        envLabel: trimString(env()?.name) || trimString(envId()) || 'This environment',
        desktopSessionTargetRoute: readDesktopSessionContextSnapshot()?.target_route,
        rpc,
        copy: {
          currentEnvironment: i18n.t('flowerChat.router.currentEnvSource'),
          usingCurrentEnvironment: i18n.t('flowerChat.router.currentEnvHandler'),
          environmentLocalSubtitle: i18n.t('flowerChat.router.envLocalSubtitle'),
          missingThreadID: i18n.t('flowerChat.router.missingThreadID'),
          enterMessageBeforeSending: i18n.t('flowerChat.router.enterMessageBeforeSending'),
          selectModelBeforeChat: i18n.t('flowerChat.router.selectModelBeforeChat'),
          failedToCreateChat: i18n.t('flowerChat.router.failedToCreateChat'),
        },
        onSettingsChanged: () => { bumpSettingsSeq(); },
        uploadAttachment: uploadLocalApiFile,
        openFileBrowser: openFlowerFileBrowser,
        openFilePreview: openFlowerFilePreview,
        openCanonicalReferenceTarget: openFlowerCanonicalReferenceTarget,
        openLinkedFilePreview: openFlowerLinkedFilePreview,
        openLinkedDirectoryBrowser: openFlowerLinkedDirectoryBrowser,
      });
      const receipt = await adapter.launchTurn({
        prompt: trimmedPrompt,
        context_action: input.intent.context_action,
        working_dir: input.intent.suggested_working_dir,
        pending_files: input.intent.pending_attachments,
      });
      const threadId = trimString(receipt.thread_id);
      if (!threadId) {
        throw new Error(i18n.t('flowerChat.router.missingThreadID'));
      }
      if (!handoffContext) {
        throw new Error(i18n.t('shell.notifications.failedToSendToFlowerTitle'));
      }
      closeFlowerTurnLauncher(false);
      handoffFlowerTurn(handoffContext, threadId);
    } catch (e) {
      const uncertain = flowerTurnAdmissionUncertainIdentity(e);
      if (uncertain) {
        closeFlowerTurnLauncher(false);
        if (handoffContext) {
          handoffFlowerTurn(handoffContext, uncertain.thread_id);
        } else {
          focusAIThread(uncertain.thread_id);
        }
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      notify.error(i18n.t('shell.notifications.failedToSendToFlowerTitle'), msg || i18n.t('shell.notifications.requestFailed'));
      throw e;
    }
  };

  const RECENT_AGENT_RX_MS = 10_000;
  const PROBE_TIMEOUT_MS = 1_200;

  let lastAgentRxAtMs = 0;
  const markAgentRx = () => {
    lastAgentRxAtMs = Date.now();
  };

  const observer: ClientObserverLike = {
    onRpcNotify: () => {
      markAgentRx();
    },
    onRpcCall: (result) => {
      // Only count results that prove we received a response envelope from the peer.
      if (result === 'ok' || result === 'rpc_error' || result === 'handler_not_found') {
        markAgentRx();
      }
    },
    onDiagnosticEvent: (event) => {
      reconnectController.noteProtocolDiagnostic(event, classifyReconnectFailure(protocol.error()));
    },
  };

  let ensureInFlight: Promise<void> | null = null;
  let accessResumeClient: unknown = null;
  let accessRecoverySeq = 0;
  let accessResumeInFlight: { key: number; promise: Promise<void> } | null = null;

  const ensureAccessResumed = async (attemptKey: number) => {
    const client = protocol.client();
    if (!client || protocol.status() !== 'connected') return;
    if (accessResumeClient === client) {
      setCurrentAccessChannelReady(true);
      setCurrentAccessError(null);
      setManualError(null);
      return;
    }
    if (accessResumeInFlight?.key === attemptKey) return accessResumeInFlight.promise;

    const promise = (async () => {
      const status = await withTimeout(
        rpc.access.status(),
        ACCESS_RESUME_TIMEOUT_MS,
        i18n.t('accessGate.secureSessionCheckTimedOutError'),
      );
      if (accessRecoverySeq !== attemptKey) return;
      if (!status.passwordRequired || status.unlocked) {
        accessResumeClient = client;
        setCurrentAccessChannelReady(true);
        setCurrentAccessError(null);
        setManualError(null);
        return;
      }

      const token = String(accessResumeToken() ?? '').trim();
      if (!token) {
        markCurrentAccessLocked(i18n.t('accessGate.enterPasswordToContinueError'));
        throw new Error('Access password required. Enter it again to continue.');
      }

      await withTimeout(
        rpc.access.resume({ token }),
        ACCESS_RESUME_TIMEOUT_MS,
        i18n.t('accessGate.prepareSecureSessionFailedError'),
      );
      if (accessRecoverySeq !== attemptKey) return;
      accessResumeClient = client;
      setCurrentAccessChannelReady(true);
      setCurrentAccessError(null);
      setManualError(null);
    })();

    accessResumeInFlight = { key: attemptKey, promise };

    try {
      await promise;
    } finally {
      if (accessResumeInFlight?.key === attemptKey) {
        accessResumeInFlight = null;
      }
    }
  };

  const acquireRemoteArtifact = async (ctx: Readonly<{ traceId?: string; signal?: AbortSignal }> = {}) => {
    const id = envId();
    if (!id) throw new Error(i18n.t('shell.status.missingEnvContext'));

    // Probe runtime status to avoid grant-audit spam while the runtime is clearly offline.
    let agentStatus: string | null = null;
    try {
      const detail = await getEnvironment({ source: 'controlplane', envId: id });
      // `status` is the only availability source of truth returned by the controlplane API.
      agentStatus = detail?.status ? String(detail.status) : null;
    } catch (error) {
      const failure = classifyReconnectFailure(error);
      if (!failure.retryable) throw error;
      // For transient failures (meta/network), continue with the grant flow below.
    }
    if (agentStatus && agentStatus !== 'online') {
      throw new Error(`Runtime is ${agentStatus}.`);
    }

    const entryTicket = await mintEnvProxyEntryTicket({
      endpointId: id,
      floeApp: FLOE_APP_AGENT,
      codeSpaceId: CODE_SPACE_ID_ENV_UI,
    });

    return connectArtifactEntry({
      endpointId: id,
      floeApp: FLOE_APP_AGENT,
      entryTicket,
      ...(allowLoopbackControlplaneHTTP(window.location.protocol, localTransportSecurity)
        ? { allowLoopbackHTTP: true }
        : {}),
      traceId: ctx.traceId,
      signal: ctx.signal,
    });
  };

  const localProtocolConnectConfig: ProtocolConnectConfig | null = localTransportSecurity.policy ? createArtifactDirectReconnectConfig({
    source: { kind: 'refreshable', acquire: mintLocalDirectConnectArtifact },
    observer,
    connect: {
      ...FLOWERSEC_CONNECT_RESOURCES,
      liveness: { intervalMs: 15_000, timeoutMs: 10_000 },
      transportSecurityPolicy: localTransportSecurity.policy,
    },
    autoReconnect: LOCAL_FAST_RECONNECT_POLICY,
  }) : null;
  const remoteProtocolConnectConfig: ProtocolConnectConfig = createProxyRuntimeTunnelReconnectConfig({
    source: { kind: 'refreshable', acquire: acquireRemoteArtifact },
    observer,
    connect: {
      ...FLOWERSEC_CONNECT_RESOURCES,
      transportSecurityPolicy: RequireTLS,
    },
    autoReconnect: REMOTE_FAST_RECONNECT_POLICY,
  });

  const runConnect = async (fn: (config: ProtocolConnectConfig) => Promise<void>) => {
    const protocolStatusValue = String(protocol.status() ?? '').trim();
    if (accessRecoveryBusy() || protocolStatusValue === 'connecting' || accessPending() || accessLocked()) return;

    const id = envId();
    if (!id) {
      setManualError(i18n.t('shell.status.missingEnvContext'));
      reconnectController.activateWaiting({
        code: 'missing_environment_context',
        retryable: false,
        technical_detail: '',
        error_code: 'MISSING_ENV_CONTEXT',
      });
      protocol.disconnect();
      return;
    }

    const attemptKey = ++accessRecoverySeq;
    setConnectionAttemptSeq((n) => n + 1);
    accessResumeClient = null;
    accessResumeInFlight = null;
    setAccessRecoveryBusy(true);
    setCurrentAccessError(null);
    setManualError(null);

    try {
      if (isLocalMode()) {
        if (!localProtocolConnectConfig) {
          throw new Error(localTransportSecurity.error || i18n.t('networkExposure.policyUnavailable'));
        }
        setLocalAccessChannelReady(false);
        await fn(localProtocolConnectConfig);
        if (accessRecoverySeq !== attemptKey) return;
        accessResumeClient = protocol.client();
        setLocalAccessChannelReady(true);
        setCurrentAccessError(null);
        setManualError(null);
      } else {
        await fn(remoteProtocolConnectConfig);
        if (accessRecoverySeq !== attemptKey) return;
        await ensureAccessResumed(attemptKey);
      }
    } catch (error) {
      if (accessRecoverySeq === attemptKey) {
        handleAccessRecoveryFailure(error);
        protocol.disconnect();
      }
    } finally {
      if (accessRecoverySeq === attemptKey) {
        setAccessRecoveryBusy(false);
      }
    }
  };

  const connect = async () => runConnect((config) => protocol.connect(config));
  const reconnect = async () => runConnect((config) => protocol.reconnect(config));

  const retryAccessConnection = async () => {
    if (accessPending() || accessLocked() || accessUnlocking()) return;
    setCurrentAccessError(null);
    setManualError(null);
    setCurrentAccessChannelReady(false);
    protocol.disconnect();
    await connect();
  };

  const triggerReconnect = async () => {
    if (accessResumePending()) {
      await retryAccessConnection();
      return;
    }
    if (reconnectController.snapshot().state === 'recovering') {
      await reconnectController.requestImmediateRetry();
      return;
    }
    await reconnect();
  };

  const reloadAccessPage = () => {
    reloadCurrentPage(window);
  };

  const reconnectController = createRuntimeReconnectController({
    enabled: runtimeConnectionEstablished,
    desktopTransport: desktopTransportRecovery,
    probeAvailability: () => (isLocalMode() ? probeLocalRuntimeAvailability() : probeRemoteRuntimeAvailability()),
    reconnect,
    requestDesktopRecoveryNow: requestDesktopTransportRecoveryNow,
  });

  const currentPingSource = createMemo(() => {
    if (accessGateVisible()) return null;
    if (protocol.status() !== 'connected') return null;
    return protocol.client() ?? null;
  });

  const agentVersionModel = createAgentVersionModel({
    latestVersionRequest: environmentDetailRequest,
    currentPingSource,
    rpc,
  });

  const [runtimeMaintenanceContext, setRuntimeMaintenanceContext] = createSignal<RuntimeMaintenanceContext | null>(null);
  const refetchRuntimeMaintenanceContext = async (): Promise<RuntimeMaintenanceContext | null> => {
    const nextContext = await getRuntimeMaintenanceContextFromDesktopShell();
    setRuntimeMaintenanceContext(nextContext);
    return nextContext;
  };

  createEffect(() => {
    if (!desktopShellBridgeAvailable() || protocol.status() !== 'connected') {
      setRuntimeMaintenanceContext(null);
      return;
    }
    void refetchRuntimeMaintenanceContext().catch(() => setRuntimeMaintenanceContext(null));
  });

  let desktopAccessReadyMs: number | undefined;
  let desktopProtocolConnectedMs: number | undefined;
  let lastDesktopReadyState = '';
  let desktopReadyPaintSequence = 0;
  createEffect(() => {
    if (!accessChecked()) return;
    const phase = accessGatePhase();
    if (phase === 'checking' || phase === 'resuming') return;
    desktopAccessReadyMs ??= Math.max(0, envAppNowMs() - envAppModuleStartedAtMs);
  });
  createEffect(() => {
    if (protocol.status() !== 'connected') return;
    desktopProtocolConnectedMs ??= Math.max(0, envAppNowMs() - envAppModuleStartedAtMs);
  });
  createEffect(() => {
    const nextReadyState = accessGateVisible()
      ? (
          accessGatePhase() === 'unlock_required' || accessGatePhase() === 'resume_blocked'
            ? 'access_gate_interactive'
            : ''
        )
      : (
          protocol.status() === 'connected'
            ? 'runtime_connected'
            : ''
        );
    if (!nextReadyState) {
      desktopReadyPaintSequence += 1;
      return;
    }
    if (nextReadyState === lastDesktopReadyState) return;
    const sequence = ++desktopReadyPaintSequence;
    deferAfterPaint(() => {
      if (sequence !== desktopReadyPaintSequence || nextReadyState === lastDesktopReadyState) return;
      lastDesktopReadyState = nextReadyState;
      notifyDesktopSessionAppReady(nextReadyState, {
        bootstrap_ms: desktopBootstrapReadyMs,
        ...(desktopAccessReadyMs !== undefined ? { access_ready_ms: desktopAccessReadyMs } : {}),
        ...(desktopProtocolConnectedMs !== undefined ? { protocol_connected_ms: desktopProtocolConnectedMs } : {}),
        shell_painted_ms: Math.max(0, envAppNowMs() - envAppModuleStartedAtMs),
      });
    });
  });

  const startRuntimeRestart = async () => {
    const context = await refetchRuntimeMaintenanceContext();
    const restartPlan = context?.restart ?? null;
    if (restartPlan?.availability === 'available' && runtimeMaintenanceMethodUsesDesktop(restartPlan.method)) {
      const result = await performRuntimeMaintenanceActionInDesktopShell({ action: 'restart' });
      if (!result) {
        return {
          ok: false,
          message: i18n.t('shell.notifications.runtimeRestartDesktopOnly'),
        };
      }
      return {
        ok: result.ok && result.started,
        message: result.message,
      };
    }

    return rpc.sys.restart();
  };

  const startRuntimeUpgrade = async (targetVersion: string) => {
    const context = await refetchRuntimeMaintenanceContext();
    const upgradePlan = context?.upgrade ?? null;
    if (upgradePlan?.availability === 'available' && runtimeMaintenanceMethodUsesDesktop(upgradePlan.method)) {
      const result = await performRuntimeMaintenanceActionInDesktopShell({
        action: 'upgrade',
        target_version: targetVersion,
      });
      if (!result) {
        return {
          ok: false,
          message: i18n.t('shell.notifications.runtimeUpdateDesktopOnly'),
        };
      }
      return {
        ok: result.ok && result.started,
        message: result.message,
      };
    }

    return rpc.sys.upgrade({ targetVersion });
  };

  const upgradeRequiresTargetVersion = () => {
    const upgradePlan = runtimeMaintenanceContext()?.upgrade ?? null;
    if (upgradePlan?.availability === 'available' && runtimeMaintenanceMethodUsesDesktop(upgradePlan.method)) {
      return upgradePlan.requires_target_version === true;
    }
    return true;
  };

  const agentMaintenanceController = createAgentMaintenanceController({
    environmentDetailRequest,
    canAdmin,
    controlplaneStatus,
    protocolStatus: () => protocol.status(),
    currentProcessStartedAtMs: agentVersionModel.currentProcessStartedAtMs,
    currentVersion: agentVersionModel.currentVersion,
    notify,
    rpc,
    startRestartRequest: startRuntimeRestart,
    startUpgradeRequest: startRuntimeUpgrade,
    onMaintenanceStarted: (kind) => {
      notifyRuntimeMaintenanceStartedInDesktopShell(kind === 'upgrade' ? 'update' : 'restart');
    },
    upgradeRequiresTargetVersion,
    refetchCurrentVersion: agentVersionModel.refetchCurrentVersion,
    refetchEnvironment: async () => {
      await refetchRuntimeMaintenanceContext().catch(() => undefined);
      const next = await refetchEnv();
      return next ?? null;
    },
  });

  const runtimeUpdatePrompt = createRuntimeUpdatePromptCoordinator({
    envId,
    isLocalMode,
    accessGateVisible,
    protocolStatus: () => protocol.status(),
    canAdmin,
    envStatus: controlplaneStatus,
    version: agentVersionModel,
    maintenance: agentMaintenanceController,
  });

  createEffect(() => {
    const notice = runtimeUpdatePrompt.consumeNotice();
    if (!notice) return;
    notify.info(notice.title, notice.message);
  });

  const recoverySnapshot = reconnectController.snapshot;
  const recoveryVisible = createMemo(() => recoverySnapshot().state !== 'idle');
  const activityFlowerLauncherVisible = createMemo(() => (
    flowerTurnLauncherOpen() && flowerTurnLauncherHandoff()?.mode === 'activity'
  ));
  const activityFlowerExpanded = createMemo(() => activityFlowerPlacement() !== 'collapsed');
  const activityFlowerResidentInFullPageHost = createMemo(() => {
    const host = activityFlowerFullPageHost();
    const mountContainer = activityFlowerMountContainer();
    return Boolean(
      host?.isConnected
      && mountContainer?.parentElement === host
      && activityFlowerPanelRef?.isConnected
      && activityFlowerPanelRef
      && mountContainer.contains(activityFlowerPanelRef),
    );
  });
  const activityFlowerSurfaceVisible = createMemo(() => (
    viewMode() === 'activity'
    && activityFlowerExpanded()
    && (activityFlowerPlacement() === 'full_page'
      ? activityFlowerResidentInFullPageHost()
      : activityFlowerOverlayFramed())
    && !activityFlowerLauncherVisible()
    && !accessGateVisible()
    && !recoveryVisible()
  ));
  const activityFlowerEngaged = createMemo(() => (
    activityFlowerSurfaceVisible()
  ));
  createEffect(() => {
    const quickDraft = activityFlowerQuickDraft();
    if (
      !activityFlowerSurfaceVisible()
      || activityFlowerComposing()
      || activityFlowerComposerHandoffRequest()
      || !trimString(quickDraft)
    ) return;
    handoffActivityFlowerQuickDraft(quickDraft);
  });
  const activityFlowerStatusLabel = createMemo(() => {
    const presence = activityFlowerPresence();
    switch (presence.priority_status) {
      case 'attention':
        return i18n.tn('shell.flowerCompanion.status.attention', presence.priority_count);
      case 'failed':
        return i18n.tn('shell.flowerCompanion.status.failed', presence.priority_count);
      case 'running':
        return i18n.tn('shell.flowerCompanion.status.running', presence.priority_count);
      case 'queued':
        return i18n.tn('shell.flowerCompanion.status.queued', presence.priority_count);
      case 'canceled':
        return i18n.tn('shell.flowerCompanion.status.canceled', presence.priority_count);
      case 'completed':
        return i18n.tn('shell.flowerCompanion.status.completed', presence.priority_count);
      case 'unavailable':
        return i18n.t('shell.flowerCompanion.status.unavailable');
      default:
        return i18n.t('shell.flowerCompanion.status.idle');
    }
  });
  const activityFlowerPresenceSummary = createMemo(() => {
    const presence = activityFlowerPresence();
    if (presence.priority_status === 'idle' || presence.priority_status === 'unavailable') return '';
    const title = trimString(presence.priority_thread_title);
    return title ? `${activityFlowerStatusLabel()} · ${title}` : activityFlowerStatusLabel();
  });
  const activityFlowerCollapsedPresenceVisible = createMemo(() => (
    activityFlowerPlacement() === 'collapsed'
    && !trimString(activityFlowerQuickDraft())
    && Boolean(activityFlowerPresenceSummary())
  ));
  const activityFlowerCompanionCopy = () => ({
    label: i18n.t('shell.flowerCompanion.threadSwitcher.label'),
    searchPlaceholder: i18n.t('shell.flowerCompanion.threadSwitcher.searchPlaceholder'),
    newConversation: i18n.t('shell.flowerCompanion.threadSwitcher.newConversation'),
    empty: i18n.t('shell.flowerCompanion.threadSwitcher.empty'),
    queued: i18n.t('shell.flowerCompanion.threadSwitcher.queued'),
    groups: {
      attention: i18n.t('shell.flowerCompanion.threadSwitcher.groups.attention'),
      working: i18n.t('shell.flowerCompanion.threadSwitcher.groups.working'),
      pinned: i18n.t('shell.flowerCompanion.threadSwitcher.groups.pinned'),
      recent: i18n.t('shell.flowerCompanion.threadSwitcher.groups.recent'),
    },
  });

  createEffect(() => {
    if (activityFlowerPlacement() !== 'expanded' || viewMode() !== 'activity') return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.target instanceof Element && event.target.closest(FLOWER_RELATED_SURFACE_SELECTOR)) return;
      const focused = document.activeElement;
      if (!focused || (!activityFlowerPanelRef?.contains(focused) && focused !== activityFlowerQuickInputRef)) return;
      event.preventDefault();
      collapseActivityFlowerCompanion();
    };
    window.addEventListener('keydown', handleEscape);
    onCleanup(() => window.removeEventListener('keydown', handleEscape));
  });

  createEffect(() => {
    if (activityFlowerPlacement() !== 'expanded' || activityFlowerLauncherVisible()) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.defaultPrevented) return;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (path.includes(activityFlowerPanelRef as EventTarget) || path.includes(activityFlowerBottomBarAnchorRef as EventTarget)) return;
      const target = event.target;
      if (target instanceof Element && target.closest(FLOWER_RELATED_SURFACE_SELECTOR)) return;
      if (activityFlowerPanelRef?.contains(document.activeElement)) {
        activityNotesViewportAnchor()?.focus({ preventScroll: true });
      }
      collapseActivityFlowerCompanion(false);
    };
    window.addEventListener('pointerdown', handleOutsidePointer, true);
    onCleanup(() => window.removeEventListener('pointerdown', handleOutsidePointer, true));
  });

  let activityFlowerWasVisible = false;
  createRenderEffect(() => {
    const visible = activityFlowerSurfaceVisible();
    if (activityFlowerWasVisible && !visible && activityFlowerPanelRef?.contains(document.activeElement)) {
      const neutralOwner = viewMode() === 'workbench'
        ? workbenchNotesViewportAnchor()
        : activityNotesViewportAnchor();
      neutralOwner?.focus({ preventScroll: true });
    }
    activityFlowerWasVisible = visible;
  });
  const status = createMemo(() => {
    if (accessGatePhase() === 'unlock_required') return 'disconnected';
    if (accessGatePhase() === 'checking' || accessGatePhase() === 'resuming' || accessGatePhase() === 'resume_blocked') {
      return 'connecting';
    }
    if (recoverySnapshot().state === 'failed') return 'error';
    if (recoveryVisible()) return 'connecting';
    if (manualError()) return 'error';
    return protocol.status();
  });
  const statusLabel = createMemo(() => {
    switch (accessGatePhase()) {
      case 'checking':
        return i18n.t('shell.status.checkingAccess');
      case 'unlock_required':
        return i18n.t('shell.status.locked');
      case 'resuming':
        return i18n.t('shell.status.preparingSecureSession');
      case 'resume_blocked':
        return i18n.t('shell.status.secureSessionBlocked');
      default:
        break;
    }

    switch (recoverySnapshot().phase) {
      case 'desktop_transport': return i18n.t('shell.status.retryingConnection');
      case 'runtime_probe': return i18n.t('shell.status.waitingForRuntime');
      case 'protocol_connect': return i18n.t('shell.status.reconnecting');
      case 'secure_session': return i18n.t('shell.status.preparingSecureSession');
      case 'completed': return i18n.t('shell.framework.connected');
      case 'failed': return i18n.t('shell.status.connectionFailed');
      default: return undefined;
    }
  });
  const connecting = () => !accessGateVisible() && (
    protocol.status() === 'connecting' || recoverySnapshot().state === 'recovering'
  );
  const reconnectDisabled = createMemo(() => {
    switch (accessGatePhase()) {
      case 'checking':
      case 'unlock_required':
        return true;
      case 'resuming':
      case 'resume_blocked':
        return accessRecoveryBusy() || accessUnlocking();
      default:
        break;
    }

    if (recoverySnapshot().state === 'failed' || recoverySnapshot().state === 'succeeded') {
      return true;
    }
    if (recoverySnapshot().state === 'recovering') {
      return recoverySnapshot().phase === 'protocol_connect'
        || recoverySnapshot().phase === 'secure_session';
    }

    return accessRecoveryBusy() || connecting();
  });
  const reconnectLabel = createMemo(() => {
    switch (accessGatePhase()) {
      case 'checking':
        return i18n.t('shell.status.checkingAccess');
      case 'unlock_required':
        return i18n.t('shell.status.unlockRequired');
      case 'resuming':
      case 'resume_blocked':
        return accessRecoveryBusy()
          ? i18n.t('shell.status.preparingSecureSession')
          : i18n.t('shell.status.retryConnection');
      default:
        break;
    }

    if (recoverySnapshot().state === 'recovering') {
      return reconnectDisabled()
        ? i18n.t('shell.status.reconnectingEllipsis')
        : i18n.t('shell.status.retryNow');
    }
    return connecting() ? i18n.t('shell.status.connectingEllipsis') : i18n.t('shell.status.reconnect');
  });

  const submitAccessUnlock = async (event?: SubmitEvent) => {
    event?.preventDefault();
    if (accessUnlocking()) return;
    if (accessRetryRemainingMs() > 0) return;

    setCurrentAccessUnlocking(true);
    setCurrentAccessError(null);
    setCurrentAccessRetryUntil(0);
    setManualError(null);

    try {
      const out = isLocalMode() ? await unlockLocalAccess(accessPassword()) : await unlockEnvAppAccess(accessPassword());
      const token = String(out?.resume_token ?? '').trim();
      if (!token) {
        throw new Error(i18n.t('accessGate.missingResumeTokenError'));
      }

      setCurrentAccessResumeToken(token);
      setCurrentAccessPassword('');
      accessResumeClient = null;

      if (isLocalMode()) {
        setLocalAccessStatus((current) => ({
          password_required: true,
          unlocked: true,
          ...(current?.exposure ? { exposure: current.exposure } : {}),
          ...(current?.urls ? { urls: current.urls } : {}),
        }));
        setLocalAccessChecked(true);
        const refreshedRuntime = await refreshLocalRuntime();
        if (refreshedRuntime) {
          setLocalRuntime(refreshedRuntime);
          if (refreshedRuntime.access_status) {
            setLocalAccessStatus(refreshedRuntime.access_status);
          }
        }
      } else {
        const nextStatus = await getEnvAppAccessStatus();
        setRemoteAccessStatus(nextStatus);
        setRemoteAccessChecked(true);
      }

      await connect();
    } catch (error) {
      const message = localizedAccessUnlockErrorMessage(error, i18n);
      const retryAfterMs = getAccessUnlockRetryAfterMs(error);
      setCurrentAccessRetryUntil(retryAfterMs > 0 ? Date.now() + retryAfterMs : 0);
      setCurrentAccessError(message || i18n.t('accessGate.unlockFailedError'));
      queueMicrotask(() => {
        accessPasswordInput?.focus();
        accessPasswordInput?.select();
      });
    } finally {
      setCurrentAccessUnlocking(false);
    }
  };

  createEffect(() => {
    if (!accessLocked()) return;
    if (accessPending()) return;
    queueMicrotask(() => accessPasswordInput?.focus());
  });

  createEffect(() => {
    if (!accessPasswordRequired()) return;
    if (protocol.status() !== 'connected') {
      setCurrentAccessChannelReady(false);
    }
  });

  let lastConnectedClient: unknown = null;

  createEffect(() => {
    if (!runtimeConnectionEstablished() || connectionAttemptSeq() <= 0) return;

    const protocolStatusValue = String(protocol.status() ?? '').trim();
    if (!protocolStatusValue) return;
    if (accessRecoveryBusy() && protocolStatusValue === 'disconnected') return;

    const rawFailure = manualError() || protocol.error();
    const failure = classifyReconnectFailure(rawFailure);

    if (protocolStatusValue === 'connected') {
      if (lastConnectedClient !== protocol.client()) {
        lastConnectedClient = protocol.client();
        if (!isLocalMode()) {
          void refetchEnv();
        }
      }
      untrack(() => reconnectController.noteProtocolConnected());
      return;
    }

    lastConnectedClient = null;
    if (protocolStatusValue === 'connecting') {
      untrack(() => reconnectController.noteProtocolConnecting());
      return;
    }
    untrack(() => reconnectController.activateWaiting(failure));
  });

  createEffect(() => {
    const protocolConnected = protocol.status() === 'connected';
    const secureSessionReady = accessChannelReady();
    const recoveringAccess = accessRecoveryBusy();
    const locked = accessLocked();

    if (protocolConnected && secureSessionReady) {
      setRuntimeConnectionEstablished(true);
    }
    if (!runtimeConnectionEstablished()) return;

    if (locked) {
      untrack(() => reconnectController.noteSecureSession('failed', {
        code: 'authentication_failed',
        retryable: false,
        technical_detail: accessError() || '',
      }));
      return;
    }
    if (recoveringAccess) {
      untrack(() => reconnectController.noteSecureSession('recovering'));
      return;
    }
    if (protocolConnected && secureSessionReady) {
      untrack(() => reconnectController.noteSecureSession('ready'));
    }
  });

  createEffect(() => {
    if (accessGateVisible()) {
      accessResumeClient = null;
      return;
    }

    const client = protocol.client();
    const st = protocol.status();
    if (st !== 'connected' || !client) {
      accessResumeClient = null;
      return;
    }
    if (isLocalMode()) {
      accessResumeClient = client;
      setCurrentAccessChannelReady(true);
      setCurrentAccessError(null);
      setManualError(null);
      return;
    }
    if (accessResumeClient === client) return;
    const attemptKey = ++accessRecoverySeq;
    accessResumeInFlight = null;
    setAccessRecoveryBusy(true);
    setCurrentAccessError(null);
    setManualError(null);
    void ensureAccessResumed(attemptKey).catch((error) => {
      if (accessRecoverySeq === attemptKey) {
        handleAccessRecoveryFailure(error);
        protocol.disconnect();
      }
    }).finally(() => {
      if (accessRecoverySeq === attemptKey) {
        setAccessRecoveryBusy(false);
      }
    });
  });

  const probe = async (): Promise<boolean> => {
    const startedAt = Date.now();

    const p = rpc.sys.ping();
    // If we timeout and then close the client (by reconnecting), the original ping promise
    // might reject later; attach a handler to avoid unhandled rejections.
    p.catch(() => {
    });

    let timer: number | undefined;
    try {
      await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
        }),
      ]);
      console.debug('[envapp] health probe ok', { ms: Date.now() - startedAt });
      return true;
    } catch (e) {
      console.debug('[envapp] health probe failed', {
        ms: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    } finally {
      if (typeof timer !== 'undefined') window.clearTimeout(timer);
    }
  };

  const ensureHealthy = (reason: string) => {
    if (ensureInFlight) return ensureInFlight;

    ensureInFlight = (async () => {
      if (accessGateVisible()) return;
      if (connecting()) return;
      if (manualError() && !classifyReconnectFailure(manualError()).retryable) return;
      if (recoverySnapshot().state === 'recovering') {
        console.debug('[envapp] ensureHealthy: nudge waiting reconnect', { reason });
        await reconnectController.requestImmediateRetry();
        return;
      }

      const st = protocol.status();
      const client = protocol.client();
      if (st !== 'connected' || !client) {
        console.debug('[envapp] ensureHealthy: connect', { reason, status: st });
        await connect();
        return;
      }

      const now = Date.now();
      const lastRxAgeMs = lastAgentRxAtMs > 0 ? now - lastAgentRxAtMs : Number.POSITIVE_INFINITY;
      if (lastRxAgeMs <= RECENT_AGENT_RX_MS) {
        console.debug('[envapp] ensureHealthy: recent rx; skip', { reason, lastRxAgeMs });
        return;
      }

      console.debug('[envapp] ensureHealthy: probing', { reason, lastRxAgeMs });
      const ok = await probe();
      if (ok) return;

      const rxAgeAfterProbe = lastAgentRxAtMs > 0 ? Date.now() - lastAgentRxAtMs : Number.POSITIVE_INFINITY;
      if (rxAgeAfterProbe <= RECENT_AGENT_RX_MS) {
        console.debug('[envapp] ensureHealthy: rx during probe; skip reconnect', { reason, rxAgeAfterProbe });
        return;
      }

      console.debug('[envapp] ensureHealthy: reconnect', { reason });
      await reconnect();
    })().finally(() => {
      ensureInFlight = null;
    });

    return ensureInFlight;
  };

  onMount(() => {
    layout.setSidebarCollapsed(true);
    void (async () => {
      const rt = await getLocalRuntime();
      let localStatus: LocalAccessStatus | null = null;
      let remoteStatus: EnvAppAccessStatus = { password_required: false, unlocked: true };
      if (rt) {
        setLocalRuntime(rt);
        setRemoteAccessStatus(null);
        setRemoteAccessChecked(false);
        setRemoteAccessChannelReady(false);

        localStatus = rt.access_status ?? await getLocalAccessStatus();
        setLocalAccessStatus(localStatus);
        setLocalAccessChecked(true);
        setLocalAccessChannelReady(localStatus?.password_required !== true);

        // Desktop provider sessions carry the user-facing controlplane env id;
        // SSH/external sessions keep their Desktop target id only for display.
        const desktopCtx = readDesktopSessionContextSnapshot();
        const sessionEnvID = (desktopCtx?.env_public_id ?? '').trim();
        const localFallbackID = String((rt as any).env_public_id ?? '').trim() || 'env_local';
        const effectiveEnvID = sessionEnvID || localFallbackID;
        try {
          sessionStorage.setItem('redeven_env_public_id', effectiveEnvID);
        } catch {
          // ignore
        }
        setEnvId(effectiveEnvID);
      } else {
        setLocalRuntime(null);
        setLocalAccessStatus(null);
        setLocalAccessChecked(false);
        setLocalAccessChannelReady(false);

        try {
          remoteStatus = await getEnvAppAccessStatus();
        } catch {
          remoteStatus = { password_required: false, unlocked: true };
        }
        setRemoteAccessStatus(remoteStatus);
        setRemoteAccessChecked(true);
        setRemoteAccessChannelReady(!remoteStatus.password_required);
        setEnvId(getEnvPublicIDFromSession());
      }

      const preferredDesktopViewMode = readPersistedDesktopViewMode() ?? 'workbench';
      let preferredSurface = readPersistedActiveSurface();
      if (rt && preferredSurface === 'ports') preferredSurface = 'codespaces';
      if (preferredSurface === 'ai' && preferredDesktopViewMode === 'workbench') {
        preferredSurface = null;
        setPendingAutoOpenAI(true);
      }
      if (preferredSurface === 'codex') {
        // Defer opening Codex until permissions are loaded (and only if RWX is granted).
        preferredSurface = null;
        setPendingAutoOpenCodex(true);
      }

      const initialSurface = preferredSurface ?? ENV_DEFAULT_SURFACE_ID;
      setDesktopViewMode(preferredDesktopViewMode);
      setLastActivitySurface(initialSurface);
      setLastRequestedSurface(initialSurface);
      layout.setSidebarActiveTab(initialSurface, { openSidebar: false });
      initialActivitySurface = initialSurface;
      if (!layout.isMobile() && preferredDesktopViewMode === 'workbench') {
        requestWorkbenchOverviewEntry();
      }
      setPersistReady(true);

      if (accessLocked()) {
        setManualError(null);
        return;
      }

      await connect();
    })();
  });

  onCleanup(() => {
    protocol.disconnect();
  });

  // Cross-window handshake: allow non-Env App sandbox windows (codespaces/3rd-party apps) to
  // request a fresh short-lived bootstrap credential after refresh.
  onMount(() => {
    const onMessage = (ev: MessageEvent) => {
      if (isLocalMode()) return;

      const data: any = ev.data;
      if (!data || typeof data !== 'object') return;
      if (String(data.type ?? '') !== 'redeven:boot_ready') return;

      const payload: any = data.payload;
      const floeApp = String(payload?.floe_app ?? '').trim();
      const codeSpaceID = String(payload?.code_space_id ?? '').trim();
      if (!floeApp || !codeSpaceID) return;

      const info = getSandboxWindowInfo(ev.source);
      if (!info) return;
      if (ev.origin !== info.origin) return;
      if (floeApp !== info.floe_app || codeSpaceID !== info.code_space_id) return;
      if (floeApp !== FLOE_APP_CODE && floeApp !== FLOE_APP_PORT_FORWARD) return;

      const launcherFloeApp: LauncherFloeApp = floeApp;
      const envPublicID = envId();
      if (!envPublicID) return;

      void (async () => {
        try {
          const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp: launcherFloeApp, codeSpaceId: codeSpaceID });
          (ev.source as Window).postMessage(
            {
              type: 'redeven:boot_init',
              payload: {
                v: 2,
                env_public_id: envPublicID,
                floe_app: launcherFloeApp,
                code_space_id: codeSpaceID,
                app_path: info.app_path,
                entry_ticket: entryTicket,
              },
            },
            info.origin,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          notify.error(i18n.t('shell.notifications.failedToRefreshSessionTitle'), msg);
        }
      })();
    };

    window.addEventListener('message', onMessage);
    onCleanup(() => {
      window.removeEventListener('message', onMessage);
    });
  });

  // Ensure the tunnel is healthy after common browser lifecycle transitions.
  onMount(() => {
    const onOnline = () => void ensureHealthy('online');
    const onFocus = () => void ensureHealthy('focus');
    const onVisibility = () => {
      if (!document.hidden) void ensureHealthy('visibility');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    onCleanup(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  });

  const components = createMemo<FloeComponent[]>(() => {
    const list: FloeComponent[] = [
      { id: 'terminal', name: i18n.t('shell.nav.terminal'), icon: Terminal, component: EnvTerminalPage, sidebar: { order: 1, fullScreen: true } },
      { id: 'monitor', name: i18n.t('shell.nav.monitoring'), icon: Activity, component: EnvMonitorPage, sidebar: { order: 2, fullScreen: true } },
      { id: 'files', name: i18n.t('shell.nav.fileBrowser'), icon: Files, component: EnvFileBrowserPage, sidebar: { order: 3, fullScreen: true } },
      { id: 'codespaces', name: i18n.t('shell.nav.codespaces'), icon: Code, component: EnvCodespacesPage, sidebar: { order: 4, fullScreen: true } },
      { id: 'ports', name: i18n.t('shell.nav.webServices'), icon: Globe, component: EnvPortForwardsPage, sidebar: { order: 5, fullScreen: true } },
    ];
    if (canUseFlower()) {
      const ActivityFlowerFullPageHost = () => {
        let host: HTMLDivElement | undefined;
        onMount(() => {
          if (host) setActivityFlowerFullPageHost(host);
        });
        onCleanup(() => {
          setActivityFlowerFullPageHost((current) => (current === host ? null : current));
        });
        return (
          <div
            ref={host}
            class="relative h-full min-h-0 w-full"
            data-activity-flower-full-page-host
          />
        );
      };
      list.push({
        id: 'ai',
        name: i18n.t('shell.nav.flower'),
        icon: FlowerNavigationIcon,
        component: ActivityFlowerFullPageHost,
        sidebar: { order: 6, fullScreen: true },
      });
    }
    list.push({
      id: 'codex',
      name: i18n.t('shell.nav.codex'),
      icon: CodexNavigationIcon,
      component: () => <CodexActivitySurface sidebarHost={codexSidebarHost} />,
      sidebar: { order: 7, fullScreen: false, renderIn: 'main' },
    });
    if (__REDEVEN_PLUGIN_UI_ENABLED__) {
      list.push({
        id: PLUGIN_CENTER_ACTIVITY_ID,
        name: 'Plugin Center',
        icon: Grid3x3,
        component: () => (
          <PluginCenterView
            selectedPluginID={pluginCenterSelectedPluginID()}
            canManagePlugins={protocol.status() === 'connected' && canAdmin()}
            canOpenPluginSurfaces={protocol.status() === 'connected' && canAdmin()}
            onCommand={handlePluginCenterCommand}
            onClose={closePluginCenter}
          />
        ),
        sidebar: { order: 98, fullScreen: true },
      });
      list.push({
        id: PLUGIN_SURFACE_ACTIVITY_ID,
        name: 'Plugin Surface',
        icon: Grid3x3,
        component: () => {
          const surface = activePluginSurface();
          return surface ? (
            <PluginSurfaceFrame surface={surface} onClose={closePluginSurface} />
          ) : (
            <div data-plugin-surface-empty class="flex h-full items-center justify-center text-sm text-muted-foreground">
              {i18n.t('uiCopy.shell.noPluginSurface')}
            </div>
          );
        },
        sidebar: { order: 99, fullScreen: true },
      });
    }
    list.push({ id: 'settings', name: i18n.t('shell.nav.runtimeSettings'), icon: Settings, component: EnvSettingsPage, sidebar: { order: 100, fullScreen: true } });
    return list;
  });

  const [persistReady, setPersistReady] = createSignal(false);

  const resolveSidebarVisibilityMotion = (
    nextTab: string,
  ) => resolveEnvSidebarVisibilityMotion({
    currentTab: layout.sidebarActiveTab(),
    nextTab,
    isMobile: layout.isMobile(),
  });

  const setEnvSidebarActiveTab = (
    tab: string,
    opts?: { openSidebar?: boolean },
  ) => {
    layout.setSidebarActiveTab(tab, {
      openSidebar: opts?.openSidebar,
      visibilityMotion: resolveSidebarVisibilityMotion(tab),
    });
  };

  const activateActivitySurface = (surface: EnvActivitySurfaceId, opts?: { persist?: boolean }) => {
    if (surface === 'ai') {
      setActivityFlowerPresentation('collapsed');
    }
    if (surface !== 'settings' && surface !== PLUGIN_CENTER_ACTIVITY_ID && surface !== PLUGIN_SURFACE_ACTIVITY_ID) {
      setSettingsOrigin(null);
      setLastActivitySurface(surface);
      setLastRequestedSurface(surface);
      if (opts?.persist !== false) {
        persistActiveSurface(surface);
      }
    }
    setEnvSidebarActiveTab(surface, { openSidebar: shouldEnvTabOpenSidebar(surface) });
  };

  const resolveOpenSurfaceTarget = (surfaceId: EnvSurfaceId, options?: EnvOpenSurfaceOptions): EnvSurfaceId => {
    if (surfaceId === 'ai' && !canUseFlower()) {
      if (options?.reason !== 'mode_restore') {
        notify.error(
          env.state === 'ready' ? i18n.t('shell.notifications.permissionDeniedTitle') : i18n.t('shell.notifications.notReadyTitle'),
          env.state === 'ready'
            ? i18n.t('shell.notifications.rwxPermissionRequired')
            : i18n.t('shell.notifications.loadingEnvironmentPermissions'),
        );
      }
      return ENV_DEFAULT_SURFACE_ID;
    }
    if (surfaceId === 'codex' && !canUseCodex()) {
      if (options?.reason !== 'mode_restore') {
        notify.error(
          env.state === 'ready' ? i18n.t('shell.notifications.permissionDeniedTitle') : i18n.t('shell.notifications.notReadyTitle'),
          env.state === 'ready'
            ? i18n.t('shell.notifications.rwxPermissionRequired')
            : i18n.t('shell.notifications.loadingEnvironmentPermissions'),
        );
      }
      return ENV_DEFAULT_SURFACE_ID;
    }
    return surfaceId;
  };

  const activateWorkbenchSurface = (surfaceId: EnvSurfaceId, options?: EnvOpenSurfaceOptions) => {
    setLastRequestedSurface(surfaceId);
    setWorkbenchSurfaceActivation({
      requestId: createClientId(),
      surfaceId,
      focus: options?.focus ?? true,
      ensureVisible: options?.ensureVisible ?? true,
      centerViewport: options?.centerViewport,
      openStrategy: options?.openStrategy,
      workbenchAnchor: options?.workbenchAnchor,
      terminalPayload: options?.terminalPayload,
      fileBrowserPayload: options?.fileBrowserPayload,
    });
    setWorkbenchSurfaceActivationSeq((n) => n + 1);
  };

  const openSurfaceInWorkbench = (surfaceId: EnvSurfaceId, options?: EnvOpenSurfaceOptions) => {
    if (layout.isMobile()) {
      openSurface(surfaceId, options);
      return;
    }

    if (viewMode() === 'workbench') {
      openSurface(surfaceId, options);
      return;
    }

    setViewMode('workbench', { surfaceId, focusSurface: false, requestWorkbenchOverview: false });
    queueMicrotask(() => {
      openSurface(surfaceId, options);
    });
  };

  const setViewMode = (
    mode: EnvViewMode,
    options?: {
      surfaceId?: EnvSurfaceId;
      focusSurface?: boolean;
      requestWorkbenchOverview?: boolean;
    },
  ) => {
    const previousMode = viewMode();
    const requestedMode = layout.isMobile() ? 'activity' : mode;
    if (!layout.isMobile()) {
      setDesktopViewMode(requestedMode);
      persistDesktopViewMode(requestedMode);
    }

    const targetSurface = resolveOpenSurfaceTarget(options?.surfaceId ?? activeSurface(), { reason: 'mode_restore' });
    setLastRequestedSurface(targetSurface);

    if (requestedMode === 'activity') {
      activateActivitySurface(targetSurface, { persist: false });
      return;
    }
    if (!flowerTurnLauncherOpen()) {
      setActivityFlowerPresentation('collapsed');
    }
    if (
      requestedMode === 'workbench'
      && previousMode !== 'workbench'
      && (options?.requestWorkbenchOverview ?? true)
    ) {
      requestWorkbenchOverviewEntry();
    }
  };

  const viewModeSelection = createUIFirstSelection<EnvViewMode, {
    surfaceId: EnvSurfaceId;
    focusSurface: boolean;
  }>({
    committed: viewMode,
    commit: (mode, options) => setViewMode(mode, {
      surfaceId: options?.surfaceId ?? activeSurface(),
      focusSurface: options?.focusSurface ?? mode !== 'activity',
    }),
    onEvent: createUIPresentationEventRecorder({
      surface: 'env-display-mode',
      source: 'mode-switch',
    }),
  });

  const openSurface = (surfaceId: EnvSurfaceId, options?: EnvOpenSurfaceOptions) => {
    if (surfaceId === 'terminal') {
      void preloadTerminalFeatureResources({ reason: 'intent' }).catch(() => undefined);
    }
    const targetSurface = resolveOpenSurfaceTarget(surfaceId, options);

    if (viewMode() === 'workbench') {
      activateWorkbenchSurface(targetSurface, options);
      return;
    }
    if (targetSurface === 'ai') {
      activateActivitySurface('ai');
      if (options?.focus === true) setActivityFlowerComposerFocusRequest((request) => request + 1);
      return;
    }
    activateActivitySurface(targetSurface);
  };

  createEffect(() => {
    if (!persistReady() || !pendingAutoOpenAI()) return;
    if (env.state === 'ready' && !canUseFlower()) {
      setPendingAutoOpenAI(false);
      return;
    }
    if (!canUseFlower()) return;
    if (initialActivitySurface && layout.sidebarActiveTab() !== initialActivitySurface) return;
    setPendingAutoOpenAI(false);
    openSurface('ai', { reason: 'mode_restore', focus: true, ensureVisible: true });
  });

  createEffect(() => {
    if (!persistReady() || !pendingAutoOpenCodex()) return;
    if (env.state === 'ready' && !canUseCodex()) {
      setPendingAutoOpenCodex(false);
      return;
    }
    if (!canUseCodex()) return;
    if (initialActivitySurface && layout.sidebarActiveTab() !== initialActivitySurface) return;
    setPendingAutoOpenCodex(false);
    openSurface('codex', { reason: 'mode_restore', focus: true, ensureVisible: true });
  });

  createEffect(() => {
    if (layout.sidebarActiveTab() !== 'codex') return;
    if (canUseCodex()) return;
    activateActivitySurface(ENV_DEFAULT_SURFACE_ID, { persist: false });
  });

  createEffect(() => {
    if (!layout.isMobile() || layout.sidebarActiveTab() !== 'files') {
      setFilesMobileSidebarOpen(false);
    }
  });

  createEffect(() => {
    if (!persistReady()) return;
    const id = layout.sidebarActiveTab();
    if (!isEnvSurfaceId(id)) return;
    setLastActivitySurface(id);
    if (viewMode() === 'activity') {
      setLastRequestedSurface(id);
    }
    persistActiveSurface(id);
  });

  const activityItems = (): ActivityBarItem[] => {
    const items: ActivityBarItem[] = [];

    items.push(
      { id: 'terminal', icon: ActivityBarTerminalIcon, label: i18n.t('shell.nav.terminal'), collapseBehavior: 'preserve' },
      { id: 'monitor', icon: ActivityBarMonitorIcon, label: i18n.t('shell.nav.monitoring'), collapseBehavior: 'preserve' },
      layout.isMobile()
        ? {
            id: 'files',
            icon: ActivityBarFolderIcon,
            label: i18n.t('shell.nav.fileBrowser'),
            collapseBehavior: 'preserve',
            onClick: () => {
              const active = layout.sidebarActiveTab() === 'files';
              if (!active) {
                setEnvSidebarActiveTab('files', { openSidebar: false });
                setFilesMobileSidebarOpen(true);
                return;
              }
              toggleFilesMobileSidebar();
            },
          }
        : { id: 'files', icon: ActivityBarFolderIcon, label: i18n.t('shell.nav.fileBrowser'), collapseBehavior: 'preserve' },
      { id: 'codespaces', icon: ActivityBarCodespacesIcon, label: i18n.t('shell.nav.codespaces'), collapseBehavior: 'preserve' },
      { id: 'ports', icon: ActivityBarPortsIcon, label: i18n.t('shell.nav.webServices'), collapseBehavior: 'preserve' },
    );
    if (__REDEVEN_PLUGIN_UI_ENABLED__) {
      items.push({
        id: 'plugins',
        icon: Grid3x3,
        label: i18n.t('uiCopy.plugin.panelTitle'),
        collapseBehavior: 'preserve',
        onClick: () => {
          setPluginsPanelOpen((open) => !open);
          void refetchPluginInventory();
        },
      });
    }
    if (canUseFlower()) {
      items.push({
        id: 'ai',
        icon: FlowerNavigationIcon,
        label: i18n.t('shell.nav.flower'),
        collapseBehavior: 'preserve',
        onClick: () => activateActivitySurface('ai'),
      });
    }
    if (canUseCodex()) {
      items.push({
        id: 'codex',
        icon: CodexNavigationIcon,
        label: i18n.t('shell.nav.codex'),
        collapseBehavior: 'toggle',
      });
    }
    return items;
  };

  const activityBottomItems = (): ActivityBarItem[] => {
    if (layout.isMobile()) {
      return [];
    }

    const items: ActivityBarItem[] = [];
    if (desktopShellBridgeAvailable()) {
      items.push({
        id: 'switch-environment',
        icon: ActivityBarSwitchIcon,
        label: i18n.t('shell.nav.switchEnvironment'),
        onClick: () => {
          void openConnectionCenter();
        },
      });
    }
    items.push({
      id: 'settings',
      icon: ActivityBarSettingsIcon,
      label: i18n.t('shell.nav.runtimeSettings'),
      onClick: () => openSettings(),
    });
    return items;
  };

  const envSessionIdentity = createMemo<EnvSessionIdentity>(() => {
    const desktopCtx = readDesktopSessionContextSnapshot();
    const contextSource = desktopCtx?.session_source;
    const source: EnvSessionSource =
      contextSource === 'local_runtime' ||
      contextSource === 'provider_environment' ||
      contextSource === 'ssh_environment' ||
      contextSource === 'external_local_ui' ||
      contextSource === 'runtime_gateway'
        ? contextSource
        : isLocalMode()
          ? 'local_runtime'
          : 'region_sandbox';
    const displayID =
      source === 'provider_environment'
        ? (desktopCtx?.env_public_id ?? '').trim() || envId()
        : source === 'ssh_environment' || source === 'external_local_ui'
          ? (desktopCtx?.env_public_id ?? '').trim() || (desktopCtx?.local_environment_id ?? '').trim() || envId()
          : envId() || (isLocalMode() ? localRuntime()?.env_public_id || 'env_local' : '');

    let displayName = (desktopCtx?.label ?? '').trim();
    if (!displayName && !accessGateVisible() && env.state === 'ready') {
      displayName = env()?.name || '';
    }
    if (!displayName) {
      displayName = source === 'local_runtime'
        ? i18n.t('shell.status.localRuntime')
        : i18n.t('shell.status.environment');
    }

    return {
      source,
      displayName,
      displayID,
    };
  });

  const envTypeLabel = createMemo(() => {
    switch (envSessionIdentity().source) {
      case 'ssh_environment': return i18n.t('shell.status.envTypeSSH');
      case 'provider_environment': return i18n.t('shell.status.envTypeProvider');
      case 'external_local_ui':
      case 'runtime_gateway':
      case 'region_sandbox': return i18n.t('shell.status.envTypeRemote');
      default: return i18n.t('shell.status.envTypeLocal');
    }
  });

  function consoleOrigin(): string {
    try {
      return controlPlaneOriginFromSandboxLocation(window.location);
    } catch {
      const proto = window.location.protocol;
      const host = window.location.hostname.trim().toLowerCase();
      const port = window.location.port ? `:${window.location.port}` : '';
      const parts = host.split('.');
      if (parts.length >= 3) {
        parts.shift();
        return `${proto}//${parts.join('.')}${port}`;
      }
      return `${proto}//${host}${port}`;
    }
  }

  async function openDashboard(): Promise<void> {
    const desktopShellAvailable = desktopShellBridgeAvailable();
    const result = await openDashboardInDesktopShell();
    if (result?.ok) {
      return;
    }
    if (desktopShellAvailable) {
      notify.error(
        i18n.t('shell.notifications.failedToOpenDashboardTitle'),
        result?.message || i18n.t('shell.notifications.desktopOpenBrowserFailed'),
      );
      return;
    }
    const dashboardURL = `${consoleOrigin()}/dashboard`;
    window.location.assign(dashboardURL);
  }

  // Env App command palette commands (navigation + common actions).
  // Note: register commands once per Shell lifecycle to avoid duplicates during HMR/remount.
  createEffect(() => {
    const desktopShellAvailable = desktopShellBridgeAvailable();
    const commandCategory = i18n.t('shell.commandPalette.categories.navigation');
    const environmentCategory = i18n.t('shell.commandPalette.categories.environment');
    const generalCategory = i18n.t('shell.commandPalette.categories.general');

    const list: any[] = [
      {
        id: 'redeven.env.switchToActivity',
        title: i18n.t('shell.commandPalette.switchToActivityTitle'),
        description: i18n.t('shell.commandPalette.switchToActivityDescription'),
        category: commandCategory,
        keybind: 'mod+shift+1',
        icon: Terminal,
        execute: () => setViewMode('activity', { surfaceId: lastActivitySurface() }),
      },
      {
        id: 'redeven.env.switchToWorkbench',
        title: i18n.t('shell.commandPalette.switchToWorkbenchTitle'),
        description: i18n.t('shell.commandPalette.switchToWorkbenchDescription'),
        category: commandCategory,
        keybind: 'mod+shift+2',
        icon: LayoutDashboard,
        execute: () => setViewMode('workbench', { surfaceId: activeSurface(), focusSurface: true }),
      },
      {
        id: 'redeven.env.goToTerminal',
        title: i18n.t('shell.commandPalette.goToTerminalTitle'),
        description: i18n.t('shell.commandPalette.goToTerminalDescription'),
        category: commandCategory,
        keybind: 'mod+shift+t',
        icon: Terminal,
        execute: () => openSurface('terminal', { reason: 'direct_navigation', focus: true, ensureVisible: true }),
      },
      ...(!layout.isMobile() ? [{
        id: 'redeven.env.newTerminalWindow',
        title: i18n.t('shell.commandPalette.newTerminalWindowTitle'),
        description: i18n.t('shell.commandPalette.newTerminalWindowDescription'),
        category: commandCategory,
        icon: Terminal,
        execute: () => openSurfaceInWorkbench('terminal', {
          reason: 'direct_navigation',
          focus: true,
          ensureVisible: true,
          openStrategy: 'create_new',
        }),
      }] : []),
      {
        id: 'redeven.env.goToMonitoring',
        title: i18n.t('shell.commandPalette.goToMonitoringTitle'),
        description: i18n.t('shell.commandPalette.goToMonitoringDescription'),
        category: commandCategory,
        keybind: 'mod+shift+m',
        icon: Activity,
        execute: () => openSurface('monitor', { reason: 'direct_navigation', focus: true, ensureVisible: true }),
      },
      {
        id: 'redeven.env.goToFiles',
        title: i18n.t('shell.commandPalette.goToFilesTitle'),
        description: i18n.t('shell.commandPalette.goToFilesDescription'),
        category: commandCategory,
        keybind: 'mod+shift+f',
        icon: Files,
        execute: () => openSurface('files', { reason: 'direct_navigation', focus: true, ensureVisible: true }),
      },
      ...(!layout.isMobile() ? [{
        id: 'redeven.env.newFileWindow',
        title: i18n.t('shell.commandPalette.newFileWindowTitle'),
        description: i18n.t('shell.commandPalette.newFileWindowDescription'),
        category: commandCategory,
        icon: Files,
        execute: () => openSurfaceInWorkbench('files', {
          reason: 'direct_navigation',
          focus: true,
          ensureVisible: true,
          openStrategy: 'create_new',
        }),
      }] : []),
      {
        id: 'redeven.env.goToCodespaces',
        title: i18n.t('shell.commandPalette.goToCodespacesTitle'),
        description: i18n.t('shell.commandPalette.goToCodespacesDescription'),
        category: commandCategory,
        keybind: 'mod+shift+c',
        icon: Code,
        execute: () => openSurface('codespaces', { reason: 'direct_navigation', focus: true, ensureVisible: true }),
      },
    ];

    list.push({
      id: 'redeven.env.goToWebServices',
      title: i18n.t('shell.commandPalette.goToWebServicesTitle'),
      description: i18n.t('shell.commandPalette.goToWebServicesDescription'),
      category: commandCategory,
      keybind: 'mod+shift+o',
      icon: Globe,
      execute: () => openSurface('ports', { reason: 'direct_navigation', focus: true, ensureVisible: true }),
    });

    if (canUseFlower()) {
      list.push({
        id: 'redeven.env.goToFlower',
        title: i18n.t('shell.commandPalette.goToFlowerTitle'),
        description: i18n.t('shell.commandPalette.goToFlowerDescription'),
        category: commandCategory,
        keybind: 'mod+shift+a',
        icon: FlowerNavigationIcon,
        execute: () => openSurface('ai', { reason: 'direct_navigation', focus: true, ensureVisible: true }),
      });
    }

    list.push({
      id: 'redeven.env.goToCodex',
      title: i18n.t('shell.commandPalette.goToCodexTitle'),
      description: i18n.t('shell.commandPalette.goToCodexDescription'),
      category: commandCategory,
      keybind: 'mod+shift+x',
      icon: CodexNavigationIcon,
      execute: () => openSurface('codex', { reason: 'direct_navigation', focus: true, ensureVisible: true }),
    });

    const runDesktopShellCommand = async (
      actionLabel: string,
      action: () => Promise<boolean>,
    ): Promise<void> => {
      try {
        const handled = await action();
        if (handled) {
          return;
        }
        notify.error(
          i18n.t('shell.notifications.desktopCommandUnavailableTitle'),
          i18n.t('shell.notifications.desktopOnlyMessage', { action: actionLabel }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify.error(
          i18n.t('shell.notifications.failedToOpenDesktopCommandTitle', { action: actionLabel }),
          message || i18n.t('shell.notifications.unknownDesktopShellError'),
        );
      }
    };

    if (desktopShellAvailable) {
      list.push(...buildDesktopShellCommandPaletteEntries({
        labels: {
          category: i18n.t('shell.commandPalette.categories.desktop'),
          title: i18n.t('shell.commandPalette.openEnvironmentTitle'),
          description: i18n.t('shell.commandPalette.openEnvironmentDescription'),
        },
        openEnvironmentLauncher: () => runDesktopShellCommand(i18n.t('shell.commandPalette.openEnvironmentTitle'), openConnectionCenter),
      }));
    }

    list.push(
      {
        id: 'redeven.env.backToDashboard',
        title: i18n.t('shell.commandPalette.backToDashboardTitle'),
        description: i18n.t('shell.commandPalette.backToDashboardDescription'),
        category: commandCategory,
        keybind: 'mod+shift+e',
        icon: Grid3x3,
        execute: () => {
          void openDashboard();
        },
      },
      {
        id: 'redeven.env.openRuntimeSettings',
        title: i18n.t('shell.commandPalette.openRuntimeSettingsTitle'),
        description: i18n.t('shell.commandPalette.openRuntimeSettingsDescription'),
        category: environmentCategory,
        keybind: 'mod+,',
        icon: Settings,
        execute: () => openSettings(),
      },
    );

    if (i18n.source() === 'browser') {
      list.push({
        id: 'redeven.env.changeLanguage',
        title: i18n.t('shell.commandPalette.changeLanguageTitle'),
        description: i18n.t('shell.commandPalette.changeLanguageDescription'),
        category: i18n.t('language.label'),
        icon: Globe,
        execute: () => setLanguageMenuOpenSeq((value) => value + 1),
      });
    }

    list.push(
      {
        id: 'redeven.env.reconnect',
        title: i18n.t('shell.commandPalette.reconnectTitle'),
        description: i18n.t('shell.commandPalette.reconnectDescription'),
        category: environmentCategory,
        keybind: 'mod+shift+r',
        icon: Refresh,
        execute: () => {
          void triggerReconnect();
        },
      },
      {
        id: 'redeven.env.copyEnvId',
        title: i18n.t('shell.commandPalette.copyEnvIdTitle'),
        description: i18n.t('shell.commandPalette.copyEnvIdDescription'),
        category: environmentCategory,
        icon: Copy,
        execute: async () => {
          const id = envId() || '';
          if (!id) {
            notify.error(i18n.t('shell.notifications.copyFailedTitle'), i18n.t('shell.notifications.missingEnvironmentId'));
            return;
          }

          try {
            await navigator.clipboard.writeText(id);
            notify.success(i18n.t('shell.notifications.copiedTitle'), i18n.t('shell.notifications.environmentIdCopied'));
          } catch {
            notify.error(i18n.t('shell.notifications.copyFailedTitle'), i18n.t('shell.notifications.clipboardPermissionDenied'));
          }
        },
      },
      {
        id: 'redeven.env.toggleTheme',
        title: i18n.t('shell.themePicker.openLabel'),
        description: i18n.t('shell.themePicker.commandDescription'),
        category: i18n.t('shell.commandPalette.categories.view'),
        keybind: 'mod+shift+l',
        icon: Highlighter,
        execute: () => setThemeMenuOpenSeq((value) => value + 1),
      },
      {
        id: 'redeven.env.savePreviewFile',
        title: i18n.t('shell.commandPalette.savePreviewFileTitle'),
        description: i18n.t('shell.commandPalette.savePreviewFileDescription'),
        category: i18n.t('shell.commandPalette.categories.filePreview'),
        keybind: 'mod+s',
        icon: Files,
        execute: () => {
          void filePreviewController.saveCurrent();
        },
      },
      {
        id: 'redeven.env.toggleNotesOverlay',
        title: i18n.t('shell.commandPalette.toggleNotesOverlayTitle'),
        description: i18n.t('shell.commandPalette.toggleNotesOverlayDescription'),
        category: generalCategory,
        keybind: NOTES_OVERLAY_KEYBIND,
        allowWhileTyping: true,
        icon: NotesOverlayIcon,
        execute: () => (notesOverlayOpen() ? closeNotesOverlay() : openNotesOverlay()),
      },
      {
        id: 'redeven.env.openCommandPalette',
        title: i18n.t('shell.commandPalette.openCommandPaletteTitle'),
        description: i18n.t('shell.commandPalette.openCommandPaletteDescription'),
        category: generalCategory,
        keybind: 'mod+k',
        icon: Search,
        execute: () => cmd.open(),
      },
    );

    if (canViewAudit()) {
      list.push({
        id: 'redeven.env.openAuditLog',
        title: i18n.t('shell.commandPalette.openAuditLogTitle'),
        description: i18n.t('shell.commandPalette.openAuditLogDescription'),
        category: environmentCategory,
        icon: Activity,
        execute: () => setAuditOpen(true),
      });
    }

    const unregister = cmd.registerAll(list as any);
    onCleanup(() => unregister());
  });

  const accessGateTitle = createMemo(() => {
    switch (accessGatePhase()) {
      case 'checking':
        return i18n.t('accessGate.checkingTitle');
      case 'resuming':
        return i18n.t('accessGate.resumingTitle');
      case 'resume_blocked':
        return i18n.t('accessGate.resumeBlockedTitle');
      case 'unlock_required':
        return isLocalMode() ? i18n.t('accessGate.unlockLocalRuntimeTitle') : i18n.t('accessGate.unlockRuntimeTitle');
      default:
        return isLocalMode() ? i18n.t('accessGate.localRuntimeTitle') : i18n.t('accessGate.environmentTitle');
    }
  });
  const accessGateDescription = createMemo(() => {
    switch (accessGatePhase()) {
      case 'checking':
        return i18n.t('accessGate.checkingDescription');
      case 'resuming':
        return i18n.t('accessGate.resumingDescription');
      case 'resume_blocked':
        return i18n.t('accessGate.resumeBlockedDescription');
      case 'unlock_required':
        return isLocalMode() ? i18n.t('accessGate.unlockLocalDescription') : i18n.t('accessGate.unlockRemoteDescription');
      default:
        return i18n.t('accessGate.readyDescription');
    }
  });
  const accessGateCheckingLabel = createMemo(() => i18n.t('accessGate.checkingLabel'));
  const accessGateResumeHint = createMemo(() => i18n.t('accessGate.resumeHint'));
  const accessGatePasswordLabel = createMemo(() => i18n.t('accessGate.passwordLabel'));
  const accessGatePasswordHelp = createMemo(() => {
    const base = isLocalMode()
      ? i18n.t('accessGate.localPasswordHelp')
      : i18n.t('accessGate.remotePasswordHelp');
    if (accessRetryActive()) {
      return i18n.t('accessGate.retryPasswordHelp', {
        base,
        duration: accessRetryDuration(),
      });
    }
    return base;
  });
  const accessGateUnlockLabel = createMemo(() => {
    if (accessUnlocking()) return i18n.t('accessGate.unlockingAction');
    if (accessRetryActive()) {
      return i18n.t('accessGate.retryInAction', { duration: accessRetryDuration() });
    }
    return i18n.t('accessGate.unlockAction');
  });
  const accessGateRegionDescribedBy = createMemo(() => {
    const ids: string[] = [ACCESS_GATE_IDS.description, ACCESS_GATE_IDS.notice];
    if (accessGatePhase() === 'resuming' || accessGatePhase() === 'resume_blocked') {
      ids.push(ACCESS_GATE_IDS.resumeHint);
    }
    if (accessError()) {
      ids.push(ACCESS_GATE_IDS.error);
    }
    return ids.join(' ');
  });
  const accessGatePasswordDescribedBy = createMemo(() => {
    const ids: string[] = [ACCESS_GATE_IDS.passwordHelp];
    if (accessError()) {
      ids.push(ACCESS_GATE_IDS.error);
    }
    return ids.join(' ');
  });

  const accessGatePanel = () => (
    <div class="flex h-full min-h-0 items-center justify-center bg-background px-4 py-6">
      <Panel class="w-full max-w-md border-border shadow-sm">
        <PanelContent class="p-6">
          <section
            class="flex flex-col gap-4"
            aria-labelledby={ACCESS_GATE_IDS.title}
            aria-describedby={accessGateRegionDescribedBy()}
            aria-busy={accessPending() || accessUnlocking() || accessRecoveryBusy()}
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 space-y-2">
                <h1 id={ACCESS_GATE_IDS.title} class="text-lg font-semibold text-foreground">{accessGateTitle()}</h1>
                <p id={ACCESS_GATE_IDS.description} class="text-sm leading-6 text-muted-foreground">{accessGateDescription()}</p>
              </div>
              <LanguagePreferenceMenu
                variant="access_gate"
                openRequestSeq={languageMenuOpenSeq}
                notify={notify}
                class="shrink-0"
              />
            </div>

            <Show when={accessGatePhase() === 'unlock_required'}>
              <form class="flex flex-col gap-3" onSubmit={(event) => void submitAccessUnlock(event)}>
                <div class="space-y-2">
                  <label for={ACCESS_GATE_IDS.passwordInput} class="text-sm font-medium text-foreground">
                    {accessGatePasswordLabel()}
                  </label>
                  <input
                    ref={accessPasswordInput}
                    id={ACCESS_GATE_IDS.passwordInput}
                    type="password"
                    autocomplete="current-password"
                    placeholder={i18n.t('accessGate.passwordPlaceholder')}
                    value={accessPassword()}
                    onInput={(event) => setCurrentAccessPassword(event.currentTarget.value)}
                    disabled={accessPending() || accessUnlocking()}
                    aria-describedby={accessGatePasswordDescribedBy()}
                    aria-invalid={!!accessError()}
                    class="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-[border,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <p id={ACCESS_GATE_IDS.passwordHelp} class="text-xs leading-5 text-muted-foreground">
                    {accessGatePasswordHelp()}
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={accessPending() || accessUnlocking() || accessRetryActive() || !accessPassword()}
                  class="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {accessGateUnlockLabel()}
                </button>
              </form>
            </Show>

            <Show when={accessGatePhase() === 'checking'}>
              <div class="text-sm text-muted-foreground">{accessGateCheckingLabel()}</div>
            </Show>

            <Show when={accessGatePhase() === 'resuming' || accessGatePhase() === 'resume_blocked'}>
              <>
                <div
                  id={ACCESS_GATE_IDS.resumeHint}
                  class="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
                >
                  {accessGateResumeHint()}
                </div>
                <div class="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={accessRecoveryBusy() || accessUnlocking()}
                    onClick={() => void retryAccessConnection()}
                    class="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {accessRecoveryBusy() ? i18n.t('accessGate.preparingSecureSessionAction') : i18n.t('accessGate.retryConnectionAction')}
                  </button>
                  <button
                    type="button"
                    onClick={reloadAccessPage}
                    class="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    {i18n.t('accessGate.reloadPageAction')}
                  </button>
                </div>
              </>
            </Show>

            <Show when={accessError()}>
              <div
                id={ACCESS_GATE_IDS.error}
                role="alert"
                class="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
              >
                {accessError()}
              </div>
            </Show>

            <div
              id={ACCESS_GATE_IDS.notice}
              class="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
            >
              {i18n.t('accessGate.notice')}
            </div>
          </section>
        </PanelContent>
      </Panel>
    </div>
  );

  const filePreviewContextValue = {
    controller: filePreviewController,
    openPreview: async (item: FileItem, options?: FilePreviewOpenOptions) => openFilePreview(item, options),
    closePreview: filePreviewController.closePreview,
  } as const;
  const fileBrowserSurfaceContextValue = {
    controller: fileBrowserSurfaceController,
    openBrowser: async (params: {
      path: string;
      homePath?: string;
      title?: string;
      persistenceKey?: string;
      stateScope?: string;
    }) => {
      if (!layout.isMobile() && viewMode() === 'workbench') {
        await openFileBrowserAtPath(params.path, {
          homePath: params.homePath,
          title: params.title,
          openStrategy: 'create_new',
        });
        return;
      }
      setFileBrowserSurfaceHostRequested(true);
      await openFileBrowserSurface({
        input: params,
        controller: fileBrowserSurfaceController,
      });
    },
    closeBrowser: fileBrowserSurfaceController.closeSurface,
  } as const;

  const ShellLogo = () => (
    <TopBarBrandButton
      label={i18n.t('shell.topbar.backToDashboard')}
      tooltip={topBarTooltip(i18n.t('shell.topbar.backToDashboard'))}
      onClick={() => {
        void openDashboard();
      }}
    >
      <img
        src={headerLogoSrc()}
        alt="Redeven"
        class="h-6 w-6 object-contain"
        data-redeven-logo-theme={theme.resolvedTheme()}
      />
    </TopBarBrandButton>
  );

  const HeaderActions = () => (
    <div class="flex items-center gap-1">
      <Show when={!layout.isMobile()}>
        <EnvDisplayModeSwitcher
          mode={viewModeSelection.visual()}
          onChange={(mode) => viewModeSelection.request(mode, {
            surfaceId: activeSurface(),
            focusSurface: mode !== 'activity',
          })}
        />
      </Show>
      <TopBarIconButton
        label={i18n.t('shell.topbar.notesOverlay')}
        tooltip={topBarTooltip(i18n.t('shell.topbar.notesOverlayWithShortcut', { shortcut: notesOverlayShortcutLabel() }))}
        onClick={toggleNotesOverlay}
      >
        <NotesOverlayIcon class="w-4 h-4" />
      </TopBarIconButton>
      <DownloadTaskButton tooltip={topBarTooltip(i18n.t('shell.topbar.downloads'))} />
      <Show when={!accessGateVisible()}>
        <LanguagePreferenceMenu
          variant="topbar"
          openRequestSeq={languageMenuOpenSeq}
          notify={notify}
        />
      </Show>
      <EnvAppThemePicker
        openRequestSeq={themeMenuOpenSeq}
        tooltip={topBarTooltip(i18n.t('shell.themePicker.openLabel'))}
        onSourceChange={setThemeSourceWithRenderBoundary}
        onShellThemeChange={setShellThemeWithRenderBoundary}
      />
    </div>
  );

  const renderNotesOverlay = () => (
    <NotesOverlay
      open={notesOverlayOpen()}
      onClose={closeNotesOverlay}
      viewportHosts={notesViewportHosts()}
      toggleKeybind={NOTES_OVERLAY_KEYBIND}
    />
  );

  const dismissNetworkExposureWarning = () => {
    setNetworkExposureWarningDismissed(true);
  };

  const permanentlySuppressNetworkExposureWarning = () => {
    suppressNetworkExposureWarning();
    setNetworkExposureWarningSuppressed(true);
    setNetworkSecurityDetailsOpen(false);
  };

  const renderNetworkExposureWarning = () => (
    <Show when={networkExposureWarningVisible()}>
      <div
        class="min-h-11 shrink-0 border-b border-warning/30 bg-warning/10 text-warning-foreground transition-colors duration-150"
        role="status"
        data-testid="network-exposure-warning"
        data-redeven-desktop-window-titlebar="true"
        data-redeven-desktop-titlebar-drag-region="true"
      >
        <div
          class="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:flex-nowrap sm:px-4"
          data-redeven-desktop-window-titlebar-content="true"
        >
          <AlertTriangle class="h-4 w-4 shrink-0 text-warning" />
          <div class="min-w-0 flex-[1_1_16rem] text-xs sm:flex sm:items-baseline sm:gap-2">
            <div class="font-semibold text-foreground">{i18n.t('networkExposure.title')}</div>
            <div class="mt-0.5 text-muted-foreground sm:mt-0">{i18n.t('networkExposure.summary')}</div>
          </div>
          <div
            class="ml-auto flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto sm:flex-nowrap"
            data-redeven-desktop-titlebar-no-drag="true"
          >
            <Button size="xs" variant="outline" class="shrink-0 border-warning/30 bg-background/80 text-foreground hover:bg-background" onClick={() => setNetworkSecurityDetailsOpen(true)}>
              {i18n.t('networkExposure.viewDetails')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              class="shrink-0 text-muted-foreground hover:text-foreground"
              data-testid="network-exposure-dont-remind"
              onClick={permanentlySuppressNetworkExposureWarning}
            >
              {i18n.t('networkExposure.dontRemindAgain')}
            </Button>
            <Tooltip content={i18n.t('networkExposure.dismissWarning')} placement="bottom" delay={0}>
              <Button
                size="icon"
                variant="ghost"
                class="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={i18n.t('networkExposure.dismissWarning')}
                data-testid="network-exposure-dismiss"
                onClick={dismissNetworkExposureWarning}
              >
                <X class="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>
    </Show>
  );

  const renderNetworkSecurityDetails = () => (
    <Dialog
      open={networkSecurityDetailsOpen()}
      onOpenChange={setNetworkSecurityDetailsOpen}
      title={i18n.t('networkExposure.detailsTitle')}
      description={i18n.t('networkExposure.detailsDescription')}
      class="redeven-network-security-details sm:max-w-lg"
      footer={(
        <Button size="sm" variant="outline" onClick={() => setNetworkSecurityDetailsOpen(false)}>
          {i18n.t('networkExposure.close')}
        </Button>
      )}
    >
      <div class="space-y-4 text-xs">
        <dl class="grid grid-cols-[minmax(7rem,0.55fr)_minmax(0,1.45fr)] gap-x-4 gap-y-3">
          <dt class="text-muted-foreground">{i18n.t('networkExposure.accessURLs')}</dt>
          <dd class="space-y-1 font-mono text-foreground">
            <Show when={networkExposureURLs().length > 0} fallback={<span>{window.location.origin}/</span>}>
              {networkExposureURLs().map((url) => <div class="break-all">{url}</div>)}
            </Show>
          </dd>
          <dt class="text-muted-foreground">{i18n.t('networkExposure.transport')}</dt>
          <dd class="text-foreground">{i18n.t('networkExposure.httpNoTLS')}</dd>
          <dt class="text-muted-foreground">{i18n.t('networkExposure.authentication')}</dt>
          <dd class="flex items-center gap-1.5 text-foreground"><Shield class="h-3.5 w-3.5 text-success" />{i18n.t('networkExposure.passwordEnabled')}</dd>
        </dl>
        <div class="border-t border-border pt-4 leading-5 text-muted-foreground">
          {i18n.t('networkExposure.securityBoundary')}
        </div>
      </div>
    </Dialog>
  );

  const recordActivitySelectionEvent = createUIPresentationEventRecorder<string, EnvActivitySelectionMetadata>({
    surface: 'activity',
    source: (event) => event.metadata?.source ?? 'activity-bar',
  });
  const handleActivitySelectionEvent = (event: UIFirstSelectionEvent<string, EnvActivitySelectionMetadata>) => {
    if (event.phase === 'requested' && event.value === 'terminal') {
      void preloadTerminalFeatureResources({ reason: 'intent' }).catch(() => undefined);
    }
    recordActivitySelectionEvent(event);
  };

  const activityFlowerHeaderActions = () => (
    <Show when={activityFlowerPlacement() === 'expanded'}>
      <Tooltip content={i18n.t('shell.flowerCompanion.collapse')} placement="top" delay={0}>
        <button
          type="button"
          class="flower-activity-companion-icon-button"
          aria-label={i18n.t('shell.flowerCompanion.collapse')}
          onClick={() => collapseActivityFlowerCompanion()}
        >
          <X class="h-4 w-4" />
        </button>
      </Tooltip>
    </Show>
  );

  const renderActivityFlowerCompanion = () => (
    <Show when={activityFlowerMountRequested() && activityFlowerOverlayHost()}>
      <Portal mount={activityFlowerMountHost() ?? undefined} ref={setActivityFlowerMountContainer}>
        <div
          ref={activityFlowerPanelRef}
          id="redeven-activity-flower-companion"
          class="flower-activity-companion-shell"
          classList={{
            'flower-activity-companion-collapsed': !activityFlowerSurfaceVisible(),
            'flower-activity-companion-expanded': activityFlowerPlacement() === 'expanded',
            'flower-activity-companion-full-page': activityFlowerPlacement() === 'full_page',
          }}
          data-presentation={activityFlowerPlacement()}
          role="region"
          aria-label={i18n.t('shell.nav.flower')}
          aria-hidden={!activityFlowerSurfaceVisible() ? 'true' : undefined}
          inert={!activityFlowerSurfaceVisible()}
          style={activityFlowerPlacement() === 'expanded' ? activityFlowerFrameStyle() : {}}
        >
          <EnvAIPage
            presentation={activityFlowerPlacement() === 'full_page' ? 'full' : 'companion'}
            engaged={activityFlowerEngaged()}
            transcriptVisible={activityFlowerEngaged()}
            companionPresenceOwner={!accessGateVisible()}
            focusRequestScope="activity"
            focusThreadRequest={activityFlowerSurfaceVisible() ? activityFlowerFocusRequest() : null}
            focusComposerRequest={activityFlowerSurfaceVisible() ? activityFlowerComposerFocusRequest() : 0}
            composerHandoffRequest={activityFlowerSurfaceVisible() ? activityFlowerComposerHandoffRequest() : null}
            onFocusThreadRequestConsumed={consumeActivityFlowerFocusRequest}
            onComposerHandoffConsumed={consumeActivityFlowerComposerHandoff}
            companionCopy={activityFlowerCompanionCopy()}
            headerTrailingActions={activityFlowerHeaderActions()}
            onPresenceChange={setActivityFlowerPresence}
            settingsReturnSurfaceId={lastActivitySurface() === 'ai' ? ENV_DEFAULT_SURFACE_ID : lastActivitySurface()}
          />
        </div>
      </Portal>
    </Show>
  );

  const ActivityFlowerMountOwner = () => {
    createEffect(() => {
      if (canUseFlower()) setActivityFlowerMountRequested(true);
    });
    return renderActivityFlowerCompanion();
  };

  const renderActivityFlowerQuickEntry = () => (
    <Tooltip content={`${i18n.t('shell.nav.flower')} · ${activityFlowerPresenceSummary() || activityFlowerStatusLabel()}`} placement="top" delay={0}>
      <div
        ref={activityFlowerBottomBarAnchorRef}
        class="flower-activity-quick-entry"
        classList={{ 'flower-activity-quick-entry-active': activityFlowerExpanded() }}
        data-activity-flower-quick-entry
      >
        <FlowerNavigationIcon
          class={`flower-activity-quick-entry-icon h-3.5 w-3.5 shrink-0 ${
            activityFlowerPresence().running_count > 0 ? 'flower-activity-quick-entry-icon-running' : ''
          }`}
        />
        <span
          class={`flower-activity-quick-entry-status flower-activity-quick-entry-status-${activityFlowerPresence().priority_status}`}
          aria-hidden="true"
        />
        <div class="flower-activity-quick-entry-content">
          <input
            ref={activityFlowerQuickInputRef}
            type="text"
            inputmode="text"
            autocomplete="off"
            class="flower-activity-quick-entry-input"
            value={activityFlowerQuickDraft()}
            readOnly={Boolean(activityFlowerComposerHandoffRequest())}
            aria-busy={activityFlowerComposerHandoffRequest() ? 'true' : undefined}
            placeholder={activityFlowerCollapsedPresenceVisible() ? '' : i18n.t('shell.flowerCompanion.quickEntryPlaceholder')}
            aria-label={i18n.t('shell.flowerCompanion.quickEntryLabel')}
            aria-description={activityFlowerPresenceSummary() || activityFlowerStatusLabel()}
            aria-controls="redeven-activity-flower-companion"
            aria-expanded={activityFlowerExpanded()}
            onClick={() => {
              if (!trimString(activityFlowerQuickDraft())) focusActivityFlowerComposer();
            }}
            onInput={(event) => {
              const value = event.currentTarget.value;
              if (!event.isComposing && activityFlowerCompositionCommit && value === activityFlowerCompositionCommit) {
                activityFlowerCompositionCommit = '';
                return;
              }
              if (!event.isComposing) activityFlowerCompositionCommit = '';
              setActivityFlowerQuickDraft(value);
              if (!event.isComposing && trimString(value)) openActivityFlowerCompanion();
            }}
            onCompositionStart={() => {
              setActivityFlowerComposing(true);
              activityFlowerCompositionCommit = '';
            }}
            onCompositionEnd={(event) => {
              setActivityFlowerComposing(false);
              const value = event.currentTarget.value;
              activityFlowerCompositionCommit = value;
              setActivityFlowerQuickDraft(value);
              if (trimString(value)) openActivityFlowerCompanion();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
              if (!trimString(event.currentTarget.value)) {
                event.preventDefault();
                focusActivityFlowerComposer();
              }
            }}
          />
          <Show when={activityFlowerCollapsedPresenceVisible()}>
            <span
              class="flower-activity-quick-entry-presence-summary"
              data-activity-flower-presence-summary
              aria-hidden="true"
            >
              {activityFlowerPresenceSummary()}
            </span>
          </Show>
        </div>
        <span
          class="sr-only"
          data-activity-flower-presence-announcement
          aria-live="polite"
          aria-atomic="true"
        >
          {activityFlowerPresenceSummary() || activityFlowerStatusLabel()}
        </span>
      </div>
    </Tooltip>
  );

  const renderActivityShell = () => (
    <Shell
      class="!h-full"
      activitySelectionMode="ui-first"
      onActivitySelectionEvent={handleActivitySelectionEvent}
      sidebarMode="auto"
      slotClassNames={{
        sidebar: layout.sidebarVisibilityMotion() === 'instant' ? 'transition-none' : undefined,
        bottomBarHeight: canUseFlower() ? 'flower-activity-bottom-bar-height' : undefined,
      }}
      resolveSidebarVisibilityMotion={({ currentActiveId, nextActiveId, isMobile }) => (
        resolveEnvSidebarVisibilityMotion({
          currentTab: currentActiveId,
          nextTab: nextActiveId,
          isMobile,
        })
      )}
      sidebarContent={(activeTab) =>
        activeTab === 'codex' && canUseCodex()
            ? <CodexActivitySidebarHost onHostChange={setCodexSidebarHost} />
            : <></>
      }
      logo={<ShellLogo />}
      activityItems={activityItems()}
      activityBottomItems={activityBottomItems()}
      topBarActions={<HeaderActions />}
      bottomBarItems={canUseFlower() ? (
        <div
          class="flower-activity-bottom-grid"
          style={`--flower-visual-viewport-bottom-offset:${activityFlowerVisualViewportBottomOffset()}px`}
          data-activity-flower-bottom-bar
        >
          <div class="flower-activity-bottom-side flower-activity-bottom-side-start">
            <div class="flower-activity-env-identity">
              <span class={`shrink-0 w-3.5 h-3.5 flex items-center justify-center ${
                envSessionIdentity().source === 'local_runtime' ? 'text-primary' :
                envSessionIdentity().source === 'ssh_environment' ? 'text-info' :
                'text-accent'
              }`}>
                {envSessionIdentity().source === 'ssh_environment' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                ) : envSessionIdentity().source !== 'local_runtime' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                )}
              </span>
              <span class="truncate text-[11px] font-medium text-foreground">{envSessionIdentity().displayName}</span>
              <span class="flower-activity-env-secondary w-px h-3.5 bg-border shrink-0" />
              <span class="flower-activity-env-secondary truncate text-[11px] text-muted-foreground">
                {envSessionIdentity().displayID || i18n.t('shell.status.missingEnvId')}
              </span>
            </div>
            <span class={`flower-activity-env-type text-[10px] px-1.5 py-0.5 rounded-full font-semibold leading-tight shrink-0 whitespace-nowrap ${
              envSessionIdentity().source === 'local_runtime' ? 'bg-primary/10 text-primary' :
              envSessionIdentity().source === 'ssh_environment' ? 'bg-info/10 text-info' :
              'bg-accent/10 text-accent'
            }`}>
              {envTypeLabel()}
            </span>
          </div>

          {renderActivityFlowerQuickEntry()}

          <div class="flower-activity-bottom-side flower-activity-bottom-side-end">
            <StatusIndicator status={status()} label={statusLabel()} />
            <Tooltip content={canViewAudit() ? i18n.t('shell.status.auditLog') : i18n.t('shell.status.adminRequired')} placement="top" delay={0}>
              <BottomBarItem
                onClick={canViewAudit() ? () => setAuditOpen(true) : undefined}
                class={`flower-activity-secondary-action ${canViewAudit() ? '' : 'opacity-40 pointer-events-none'}`}
              >
                {i18n.t('shell.status.auditLog')}
              </BottomBarItem>
            </Tooltip>
            <BottomBarItem
              onClick={reconnectDisabled() ? undefined : () => void triggerReconnect()}
              class={`flower-activity-secondary-action ${reconnectDisabled() ? 'opacity-40 pointer-events-none' : 'bg-primary/15'}`}
            >
              <span class="text-primary">{reconnectLabel()}</span>
            </BottomBarItem>
          </div>
        </div>
      ) : undefined}
    >
      <div class="h-full min-h-0 overflow-hidden flex flex-col">
        <div
          ref={setActivityNotesViewportAnchor}
          class="flex-1 min-h-0 overflow-hidden relative outline-none"
          tabindex={-1}
        >
          <div
            class={`h-full min-h-0 ${recoveryVisible() ? 'pointer-events-none' : ''}`}
            inert={recoveryVisible()}
            aria-hidden={recoveryVisible() ? 'true' : undefined}
          >
            <Show when={!accessGateVisible() || recoveryVisible()}>
              <ActivityAppsMain activeId={() => layout.sidebarActiveTab()} activationMode="after-paint" />
            </Show>
            <Show when={accessGateVisible() && !recoveryVisible()}>
              {accessGatePanel()}
            </Show>
          </div>
          <Show when={recoveryVisible()}>
            <ConnectionRecoveryView
              snapshot={recoverySnapshot()}
              environmentName={envSessionIdentity().displayName}
              onRetry={() => reconnectController.requestImmediateRetry()}
            />
          </Show>
        </div>
        <ActivityFlowerMountOwner />
      </div>

      <Show when={auditOpen()}>
        <AuditLogDialog open envId={envId()} onClose={() => setAuditOpen(false)} />
      </Show>
      <Show when={fileBrowserSurfaceHostRequested()}>
        <FileBrowserSurfaceHost />
      </Show>
      <Show when={__REDEVEN_PLUGIN_UI_ENABLED__ && pluginsPanelOpen()}>
        <PluginPanel
          open
          model={pluginPanelModel()}
          onClose={() => setPluginsPanelOpen(false)}
          onOpenCenter={() => openPluginCenter()}
          onOpenPluginDetails={(pluginID) => openPluginCenter(pluginID)}
          onOpenPluginSurface={(target) => void openPluginSurface(target)}
        />
      </Show>
      <Show when={debugConsoleMountRequested()}>
        <DebugConsoleWindow controller={debugConsole} />
      </Show>
    </Shell>
  );

  const renderWorkbenchContent = () => (
    <div ref={setWorkbenchNotesViewportAnchor} class="relative h-full min-h-0 overflow-hidden outline-none" tabindex={-1}>
      <div
        class={`h-full min-h-0 ${recoveryVisible() ? 'pointer-events-none' : ''}`}
        inert={recoveryVisible()}
        aria-hidden={recoveryVisible() ? 'true' : undefined}
      >
        <Show when={!accessGateVisible() || recoveryVisible()}>
          <EnvWorkbenchPage />
        </Show>
        <Show when={accessGateVisible() && !recoveryVisible()}>
          {accessGatePanel()}
        </Show>
      </div>
      <Show when={recoveryVisible()}>
        <ConnectionRecoveryView
          snapshot={recoverySnapshot()}
          environmentName={envSessionIdentity().displayName}
          onRetry={() => reconnectController.requestImmediateRetry()}
        />
      </Show>
    </div>
  );

  const renderMainShell = () => (
    <>
      <div class="flex h-screen min-h-0 flex-col">
        {renderNetworkExposureWarning()}
        <KeepAliveStack
          class="redeven-env-shell-stage min-h-0 flex-1"
          activeId={viewMode()}
          activationMode="after-paint"
          views={[
            { id: 'activity', render: renderActivityShell },
            {
              id: 'workbench',
              render: () => (
                <DisplayModePageShell logo={<ShellLogo />} actions={<HeaderActions />}>
                  {renderWorkbenchContent()}
                </DisplayModePageShell>
              ),
            },
          ]}
        />
      </div>
      <Show when={layout.isMobile() && viewMode() === 'activity' && canUseFlower()}>
        <div
          class="flower-activity-mobile-quick-entry-rail"
          classList={{ 'flower-activity-mobile-quick-entry-rail-ready': Boolean(activityFlowerMobileRailStyle().width) }}
          style={activityFlowerMobileRailStyle()}
          data-activity-flower-mobile-quick-entry
        >
          {renderActivityFlowerQuickEntry()}
        </div>
      </Show>
      <div ref={setActivityFlowerOverlayHost} class="flower-activity-overlay-host" data-activity-flower-overlay-host />
      {renderNotesOverlay()}
      {renderNetworkSecurityDetails()}
    </>
  );

  return (
    <EnvContext.Provider
      value={{
        env_id: envId,
        env,
        localRuntime,
        connect,
        connecting,
        viewMode,
        setViewMode,
        activeSurface,
        lastActivitySurface,
        openSurface,
        goActivity: (surfaceId) => openSurface(surfaceId, { reason: 'direct_navigation', focus: true, ensureVisible: true }),
        workbenchSurfaceActivationSeq,
        workbenchSurfaceActivation,
        consumeWorkbenchSurfaceActivation,
        workbenchOverviewEntrySeq,
        workbenchOverviewEntry,
        consumeWorkbenchOverviewEntry,
        workbenchFilePreviewActivationSeq,
        workbenchFilePreviewActivation,
        consumeWorkbenchFilePreviewActivation,
        filesSidebarOpen: filesMobileSidebarOpen,
        setFilesSidebarOpen: setFilesMobileSidebarOpen,
        toggleFilesSidebar: toggleFilesMobileSidebar,
        settingsSeq,
        bumpSettingsSeq,
        openSettings,
        settingsOrigin,
        returnFromSettingsOrigin,
        debugConsoleEnabled: debugConsole.enabled,
        setDebugConsoleEnabled,
        openDebugConsole,
        settingsFocusSeq,
        settingsFocusSection,
        openFlowerTurnLauncher,
        openTerminalInDirectoryRequestSeq,
        openTerminalInDirectoryRequest,
        openTerminalInDirectory,
        openFileBrowserAtPath,
        openFilePreview,
        openFlowerFileBrowser,
        openFlowerFilePreview,
        openFlowerCanonicalReferenceTarget,
        openFlowerLinkedFilePreview,
        openFlowerLinkedDirectoryBrowser,
        consumeOpenTerminalInDirectoryRequest,
        aiThreadFocusRequest,
        focusAIThread,
        consumeAIThreadFocusRequest,
      }}
    >
      <TerminalSessionCatalogProvider>
        <DownloadContext.Provider value={downloadManager}>
        <FileBrowserSurfaceContext.Provider value={fileBrowserSurfaceContextValue}>
          <FilePreviewContext.Provider value={filePreviewContextValue}>
            <RuntimeUpdateContext.Provider
              value={{
                version: agentVersionModel,
                maintenance: agentMaintenanceController,
                maintenanceContext: runtimeMaintenanceContext,
                refetchMaintenanceContext: refetchRuntimeMaintenanceContext,
              }}
            >
              <FloeRegistryRuntime components={components()}>
                {renderMainShell()}
                  <Show when={viewMode() !== 'workbench' && filePreviewHostRequested()}>
                    <FilePreviewHost />
                  </Show>
                  <Show when={flowerTurnLauncherOpen()}>
                    <FlowerTurnLauncherWindow
                      open
                      intent={flowerTurnLauncherIntent()}
                      anchor={flowerTurnLauncherAnchor()}
                      onClose={closeFlowerTurnLauncher}
                      onSubmit={submitFlowerTurnLauncher}
                    />
                  </Show>
              </FloeRegistryRuntime>
            </RuntimeUpdateContext.Provider>
          </FilePreviewContext.Provider>
        </FileBrowserSurfaceContext.Provider>
        </DownloadContext.Provider>
      </TerminalSessionCatalogProvider>
    </EnvContext.Provider>
  );
}
