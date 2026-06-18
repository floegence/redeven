import { Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { deferAfterPaint, type FloeComponent, useCommand, useDeck, useLayout, useNotification, useTheme, useWidgetRegistry } from '@floegence/floe-webapp-core';
import { ActivityAppsMain, FloeRegistryRuntime } from '@floegence/floe-webapp-core/app';
import { NotesOverlayIcon } from '@floegence/floe-webapp-core/notes';
import {
  Activity,
  Code,
  Copy,
  Files,
  Globe,
  Grid3x3,
  LayoutDashboard,
  Moon,
  Refresh,
  Search,
  Settings,
  Sun,
  Terminal,
} from '@floegence/floe-webapp-core/icons';
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
  DisplayModeSwitcher,
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
  createArtifactSourceFromFactory,
  createProxyRuntimeTunnelReconnectConfig,
} from '@floegence/floe-webapp-boot';
import type { ClientObserverLike } from '@floegence/flowersec-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import {
  EnvContext,
  type EnvDeckSurfaceActivationRequest,
  type EnvSettingsOrigin,
  type EnvSettingsSection,
  type EnvWorkbenchOverviewEntryRequest,
  type EnvWorkbenchFilePreviewActivationRequest,
  type EnvWorkbenchSurfaceActivationRequest,
  type OpenTerminalInDirectoryRequest,
} from './pages/EnvContext';
import type {
  FlowerThreadFocusRequest,
  FlowerTurnLauncherAnchor,
  FlowerTurnLauncherIntent,
  FlowerTurnLauncherSubmitInput,
} from '../../../../flower_ui/src';
import type { ContextActionExecutionContext } from './contextActions/protocol';
import { EnvDeckPage } from './pages/EnvDeckPage';
import { EnvTerminalPage } from './pages/EnvTerminalPage';
import { EnvMonitorPage } from './pages/EnvMonitorPage';
import { EnvFileBrowserPage } from './pages/EnvFileBrowserPage';
import { EnvCodespacesPage } from './pages/EnvCodespacesPage';
import { EnvPortForwardsPage } from './pages/EnvPortForwardsPage';
import { EnvAIPage } from './pages/EnvAIPage';
import type { ActivityFileActionOpenRequest } from './chat/types';
import { CodexPage } from './codex/CodexPage';
import { CodexProvider } from './codex/CodexProvider';
import { CodexSidebar } from './codex/CodexSidebar';
import { AIChatContext, createAIChatContextValue } from './pages/AIChatContext';
import { EnvSettingsPage } from './pages/EnvSettingsPage';
import { hasRWXPermissions } from './pages/aiPermissions';
import { localizedRedevenDeckWidgets } from './deck/redevenDeckWidgets';
import { useRedevenRpc } from './protocol/redeven_v1';
import { createEnvLocalFlowerSurfaceAdapter } from './flower/envLocalFlowerSurfaceAdapter';
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
import { createDebugConsoleController } from './debugConsole/createDebugConsoleController';
import { DebugConsoleWindow } from './debugConsole/DebugConsoleWindow';
import { AuditLogDialog } from './widgets/AuditLogDialog';
import { FlowerTurnLauncherWindow } from './widgets/FlowerTurnLauncherWindow';
import { TopBarBrandButton } from './TopBarBrandButton';
import { Tooltip } from './primitives/Tooltip';
import { NotesOverlay } from './notes/NotesOverlay';
import { resolveNotesOverlayViewportHosts } from './notes/notesOverlayShellViewport';
import { createFileBrowserSurfaceController } from './widgets/createFileBrowserSurfaceController';
import { createFilePreviewController } from './widgets/createFilePreviewController';
import { FileBrowserSurfaceContext } from './widgets/FileBrowserSurfaceContext';
import { FileBrowserSurfaceHost } from './widgets/FileBrowserSurfaceHost';
import { FilePreviewContext, type FilePreviewOpenOptions } from './widgets/FilePreviewContext';
import { FilePreviewHost } from './widgets/FilePreviewHost';
import { openFileBrowserSurface } from './widgets/openFileBrowserSurface';
import { basenameFromAbsolutePath, normalizeAbsolutePath } from './utils/askFlowerPath';
import { createClientId } from './utils/clientId';
import { fileItemFromPath } from './utils/filePreviewItem';
import { reloadCurrentPage } from './utils/windowNavigation';
import { resolveEnvSidebarVisibilityMotion, shouldEnvTabOpenSidebar } from './envSidebarVisibilityMotion';
import { buildDesktopShellCommandPaletteEntries } from './services/desktopShellCommandPalette';
import {
  desktopShellBridgeAvailable,
  getRuntimeMaintenanceContextFromDesktopShell,
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
import { desktopThemeBridge, toggleDesktopTheme } from './services/desktopTheme';
import { notifyDesktopSessionAppReady, readDesktopSessionContextSnapshot } from './services/desktopSessionContext';
import { controlPlaneOriginFromSandboxLocation } from './services/sandboxOrigins';
import { readUIStorageItem, writeUIStorageItem } from './services/uiStorage';
import { requestWorkbenchRenderTransaction } from './workbench/workbenchRenderBoundary';
import {
  ENV_DEFAULT_SURFACE_ID,
  envWidgetTypeForSurface,
  isEnvSurfaceId,
  normalizePersistedEnvViewMode,
  type EnvOpenSurfaceOptions,
  type EnvSurfaceId,
  type EnvViewMode,
  type EnvWorkbenchHandoffAnchor,
} from './envViewMode';
import { EnvWorkbenchPage } from './workbench/EnvWorkbenchPage';
import { LanguagePreferenceMenu, useI18n } from './i18n';

const ACTIVE_SURFACE_STORAGE_KEY = 'redeven_envapp_active_tab';
const DESKTOP_VIEW_MODE_STORAGE_KEY = 'redeven_envapp_desktop_view_mode';
const ACCESS_RESUME_TIMEOUT_MS = 15_000;
const WORKBENCH_HANDOFF_ANCHOR_MAX_AGE_MS = 1_500;
const NOTES_OVERLAY_KEYBIND = 'mod+.';

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
  const statusCode = Number(candidate?.status ?? candidate?.code ?? 0);
  if (Number.isFinite(statusCode) && statusCode === 401) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('invalid resume token') ||
    message.includes('resume token binding mismatch') ||
    message.includes('missing channel_id or resume_token') ||
    message.includes('channel not found') ||
    message.includes('access password required')
  );
}

