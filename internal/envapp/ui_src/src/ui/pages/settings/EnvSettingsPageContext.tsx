import { createContext, useContext, createMemo, createSignal, createEffect, createResource, onCleanup, type Resource, type JSX, type Accessor } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRuntimeUpdateContext } from '../../maintenance/RuntimeUpdateContext';
import { resolveAgentUpgradeState } from '../../maintenance/agentUpgradeState';
import { isReleaseVersion } from '../../maintenance/agentVersion';
import { formatAgentStatusLabel } from '../../maintenance/shared';
import { fetchLocalApiJSON } from '../../services/localApi';
import {
  cancelCodeRuntimeOperation,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationSucceeded,
  fetchCodeRuntimeStatus,
  removeCodeRuntimeVersion,
  selectCodeRuntimeVersion,
  type BrowserEditorInstallMethod,
  type CodeRuntimeStatus,
} from '../../services/codeRuntimeApi';
import {
  browserEditorLocalFailureFromError,
  type BrowserEditorSetupLocalFailure,
} from '../../services/browserEditorSetupActivity';
import { desktopCodeWorkspacePrepareAvailable } from '../../services/desktopCodeWorkspaceBridge';
import {
  cancelBrowserEditorSetup,
  defaultBrowserEditorInstallMethod,
  prepareBrowserEditorSetup,
} from '../../services/browserEditorSetup';
import {
  createBrowserEditorSetupOperationID,
  type BrowserEditorSetupProgress,
} from '../../services/browserEditorSetupProgress';
import { useEnvContext, type EnvSettingsSection } from '../EnvContext';
import type { AgentSettingsResponse, CodexHostStatus, SettingsUpdateResponse } from './types';
import { useI18n } from '../../i18n';

// ── Helpers ──

function isSettingsResponseLike(raw: unknown): raw is AgentSettingsResponse {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw as any;
  return typeof v.config_path === 'string' && typeof v.connection === 'object' && typeof v.runtime === 'object';
}

function normalizeSettingsUpdateResponse(raw: unknown): { settings: AgentSettingsResponse | null; aiUpdate: any } {
  if (isSettingsResponseLike(raw)) return { settings: raw, aiUpdate: null };
  if (!raw || typeof raw !== 'object') return { settings: null, aiUpdate: null };
  const v = raw as any;
  const settings = isSettingsResponseLike(v.settings) ? (v.settings as AgentSettingsResponse) : null;
  const aiUpdate = v.ai_update && typeof v.ai_update === 'object' ? v.ai_update : null;
  return { settings, aiUpdate };
}