function readPersistedDesktopViewMode(): EnvViewMode | null {
  const explicit = String(readUIStorageItem(DESKTOP_VIEW_MODE_STORAGE_KEY) ?? '').trim();
  return normalizePersistedEnvViewMode(explicit);
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

// Bridge: provides AIChatContext to Shell and its children (requires EnvContext above).
function AIChatProviderBridge(props: { children: any }) {
  const ctx = createAIChatContextValue();
  return <AIChatContext.Provider value={ctx}>{props.children}</AIChatContext.Provider>;
}

export function EnvAppShell() {
  const layout = useLayout();
  const theme = useTheme();
  const i18n = useI18n();
  const shellTheme = desktopThemeBridge();
  const toggleThemeWithRenderBoundary = () => {
    requestWorkbenchRenderTransaction('theme');
    toggleDesktopTheme(theme.resolvedTheme(), shellTheme, () => theme.toggleTheme());
  };
  const widgetRegistry = useWidgetRegistry();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const cmd = useCommand();
  const deck = useDeck();
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
  const fileBrowserSurfaceController = createFileBrowserSurfaceController();

  type ProtocolConnectConfig = Parameters<typeof protocol.connect>[0];
  const topBarTooltip = (label: string): string | false => (layout.isMobile() ? false : label);
  const notesOverlayShortcutLabel = createMemo(() => cmd.getKeybindDisplay(NOTES_OVERLAY_KEYBIND));
  const headerLogoSrc = createMemo(() =>
    `${import.meta.env.BASE_URL}${theme.resolvedTheme() === 'dark' ? 'logo-dark.svg' : 'logo.svg'}`,
  );
  widgetRegistry.registerAll(localizedRedevenDeckWidgets(i18n.t));

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
      setLocalAccessStatus({ password_required: true, unlocked: false });
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
    if (isAccessResumeAuthFailure(error) || message.toLowerCase().includes('access password')) {
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
    } catch {
      return { status: 'unknown', access: 'unknown' };
    }
  };

  const probeLocalRuntimeAvailability = async (): Promise<ReconnectAvailability> => {
    const status = await getLocalAccessStatus();
    if (!status) {
      return { status: 'offline', access: 'unknown' };
    }

    if (status.password_required && !status.unlocked) {
      markCurrentAccessLocked(i18n.t('accessGate.passwordExpiredError'));
      return { status: 'online', access: 'locked' };
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
  const [connectionAttemptSeq, setConnectionAttemptSeq] = createSignal(0);
  const [auditOpen, setAuditOpen] = createSignal(false);
  const canViewAudit = createMemo(() => Boolean(env()?.permissions?.can_admin));
  const canAdmin = createMemo(() => Boolean(env()?.permissions?.can_admin || env()?.permissions?.is_owner));
  const controlplaneStatus = createMemo(() => String(env()?.status ?? '').trim());
  const canUseFlower = createMemo(() => !accessGateVisible());
  const canUseCodex = createMemo(() => env.state === 'ready' && hasRWXPermissions(env()));

  const [pendingAutoOpenAI, setPendingAutoOpenAI] = createSignal(false);
  const [pendingAutoOpenCodex, setPendingAutoOpenCodex] = createSignal(false);
  const [desktopViewMode, setDesktopViewMode] = createSignal<EnvViewMode>('deck');
  const viewMode = createMemo<EnvViewMode>(() => (layout.isMobile() ? 'activity' : desktopViewMode()));
  const [lastActivitySurface, setLastActivitySurface] = createSignal<EnvSurfaceId>(ENV_DEFAULT_SURFACE_ID);
  const [lastRequestedSurface, setLastRequestedSurface] = createSignal<EnvSurfaceId>(ENV_DEFAULT_SURFACE_ID);
  const [deckSurfaceActivationSeq, setDeckSurfaceActivationSeq] = createSignal(0);
  const [deckSurfaceActivation, setDeckSurfaceActivation] = createSignal<EnvDeckSurfaceActivationRequest | null>(null);
  const [workbenchSurfaceActivationSeq, setWorkbenchSurfaceActivationSeq] = createSignal(0);
  const [workbenchSurfaceActivation, setWorkbenchSurfaceActivation] = createSignal<EnvWorkbenchSurfaceActivationRequest | null>(null);
  const [workbenchOverviewEntrySeq, setWorkbenchOverviewEntrySeq] = createSignal(0);
  const [workbenchOverviewEntry, setWorkbenchOverviewEntry] = createSignal<EnvWorkbenchOverviewEntryRequest | null>(null);
  const [workbenchFilePreviewActivationSeq, setWorkbenchFilePreviewActivationSeq] = createSignal(0);
  const [workbenchFilePreviewActivation, setWorkbenchFilePreviewActivation] = createSignal<EnvWorkbenchFilePreviewActivationRequest | null>(null);
  const [filesMobileSidebarOpen, setFilesMobileSidebarOpen] = createSignal(false);
  const toggleFilesMobileSidebar = () => setFilesMobileSidebarOpen((open) => !open);
  let initialActivitySurface: EnvSurfaceId | null = null;

  type EnvFlowerTurnHandoffContext = Readonly<{
    mode: EnvViewMode;
    activeSurface: EnvSurfaceId;
    workbenchAnchor?: EnvWorkbenchHandoffAnchor;
  }>;

  const [flowerTurnLauncherOpen, setFlowerTurnLauncherOpen] = createSignal(false);
  const [flowerTurnLauncherIntent, setFlowerTurnLauncherIntent] = createSignal<FlowerTurnLauncherIntent | null>(null);
  const [flowerTurnLauncherAnchor, setFlowerTurnLauncherAnchor] = createSignal<FlowerTurnLauncherAnchor | null>(null);
  const [flowerTurnLauncherHandoff, setFlowerTurnLauncherHandoff] = createSignal<EnvFlowerTurnHandoffContext | null>(null);
  const [notesOverlayOpen, setNotesOverlayOpen] = createSignal(false);
  const [notesViewportAnchor, setNotesViewportAnchor] = createSignal<HTMLElement | null>(null);
  const [notesViewportHosts, setNotesViewportHosts] = createSignal<readonly HTMLElement[]>([]);
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

  const [settingsFocusSeq, setSettingsFocusSeq] = createSignal(0);
  const [settingsFocusSection, setSettingsFocusSection] = createSignal<EnvSettingsSection | null>(null);
  const [settingsOrigin, setSettingsOrigin] = createSignal<EnvSettingsOrigin>(null);
  const [languageMenuOpenSeq, setLanguageMenuOpenSeq] = createSignal(0);
  const [aiThreadFocusRequest, setAIThreadFocusRequest] = createSignal<FlowerThreadFocusRequest | null>(null);
  let aiThreadFocusRequestSequence = 0;
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

  const openDebugConsole = () => {
    debugConsole.show();
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

  const consumeDeckSurfaceActivation = (requestId: string) => {
    const normalizedRequestId = String(requestId ?? '').trim();
    if (!normalizedRequestId) return;

    setDeckSurfaceActivation((current) => {
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

  const openFlowerTurnLauncher = (intent: FlowerTurnLauncherIntent, anchor?: FlowerTurnLauncherAnchor) => {
    if (!canUseFlower()) {
      notify.error(i18n.t('shell.notifications.permissionDeniedTitle'), i18n.t('shell.notifications.rwxPermissionRequired'));
      return;
    }
    const capturedMode = viewMode();
    setFlowerTurnLauncherIntent(withFlowerTurnExecutionContext(intent));
    setFlowerTurnLauncherAnchor(anchor ?? null);
    setFlowerTurnLauncherHandoff({
      mode: capturedMode,
      activeSurface: activeSurface(),
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
        centerViewport: options?.ensureVisible ?? true,
        openStrategy,
      });
      setWorkbenchFilePreviewActivationSeq((n) => n + 1);
      return;
    }

    await filePreviewController.openPreview(normalizedItem);
  };

  const resolveFlowerFileActionPath = async (
    request: ActivityFileActionOpenRequest,
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

  const openFlowerFileBrowser = async (request: ActivityFileActionOpenRequest): Promise<void> => {
    const path = await resolveFlowerFileActionPath(request, 'browse_directory');
    if (!path) return;
    await openFileBrowserAtPath(path, {
      title: 'Flower file context',
      openStrategy: 'focus_latest_or_create',
    });
  };

  const openFlowerFilePreview = async (request: ActivityFileActionOpenRequest): Promise<void> => {
    const path = await resolveFlowerFileActionPath(request, 'preview');
    if (!path) return;
    await openFilePreview(fileItemFromPath(path), {
      focus: true,
      reusePolicy: 'same_file_or_create',
    });
  };

  const closeFlowerTurnLauncher = () => {
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
    focusAIThread(tid);
    const target = context;

    if (target.mode === 'activity' || layout.isMobile()) {
      setViewMode('activity', { surfaceId: 'ai', focusSurface: true });
      openSurface('ai', { reason: 'handoff_ask_flower', focus: true, ensureVisible: true });
      return;
    }

    if (target.mode === 'deck') {
      if (viewMode() !== 'deck') {
        setViewMode('deck', { surfaceId: 'ai', focusSurface: true });
        return;
      }
      openSurface('ai', { reason: 'handoff_ask_flower', focus: true, ensureVisible: true });
      return;
    }

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

    try {
      const adapter = createEnvLocalFlowerSurfaceAdapter({
        envPublicID: trimString(envId()),
        envLabel: trimString(env()?.name) || trimString(envId()) || 'This environment',
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
        uploadAttachment: uploadLocalApiFile,
        openFileBrowser: openFlowerFileBrowser,
        openFilePreview: openFlowerFilePreview,
      });
      const bootstrap = await adapter.launchTurn({
        prompt: trimmedPrompt,
        context_action: input.intent.context_action,
        working_dir: input.intent.suggested_working_dir,
        pending_files: input.intent.pending_attachments,
        mode: 'act',
      });
      const threadId = trimString(bootstrap.thread.thread_id || bootstrap.thread_id);
      const handoffContext = flowerTurnLauncherHandoff();
      if (!threadId) {
        throw new Error(i18n.t('flowerChat.router.missingThreadID'));
      }
      if (!handoffContext) {
        throw new Error(i18n.t('shell.notifications.failedToSendToFlowerTitle'));
      }
      closeFlowerTurnLauncher();
      handoffFlowerTurn(handoffContext, threadId);
    } catch (e) {
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

  const createGetArtifact = () => async (ctx: Readonly<{ traceId?: string; signal?: AbortSignal }> = {}) => {
    const id = envId();
    if (!id) throw new Error('Missing env context. Please reopen from the control plane.');

    // Probe runtime status to avoid grant-audit spam while the runtime is clearly offline.
    let agentStatus: string | null = null;
    try {
      const detail = await getEnvironment({ source: 'controlplane', envId: id });
      // `status` is the only availability source of truth returned by the controlplane API.
      agentStatus = detail?.status ? String(detail.status) : null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Redirecting to the control plane')) throw new Error(msg);
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
      traceId: ctx.traceId,
      signal: ctx.signal,
    });
  };

  const runConnect = async (fn: (config: ProtocolConnectConfig) => Promise<void>) => {
    const protocolStatusValue = String(protocol.status() ?? '').trim();
    if (accessRecoveryBusy() || protocolStatusValue === 'connecting' || accessPending() || accessLocked()) return;

    const id = envId();
    if (!id) {
      setManualError('Missing env context. Please reopen from the control plane.');
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
        setLocalAccessChannelReady(false);
        await fn(createArtifactDirectReconnectConfig({
          artifactSource: createArtifactSourceFromFactory(mintLocalDirectConnectArtifact),
          observer,
          connect: { keepaliveIntervalMs: 15_000 },
          autoReconnect: LOCAL_FAST_RECONNECT_POLICY,
        }));
        if (accessRecoverySeq !== attemptKey) return;
        accessResumeClient = protocol.client();
        setLocalAccessChannelReady(true);
        setCurrentAccessError(null);
        setManualError(null);
      } else {
        await fn(createProxyRuntimeTunnelReconnectConfig({
          artifactSource: createArtifactSourceFromFactory(createGetArtifact()),
          observer,
          autoReconnect: REMOTE_FAST_RECONNECT_POLICY,
        }));
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
    if (reconnectController.phase() === 'waiting_for_runtime') {
      reconnectController.requestReconnectNow();
      return;
    }
    await reconnect();
  };

  const reloadAccessPage = () => {
    reloadCurrentPage(window);
  };

  const reconnectController = createRuntimeReconnectController({
    enabled: () => !accessGateVisible() && connectionAttemptSeq() > 0,
    probeAvailability: () => (isLocalMode() ? probeLocalRuntimeAvailability() : probeRemoteRuntimeAvailability()),
    reconnect,
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

  let lastDesktopReadyState = '';
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
    if (!nextReadyState || nextReadyState === lastDesktopReadyState) {
      return;
    }
    lastDesktopReadyState = nextReadyState;
    notifyDesktopSessionAppReady(nextReadyState);
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

  const reconnectFailure = createMemo(() => reconnectController.failure());
  const connectNotice = createMemo<Readonly<{ title: string; message: string }> | null>(() => {
    if (accessGateVisible()) return null;

    if (reconnectController.phase() === 'waiting_for_runtime') {
      return {
        title: i18n.t('shell.status.waitingForRuntime'),
        message: reconnectFailure()?.message || i18n.t('shell.status.runtimeUnavailableRetrying'),
      };
    }

    const fatalError = manualError();
    if (fatalError) {
      return {
        title: i18n.t('shell.status.connectionFailed'),
        message: fatalError,
      };
    }

    return null;
  });
  const status = createMemo(() => {
    if (accessGatePhase() === 'unlock_required') return 'disconnected';
    if (accessGatePhase() === 'checking' || accessGatePhase() === 'resuming' || accessGatePhase() === 'resume_blocked') {
      return 'connecting';
    }

    switch (reconnectController.phase()) {
      case 'transport_retry':
      case 'waiting_for_runtime':
      case 'reconnecting':
        return 'connecting';
      default:
        break;
    }

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

    switch (reconnectController.phase()) {
      case 'transport_retry':
        return i18n.t('shell.status.retryingConnection');
      case 'waiting_for_runtime':
        if (
          reconnectController.availabilityStatus() === 'offline'
          || reconnectFailure()?.kind === 'runtime_offline'
        ) {
          return i18n.t('shell.status.waitingForRuntime');
        }
        return i18n.t('shell.status.reconnectingSoon');
      case 'reconnecting':
        return i18n.t('shell.status.reconnecting');
      default:
        return undefined;
    }
  });
  const connecting = () => !accessGateVisible() && (protocol.status() === 'connecting' || reconnectController.phase() === 'reconnecting');
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

    if (reconnectController.phase() === 'transport_retry' || reconnectController.phase() === 'reconnecting') {
      return true;
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

    switch (reconnectController.phase()) {
      case 'transport_retry':
      case 'reconnecting':
        return i18n.t('shell.status.reconnectingEllipsis');
      case 'waiting_for_runtime':
        return i18n.t('shell.status.retryNow');
      default:
        return connecting() ? i18n.t('shell.status.connectingEllipsis') : i18n.t('shell.status.reconnect');
    }
  });
  const connectionOverlayVisible = createMemo(() => !accessGateVisible() && protocol.status() !== 'connected');
  const connectionOverlayMessage = createMemo(() => {
    if (agentMaintenanceController.maintaining()) {
      return agentMaintenanceController.stage() || i18n.t('shell.status.runtimeRestarting');
    }

    switch (reconnectController.phase()) {
      case 'transport_retry':
      case 'reconnecting':
        return i18n.t('shell.status.reconnectingToRuntime');
      case 'waiting_for_runtime':
        if (
          reconnectController.availabilityStatus() === 'offline'
          || reconnectFailure()?.kind === 'runtime_offline'
        ) {
          return i18n.t('shell.status.waitingForRuntimeEllipsis');
        }
        return i18n.t('shell.status.tryingRuntimeSoon');
      default:
        return isLocalMode()
          ? i18n.t('shell.status.connectingLocalRuntime')
          : i18n.t('shell.status.connectingRuntime');
    }
  });
  const connectError = createMemo(() => connectNotice()?.message ?? null);

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
        setLocalAccessStatus({ password_required: true, unlocked: true });
        setLocalAccessChecked(true);
        const refreshedRuntime = await refreshLocalRuntime();
        if (refreshedRuntime) {
          setLocalRuntime(refreshedRuntime);
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

  let lastReconnectSignal = '';
  let lastConnectedClient: unknown = null;

  createEffect(() => {
    if (accessGateVisible()) {
      reconnectController.noteBlocked();
      lastReconnectSignal = '';
      lastConnectedClient = null;
      return;
    }

    if (connectionAttemptSeq() <= 0) return;

    const protocolStatusValue = String(protocol.status() ?? '').trim();
    if (!protocolStatusValue) return;
    if (accessRecoveryBusy() && protocolStatusValue === 'disconnected') return;

    const rawFailure = manualError() || protocol.error();
    const failure = classifyReconnectFailure(rawFailure);
    const signal = `${protocolStatusValue}:${failure.kind}:${trimString(failure.message)}`;

    if (protocolStatusValue === 'connected') {
      if (lastConnectedClient !== protocol.client()) {
        lastConnectedClient = protocol.client();
        if (!isLocalMode()) {
          void refetchEnv();
        }
      }
      reconnectController.noteConnected();
      lastReconnectSignal = signal;
      return;
    }

    lastConnectedClient = null;
    if (protocolStatusValue === 'connecting') {
      reconnectController.noteTransportRetry();
      lastReconnectSignal = signal;
      return;
    }

    if (signal === lastReconnectSignal) return;
    lastReconnectSignal = signal;

    if (failure.kind === 'fatal') {
      reconnectController.noteBlocked();
      return;
    }

    reconnectController.activateWaiting(failure);
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
      if (manualError() && classifyReconnectFailure(manualError()).kind === 'fatal') return;
      if (reconnectController.phase() === 'waiting_for_runtime') {
        console.debug('[envapp] ensureHealthy: nudge waiting reconnect', { reason });
        reconnectController.requestImmediateTick();
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

        localStatus = await getLocalAccessStatus();
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

      let preferredSurface = readPersistedActiveSurface();
      const preferredDesktopViewMode = readPersistedDesktopViewMode() ?? 'deck';
      if (rt && preferredSurface === 'ports') preferredSurface = 'codespaces';
      if (preferredSurface === 'ai') {
        // Defer opening Flower until access state is loaded.
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
    list.push({ id: 'ai', name: i18n.t('shell.nav.flower'), icon: FlowerNavigationIcon, component: EnvAIPage, sidebar: { order: 6, fullScreen: false, renderIn: 'main' } });
    list.push({ id: 'codex', name: i18n.t('shell.nav.codex'), icon: CodexNavigationIcon, component: CodexPage, sidebar: { order: 7, fullScreen: false, renderIn: 'main' } });
    list.push({ id: 'settings', name: i18n.t('shell.nav.runtimeSettings'), icon: Settings, component: EnvSettingsPage, sidebar: { order: 99, fullScreen: true } });
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

  const activateActivitySurface = (surface: EnvSurfaceId | 'settings', opts?: { persist?: boolean }) => {
    if (surface !== 'settings') {
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

  const activateDeckSurface = (surfaceId: EnvSurfaceId, options?: EnvOpenSurfaceOptions) => {
    const widgetType = envWidgetTypeForSurface(surfaceId);
    const existingWidget = deck.activeLayout()?.widgets.find((widget) => widget.type === widgetType);
    const widgetId = existingWidget?.id ?? deck.addWidget(widgetType);
    setLastRequestedSurface(surfaceId);
    setDeckSurfaceActivation({
      requestId: createClientId(),
      surfaceId,
      widgetId,
      focus: options?.focus ?? true,
      ensureVisible: options?.ensureVisible ?? true,
    });
    setDeckSurfaceActivationSeq((n) => n + 1);
  };

  const activateWorkbenchSurface = (surfaceId: EnvSurfaceId, options?: EnvOpenSurfaceOptions) => {
    setLastRequestedSurface(surfaceId);
    setWorkbenchSurfaceActivation({
      requestId: createClientId(),
      surfaceId,
      focus: options?.focus ?? true,
      ensureVisible: options?.ensureVisible ?? true,
      centerViewport: options?.centerViewport ?? options?.ensureVisible ?? true,
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
    if (requestedMode === 'deck' && (options?.focusSurface ?? true)) {
      activateDeckSurface(targetSurface, { reason: 'mode_restore', focus: true, ensureVisible: true });
      return;
    }
    if (
      requestedMode === 'workbench'
      && previousMode !== 'workbench'
      && (options?.requestWorkbenchOverview ?? true)
    ) {
      requestWorkbenchOverviewEntry();
    }
  };

  const openSurface = (surfaceId: EnvSurfaceId, options?: EnvOpenSurfaceOptions) => {
    const targetSurface = resolveOpenSurfaceTarget(surfaceId, options);
    setLastRequestedSurface(targetSurface);

    if (viewMode() === 'deck') {
      activateDeckSurface(targetSurface, options);
      return;
    }
    if (viewMode() === 'workbench') {
      activateWorkbenchSurface(targetSurface, options);
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
    if (layout.sidebarActiveTab() !== 'ai') return;
    if (canUseFlower()) return;
    activateActivitySurface(ENV_DEFAULT_SURFACE_ID, { persist: false });
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
    if (canUseFlower()) {
      items.push({
        id: 'ai',
        icon: FlowerNavigationIcon,
        label: i18n.t('shell.nav.flower'),
        collapseBehavior: 'toggle',
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
        id: 'redeven.env.switchToDeck',
        title: i18n.t('shell.commandPalette.switchToDeckTitle'),
        description: i18n.t('shell.commandPalette.switchToDeckDescription'),
        category: commandCategory,
        keybind: 'mod+shift+d',
        icon: LayoutDashboard,
        execute: () => setViewMode('deck', { surfaceId: activeSurface(), focusSurface: true }),
      },
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
        title: i18n.t('shell.commandPalette.toggleThemeTitle'),
        description: i18n.t('shell.commandPalette.toggleThemeDescription'),
        category: i18n.t('shell.commandPalette.categories.view'),
        keybind: 'mod+shift+l',
        icon: () => (theme.resolvedTheme() === 'light' ? <Moon class="w-4 h-4" /> : <Sun class="w-4 h-4" />),
        execute: () => {
          toggleThemeWithRenderBoundary();
          const nextTheme = theme.resolvedTheme() === 'light'
            ? i18n.t('shell.notifications.darkTheme')
            : i18n.t('shell.notifications.lightTheme');
          notify.info(
            i18n.t('shell.notifications.themeChangedTitle'),
            i18n.t('shell.notifications.switchedToTheme', { theme: nextTheme }),
          );
        },
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
        <DisplayModeSwitcher
          mode={viewMode()}
          onChange={(mode) => setViewMode(mode, { surfaceId: activeSurface(), focusSurface: mode !== 'activity' })}
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
      <TopBarIconButton
        label={i18n.t('shell.topbar.toggleTheme')}
        tooltip={topBarTooltip(i18n.t('shell.topbar.toggleTheme'))}
        onClick={toggleThemeWithRenderBoundary}
      >
        {theme.resolvedTheme() === 'light' ? <Moon class="w-4 h-4" /> : <Sun class="w-4 h-4" />}
      </TopBarIconButton>
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

  const renderActivityShell = () => (
    <Shell
      sidebarMode={viewMode() === 'activity' && layout.sidebarActiveTab() !== 'ai' ? 'auto' : 'hidden'}
      slotClassNames={{
        sidebar: viewMode() === 'activity' && layout.sidebarVisibilityMotion() === 'instant' ? 'transition-none' : undefined,
        bottomBarHeight: 'h-7',
      }}
      resolveSidebarVisibilityMotion={({ currentActiveId, nextActiveId, isMobile }) => (
        resolveEnvSidebarVisibilityMotion({
          currentTab: currentActiveId,
          nextTab: nextActiveId,
          isMobile,
        })
      )}
      sidebarContent={(activeTab) =>
        viewMode() !== 'activity'
          ? <></>
          : activeTab === 'codex' && canUseCodex()
            ? <CodexSidebar />
            : <></>
      }
      logo={<ShellLogo />}
      activityItems={viewMode() === 'activity' ? activityItems() : []}
      activityBottomItems={activityBottomItems()}
      topBarActions={<HeaderActions />}
      bottomBarItems={
        <>
          {/* Environment identity chip */}
          <div class="flex items-center gap-2 min-w-0">
            <div class="flex items-center gap-1 min-w-0 pl-1.5 pr-2 rounded-md border border-border bg-white/40 dark:bg-white/[0.08] shrink-0">
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
              <BottomBarItem class="min-w-0 shrink-0">
                <span class="truncate text-[11px] font-medium text-foreground">{envSessionIdentity().displayName}</span>
              </BottomBarItem>
              <span class="w-px h-3.5 bg-border shrink-0" />
              <BottomBarItem class="min-w-0 shrink-0">
                <span class="truncate text-[11px] text-muted-foreground">{envSessionIdentity().displayID || i18n.t('shell.status.missingEnvId')}</span>
              </BottomBarItem>
            </div>
            <span class={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold leading-tight shrink-0 whitespace-nowrap ${
              envSessionIdentity().source === 'local_runtime' ? 'bg-primary/10 text-primary' :
              envSessionIdentity().source === 'ssh_environment' ? 'bg-info/10 text-info' :
              'bg-accent/10 text-accent'
            }`}>
              {envTypeLabel()}
            </span>
          </div>
          <div class="flex-1" />
          {/* Status + Actions */}
          <div class="flex items-center gap-0.5">
            <StatusIndicator status={status()} label={statusLabel()} />
            <Tooltip content={canViewAudit() ? i18n.t('shell.status.auditLog') : i18n.t('shell.status.adminRequired')} placement="top" delay={0}>
              <BottomBarItem
                onClick={canViewAudit() ? () => setAuditOpen(true) : undefined}
                class={canViewAudit() ? undefined : 'opacity-40 pointer-events-none'}
              >
                {i18n.t('shell.status.auditLog')}
              </BottomBarItem>
            </Tooltip>
            <BottomBarItem
              onClick={reconnectDisabled() ? undefined : () => void triggerReconnect()}
              class={reconnectDisabled() ? 'opacity-40 pointer-events-none' : 'bg-primary/15'}
            >
              <span class="text-primary">{reconnectLabel()}</span>
            </BottomBarItem>
          </div>
        </>
      }
    >
      <div class="h-full min-h-0 overflow-hidden flex flex-col">
        <Show when={connectError()}>
          <Panel class="h-auto rounded-none border-0 border-b border-error/40">
            <PanelContent class="p-3 text-xs">
              <div role="alert">
                <div class="text-error font-medium">{connectNotice()?.title ?? i18n.t('shell.status.connectionFailed')}</div>
                <div class="text-muted-foreground break-words">{connectNotice()?.message ?? connectError()}</div>
              </div>
            </PanelContent>
          </Panel>
        </Show>

        <div ref={setNotesViewportAnchor} class="flex-1 min-h-0 overflow-hidden relative">
          <Show
            when={accessGateVisible()}
            fallback={
              <>
                <Show when={viewMode() === 'activity'}>
                  <ActivityAppsMain activeId={() => layout.sidebarActiveTab()} />
                </Show>
                {renderNotesOverlay()}
              </>
            }
          >
            {accessGatePanel()}
          </Show>
        </div>
      </div>

      <AuditLogDialog open={auditOpen()} envId={envId()} onClose={() => setAuditOpen(false)} />
      <FileBrowserSurfaceHost />
      <DebugConsoleWindow controller={debugConsole} />
    </Shell>
  );

  const renderDisplayModeContent = (mode: 'deck' | 'workbench') => (
    <div ref={setNotesViewportAnchor} class="relative h-full min-h-0 overflow-hidden">
      <Show
        when={accessGateVisible()}
        fallback={(
          <>
            {mode === 'deck' ? (
              <EnvDeckPage />
            ) : (
              <EnvWorkbenchPage />
            )}
            {renderNotesOverlay()}
          </>
        )}
      >
        {accessGatePanel()}
      </Show>
    </div>
  );

  const renderMainShell = () => {
    if (viewMode() === 'deck') {
      return (
        <DisplayModePageShell logo={<ShellLogo />} actions={<HeaderActions />}>
          {renderDisplayModeContent('deck')}
        </DisplayModePageShell>
      );
    }

    if (viewMode() === 'workbench') {
      return (
        <DisplayModePageShell logo={<ShellLogo />} actions={<HeaderActions />}>
          {renderDisplayModeContent('workbench')}
        </DisplayModePageShell>
      );
    }

    return renderActivityShell();
  };

  return (
    <EnvContext.Provider
      value={{
        env_id: envId,
        env,
        localRuntime,
        connect,
        connecting,
        connectError,
        connectionOverlayVisible,
        connectionOverlayMessage,
        viewMode,
        setViewMode,
        activeSurface,
        lastActivitySurface,
        openSurface,
        goActivity: (surfaceId) => openSurface(surfaceId, { reason: 'direct_navigation', focus: true, ensureVisible: true }),
        deckSurfaceActivationSeq,
        deckSurfaceActivation,
        consumeDeckSurfaceActivation,
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
        consumeOpenTerminalInDirectoryRequest,
        aiThreadFocusRequest,
        focusAIThread,
        consumeAIThreadFocusRequest,
      }}
    >
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
                <AIChatProviderBridge>
                  <CodexProvider>{renderMainShell()}</CodexProvider>
                  <Show when={viewMode() !== 'workbench'}>
                    <FilePreviewHost />
                  </Show>
                  <FlowerTurnLauncherWindow
                    open={flowerTurnLauncherOpen()}
                    intent={flowerTurnLauncherIntent()}
                    anchor={flowerTurnLauncherAnchor()}
                    onClose={closeFlowerTurnLauncher}
                    onSubmit={submitFlowerTurnLauncher}
                  />
                </AIChatProviderBridge>
              </FloeRegistryRuntime>
            </RuntimeUpdateContext.Provider>
          </FilePreviewContext.Provider>
        </FileBrowserSurfaceContext.Provider>
      </DownloadContext.Provider>
    </EnvContext.Provider>
  );
}