function formatRuntimeServiceWorkload(i18n: ReturnType<typeof useI18n>, snapshot: any): string {
  const workload = snapshot?.activeWorkload;
  if (!workload) return i18n.t('runtimeStatus.noActiveWork');
  const parts = [
    workload.terminalCount > 0 ? i18n.tn('runtimeStatus.workload.terminals', workload.terminalCount) : '',
    workload.sessionCount > 0 ? i18n.tn('runtimeStatus.workload.sessions', workload.sessionCount) : '',
    workload.taskCount > 0 ? i18n.tn('runtimeStatus.workload.tasks', workload.taskCount) : '',
    workload.portForwardCount > 0 ? i18n.tn('runtimeStatus.workload.webServices', workload.portForwardCount) : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : i18n.t('runtimeStatus.noActiveWork');
}

// ── Context Type ──

export interface EnvSettingsPageContextValue {
  env: ReturnType<typeof useEnvContext>;
  protocol: ReturnType<typeof useProtocol>;
  notify: ReturnType<typeof useNotification>;
  runtimeUpdate: ReturnType<typeof useRuntimeUpdateContext>;

  settings: Resource<AgentSettingsResponse | null>;
  refreshSettings: () => Promise<void>;
  mutateSettings: (v: AgentSettingsResponse | null) => void;
  saveSettings: (body: any) => Promise<SettingsUpdateResponse>;

  codexStatus: Resource<CodexHostStatus | null>;
  refreshCodexStatus: () => void;
  codeRuntimeStatus: Resource<CodeRuntimeStatus | null>;
  refreshCodeRuntimeStatus: () => void;

  canInteract: Accessor<boolean>;
  canAdmin: Accessor<boolean>;

  // Navigation
  activeSection: Accessor<EnvSettingsSection>;
  setActiveSection: (s: EnvSettingsSection) => void;
  searchQuery: Accessor<string>;
  setSearchQuery: (q: string) => void;

  // Runtime maintenance
  latestVersion: Accessor<any>;
  latestVersionLoading: Accessor<boolean>;
  latestVersionError: Accessor<any>;
  maintenanceContext: Accessor<any>;
  upgradeState: Accessor<any>;
  displayedStatus: Accessor<string>;
  maintenanceStage: Accessor<any>;
  maintenanceError: Accessor<any>;
  maintaining: Accessor<boolean>;
  isUpgrading: Accessor<boolean>;
  isRestarting: Accessor<boolean>;
  runtimeService: Accessor<any>;
  activeWorkSummary: Accessor<string>;
  runtimeDesktopModelSourceBinding: Accessor<any>;
  statusLabel: Accessor<string>;
  targetVersionInput: Accessor<string>;
  setTargetVersionInput: (v: string) => void;
  targetUpgradeVersion: Accessor<string>;
  targetUpgradeVersionValid: Accessor<boolean>;
  canStartRestart: Accessor<boolean>;
  canStartUpgrade: Accessor<boolean>;
  startRestart: () => Promise<void>;
  startUpgrade: () => Promise<void>;
  refreshSettingsPage: () => Promise<void>;

  // Code runtime maintenance
  codeRuntimeActionLoading: Accessor<boolean>;
  codeRuntimeCancelLoading: Accessor<boolean>;
  codeRuntimeSelectionLoadingVersion: Accessor<string | null>;
  codeRuntimeRemoveVersionLoading: Accessor<string | null>;
  codeRuntimeLocalPrepareFailure: Accessor<any>;
  codeRuntimeLocalPrepareCancelled: Accessor<boolean>;
  codeRuntimePrepareProgress: Accessor<BrowserEditorSetupProgress | null>;
  codeRuntimeInstallMethod: Accessor<BrowserEditorInstallMethod>;
  setCodeRuntimeInstallMethod: (method: BrowserEditorInstallMethod) => void;
  desktopCodeRuntimeTransferAvailable: Accessor<boolean>;
  canManageCodeRuntime: Accessor<boolean>;
  prepareManagedCodeRuntime: () => void;
  cancelManagedCodeRuntimeOperation: () => void;
  selectManagedCodeRuntimeVersion: (version: string) => void;
  removeManagedCodeRuntimeVersion: (version: string) => void;

  // Loading curtain
  showLoadingCurtain: (opts: { surface: string; eyebrow?: string; message?: string }) => void;
  hideLoadingCurtain: () => void;
}

export const EnvSettingsPageCtx = createContext<EnvSettingsPageContextValue>();

export function useEnvSettingsPage(): EnvSettingsPageContextValue {
  const ctx = useContext(EnvSettingsPageCtx);
  if (!ctx) throw new Error('useEnvSettingsPage must be used inside <EnvSettingsPageProvider>');
  return ctx;
}

// ── Provider ──

export function EnvSettingsPageProvider(props: { children: JSX.Element; initialSection?: EnvSettingsSection }) {
  const env = useEnvContext();
  const runtimeUpdate = useRuntimeUpdateContext();
  const protocol = useProtocol();
  const notify = useNotification();
  const i18n = useI18n();

  const key = createMemo<number | null>(() => (protocol.status() === 'connected' ? env.settingsSeq() : null));

  const [settings, { mutate: mutateSettings, refetch }] = createResource<AgentSettingsResponse | null, number | null>(
    () => key(),
    async (k) => (k == null ? null : await fetchLocalApiJSON<AgentSettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' })),
  );
  const [codexStatus, { refetch: refetchCodexStatus }] = createResource<CodexHostStatus | null, number | null>(
    () => key(),
    async (k) => (k == null ? null : await fetchLocalApiJSON<CodexHostStatus>('/_redeven_proxy/api/codex/status', { method: 'GET' })),
  );
  const [codeRuntimeStatus, { refetch: refetchCodeRuntimeStatus }] = createResource<CodeRuntimeStatus | null, number | null>(
    () => key(),
    async (k) => (k == null ? null : await fetchCodeRuntimeStatus()),
  );

  const canInteract = createMemo(() => protocol.status() === 'connected' && !settings.loading && !settings.error);
  const canManageCodeRuntime = createMemo(() => Boolean(env.env()?.permissions?.can_read && env.env()?.permissions?.can_write && env.env()?.permissions?.can_execute));
  const canAdmin = createMemo(() => !!env.env()?.permissions?.can_admin || !!env.env()?.permissions?.is_owner);

  // Navigation
  const [activeSection, setActiveSection] = createSignal<EnvSettingsSection>(props.initialSection ?? 'config');
  const [searchQuery, setSearchQuery] = createSignal('');

  createEffect(() => {
    const focusSeq = env.settingsFocusSeq();
    if (focusSeq <= 0) return;
    setActiveSection(env.settingsFocusSection() ?? 'config');
  });

  // Runtime maintenance
  const latestVersion = createMemo(() => runtimeUpdate.version.latestMeta());
  const latestVersionLoading = createMemo(() => runtimeUpdate.version.latestMetaLoading());
  const latestVersionError = createMemo(() => runtimeUpdate.version.latestMetaError());
  const maintenanceContext = createMemo(() => runtimeUpdate.maintenanceContext());
  const upgradeState = createMemo(() => resolveAgentUpgradeState(latestVersion(), maintenanceContext()));
  const displayedStatus = createMemo(() => runtimeUpdate.maintenance.displayedStatus());
  const maintenanceStage = createMemo(() => runtimeUpdate.maintenance.stage());
  const maintenanceError = createMemo(() => runtimeUpdate.maintenance.error());
  const maintaining = createMemo(() => runtimeUpdate.maintenance.maintaining());
  const isUpgrading = createMemo(() => runtimeUpdate.maintenance.isUpgrading());
  const isRestarting = createMemo(() => runtimeUpdate.maintenance.isRestarting());
  const runtimeService = createMemo(() => runtimeUpdate.version.runtimeService());
  const activeWorkSummary = createMemo(() => formatRuntimeServiceWorkload(i18n, runtimeService()));
  const runtimeDesktopModelSourceBinding = createMemo(() => runtimeService()?.bindings?.desktopModelSource);
  const statusLabel = createMemo(() => formatAgentStatusLabel(displayedStatus()));

  const [targetVersionInput, setTargetVersionInput] = createSignal('');
  const preferredUpgradeVersion = createMemo(() => runtimeUpdate.version.preferredTargetVersion());
  const targetUpgradeVersion = createMemo(() => String(targetVersionInput() ?? '').trim());
  const targetUpgradeVersionValid = createMemo(() => isReleaseVersion(targetUpgradeVersion()));

  createEffect(() => {
    const preferred = preferredUpgradeVersion();
    if (!preferred) return;
    if (String(targetVersionInput() ?? '').trim()) return;
    setTargetVersionInput(preferred);
  });

  // Code runtime
  const [codeRuntimeActionLoading, setCodeRuntimeActionLoading] = createSignal(false);
  const [codeRuntimeCancelLoading, setCodeRuntimeCancelLoading] = createSignal(false);
  const [codeRuntimeLocalPrepareFailure, setCodeRuntimeLocalPrepareFailure] = createSignal<BrowserEditorSetupLocalFailure | null>(null);
  const [codeRuntimeLocalPrepareCancelled, setCodeRuntimeLocalPrepareCancelled] = createSignal(false);
  const [codeRuntimePrepareProgress, setCodeRuntimePrepareProgress] = createSignal<BrowserEditorSetupProgress | null>(null);
  const [codeRuntimePrepareOperationID, setCodeRuntimePrepareOperationID] = createSignal<string | null>(null);
  const [codeRuntimePrepareCancelRequestedID, setCodeRuntimePrepareCancelRequestedID] = createSignal<string | null>(null);
  const [codeRuntimeInstallMethod, setCodeRuntimeInstallMethod] = createSignal<BrowserEditorInstallMethod>(defaultBrowserEditorInstallMethod());
  const [codeRuntimePrepareActiveMethod, setCodeRuntimePrepareActiveMethod] = createSignal<BrowserEditorInstallMethod | null>(null);
  let codeRuntimePrepareAbortController: AbortController | null = null;
  const [codeRuntimeSelectionLoadingVersion, setCodeRuntimeSelectionLoadingVersion] = createSignal<string | null>(null);
  const [codeRuntimeRemoveVersionLoading, setCodeRuntimeRemoveVersionLoading] = createSignal<string | null>(null);
  const [pendingRuntimeSuccessAction, setPendingRuntimeSuccessAction] = createSignal<'' | 'prepare_workspace_engine' | 'remove_local_environment_version'>('');

  createEffect(() => {
    if (codeRuntimeStatus()?.operation.state !== 'running') return;
    setCodeRuntimeLocalPrepareFailure(null);
    const timer = window.setInterval(() => { void refetchCodeRuntimeStatus(); }, 1000);
    onCleanup(() => { window.clearInterval(timer); });
  });

  createEffect(() => {
    const status = codeRuntimeStatus();
    if (!status) return;
    if (codeRuntimeOperationSucceeded(status)) {
      setCodeRuntimeLocalPrepareFailure(null);
      setCodeRuntimeLocalPrepareCancelled(false);
    }
  });

  createEffect(() => {
    const pendingAction = pendingRuntimeSuccessAction();
    if (!pendingAction) return;
    const status = codeRuntimeStatus();
    if (!status) return;
    const operationAction = String((status as any).operation?.action ?? '').trim();
    if ((status as any).operation?.state === 'running') return;
    if (codeRuntimeOperationSucceeded(status) && operationAction === pendingAction) {
      if (pendingAction === 'remove_local_environment_version') {
        notify.success(i18n.t('codeRuntime.notifications.versionRemovedTitle'), i18n.t('codeRuntime.notifications.versionRemovedMessage'));
      } else {
        notify.success(i18n.t('codeRuntime.notifications.readyTitle'), i18n.t('codeRuntime.notifications.readyMessage'));
      }
      setPendingRuntimeSuccessAction('');
      return;
    }
    if (codeRuntimeOperationNeedsAttention(status) && operationAction === pendingAction) {
      setPendingRuntimeSuccessAction('');
    }
  });

  // Loading curtain
  const [, setLoadingCurtain] = createSignal<{ visible: boolean; surface: string; eyebrow?: string; message?: string }>({ visible: false, surface: '' });
  const showLoadingCurtain = (opts: { surface: string; eyebrow?: string; message?: string }) => setLoadingCurtain({ visible: true, ...opts });
  const hideLoadingCurtain = () => setLoadingCurtain({ visible: false, surface: '' });

  const saveSettings = async (body: any): Promise<SettingsUpdateResponse> => {
    const json = await fetchLocalApiJSON<any>('/_redeven_proxy/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const normalized = normalizeSettingsUpdateResponse(json);
    if (normalized.settings) mutateSettings(normalized.settings);
    env.bumpSettingsSeq();
    return normalized as any;
  };

  const refreshSettingsPage = async () => {
    await Promise.allSettled([refetch(), runtimeUpdate.version.refetchLatestVersion()]);
  };

  // Maintenance actions (stubs — real implementations moved to sections)
  const canStartRestart = createMemo(() => canAdmin() && !maintaining());
  const canStartUpgrade = createMemo(() => canAdmin() && !maintaining() && upgradeState().allowsUpgradeAction);
  const startRestart = async () => {};
  const startUpgrade = async () => {};
  const prepareManagedCodeRuntime = async () => {
    const operationID = createBrowserEditorSetupOperationID();
    const installMethod = codeRuntimeInstallMethod();
    const abortController = new AbortController();
    codeRuntimePrepareAbortController = abortController;
    setCodeRuntimePrepareOperationID(operationID);
    setCodeRuntimePrepareActiveMethod(installMethod);
    setCodeRuntimePrepareCancelRequestedID(null);
    setCodeRuntimeActionLoading(true);
    setPendingRuntimeSuccessAction('prepare_workspace_engine');
    setCodeRuntimeLocalPrepareFailure(null);
    setCodeRuntimeLocalPrepareCancelled(false);
    setCodeRuntimePrepareProgress({
      operation_id: operationID,
      phase: 'lookup',
      state: 'running',
      updated_at_unix_ms: Date.now(),
    });
    try {
      const result = await prepareBrowserEditorSetup({
        status: codeRuntimeStatus(),
        operationID,
        installMethod,
        signal: abortController.signal,
        onProgress: (progress) => {
          if (codeRuntimePrepareOperationID() === operationID) setCodeRuntimePrepareProgress(progress);
        },
      });
      if (result.cancelled || codeRuntimePrepareCancelRequestedID() === operationID) {
        setPendingRuntimeSuccessAction('');
        setCodeRuntimeLocalPrepareCancelled(true);
        return;
      }
      if (!result.ok || !result.prepared) {
        throw new Error(result.message || i18n.t('codeRuntime.notifications.setupDidNotFinish'));
      }
      await refetchCodeRuntimeStatus();
    } catch (e) {
      setPendingRuntimeSuccessAction('');
      if (codeRuntimePrepareCancelRequestedID() === operationID) {
        setCodeRuntimeLocalPrepareCancelled(true);
        return;
      }
      const failure = browserEditorLocalFailureFromError(e, installMethod);
      setCodeRuntimeLocalPrepareFailure(failure);
      notify.error(i18n.t('codeRuntime.notifications.setupFailedTitle'), failure.message);
    } finally {
      if (codeRuntimePrepareOperationID() === operationID) {
        codeRuntimePrepareAbortController = null;
        setCodeRuntimePrepareOperationID(null);
        setCodeRuntimePrepareActiveMethod(null);
        setCodeRuntimeActionLoading(false);
        setCodeRuntimeInstallMethod(defaultBrowserEditorInstallMethod());
      }
    }
  };
  const cancelManagedCodeRuntimeOperation = async () => {
    const operationID = codeRuntimePrepareOperationID();
    const installMethod = codeRuntimePrepareActiveMethod();
    if (operationID) setCodeRuntimePrepareCancelRequestedID(operationID);
    codeRuntimePrepareAbortController?.abort();
    setCodeRuntimeCancelLoading(true);
    try {
      if (operationID && installMethod) {
        await cancelBrowserEditorSetup(operationID, installMethod);
      } else if (codeRuntimeStatus()?.operation.action === 'remove_local_environment_version') {
        await cancelCodeRuntimeOperation();
      }
      if (operationID) setCodeRuntimeLocalPrepareCancelled(true);
      await refetchCodeRuntimeStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error(i18n.t('codeRuntime.notifications.cancelFailedTitle'), msg || i18n.t('codeRuntime.notifications.requestFailed'));
    } finally {
      setCodeRuntimeCancelLoading(false);
    }
  };
  const selectManagedCodeRuntimeVersion = async (version: string) => {
    setCodeRuntimeSelectionLoadingVersion(version);
    setCodeRuntimeLocalPrepareFailure(null);
    try {
      await selectCodeRuntimeVersion(version);
      await refetchCodeRuntimeStatus();
      notify.success(i18n.t('codeRuntime.notifications.updatedTitle'), i18n.t('codeRuntime.notifications.updatedMessage', { version }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error(i18n.t('codeRuntime.notifications.selectionFailedTitle'), msg || i18n.t('codeRuntime.notifications.requestFailed'));
    } finally {
      setCodeRuntimeSelectionLoadingVersion(null);
    }
  };
  const removeManagedCodeRuntimeVersion = async (version: string) => {
    setCodeRuntimeRemoveVersionLoading(version);
    setPendingRuntimeSuccessAction('remove_local_environment_version');
    setCodeRuntimeLocalPrepareFailure(null);
    try {
      await removeCodeRuntimeVersion(version);
      await refetchCodeRuntimeStatus();
    } catch (e) {
      setPendingRuntimeSuccessAction('');
      const msg = e instanceof Error ? e.message : String(e);
      notify.error(i18n.t('codeRuntime.notifications.versionRemovalFailedTitle'), msg || i18n.t('codeRuntime.notifications.requestFailed'));
    } finally {
      setCodeRuntimeRemoveVersionLoading(null);
    }
  };

  const value: EnvSettingsPageContextValue = {
    env, protocol, notify, runtimeUpdate,
    settings, refreshSettings: refreshSettingsPage, mutateSettings, saveSettings,
    codexStatus, refreshCodexStatus: () => { void refetchCodexStatus(); },
    codeRuntimeStatus, refreshCodeRuntimeStatus: () => { void refetchCodeRuntimeStatus(); },
    canInteract, canAdmin,
    activeSection, setActiveSection,
    searchQuery, setSearchQuery,
    latestVersion, latestVersionLoading, latestVersionError,
    maintenanceContext, upgradeState, displayedStatus,
    maintenanceStage, maintenanceError, maintaining, isUpgrading, isRestarting,
    runtimeService, activeWorkSummary, runtimeDesktopModelSourceBinding,
    statusLabel, targetVersionInput, setTargetVersionInput,
    targetUpgradeVersion, targetUpgradeVersionValid,
    canStartRestart, canStartUpgrade, startRestart, startUpgrade,
    refreshSettingsPage,
    codeRuntimeActionLoading, codeRuntimeCancelLoading,
    codeRuntimeSelectionLoadingVersion, codeRuntimeRemoveVersionLoading,
    codeRuntimeLocalPrepareFailure, codeRuntimeLocalPrepareCancelled, codeRuntimePrepareProgress, canManageCodeRuntime,
    codeRuntimeInstallMethod, setCodeRuntimeInstallMethod,
    desktopCodeRuntimeTransferAvailable: () => desktopCodeWorkspacePrepareAvailable(),
    prepareManagedCodeRuntime, cancelManagedCodeRuntimeOperation,
    selectManagedCodeRuntimeVersion, removeManagedCodeRuntimeVersion,
    showLoadingCurtain, hideLoadingCurtain,
  };

  return (
    <EnvSettingsPageCtx.Provider value={value}>
      {props.children}
    </EnvSettingsPageCtx.Provider>
  );
}
