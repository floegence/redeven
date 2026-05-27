import { createContext, useContext, createMemo, createSignal, createEffect, createResource, onCleanup, type Resource, type JSX, type Accessor } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRuntimeUpdateContext } from '../../maintenance/RuntimeUpdateContext';
import { resolveAgentUpgradeState } from '../../maintenance/agentUpgradeState';
import { isReleaseVersion } from '../../maintenance/agentVersion';
import { formatAgentStatusLabel } from '../../maintenance/shared';
import { fetchGatewayJSON } from '../../services/gatewayApi';
import { fetchCodeRuntimeStatus, type CodeRuntimeStatus } from '../../services/codeRuntimeApi';
import { useEnvContext, type EnvSettingsSection } from '../EnvContext';
import type { AgentSettingsResponse, CodexHostStatus, SettingsUpdateResponse } from './types';

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

function formatRuntimeServiceWorkload(snapshot: any): string {
  const workload = snapshot?.activeWorkload;
  if (!workload) return 'No active work';
  const parts = [
    workload.terminalCount > 0 ? `${workload.terminalCount} ${workload.terminalCount === 1 ? 'terminal' : 'terminals'}` : '',
    workload.sessionCount > 0 ? `${workload.sessionCount} ${workload.sessionCount === 1 ? 'session' : 'sessions'}` : '',
    workload.taskCount > 0 ? `${workload.taskCount} ${workload.taskCount === 1 ? 'task' : 'tasks'}` : '',
    workload.portForwardCount > 0 ? `${workload.portForwardCount} ${workload.portForwardCount === 1 ? 'web service' : 'web services'}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'No active work';
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
  canManageCodeRuntime: Accessor<boolean>;
  prepareManagedCodeRuntime: () => void;
  cancelManagedCodeRuntimeOperation: () => void;
  selectManagedCodeRuntimeVersion: (version: string) => void;
  removeManagedCodeRuntimeVersion: (version: string) => void;

  // Loading curtain
  showLoadingCurtain: (opts: { surface: string; eyebrow?: string; message?: string }) => void;
  hideLoadingCurtain: () => void;
}

const EnvSettingsPageCtx = createContext<EnvSettingsPageContextValue>();

export function useEnvSettingsPage(): EnvSettingsPageContextValue {
  const ctx = useContext(EnvSettingsPageCtx);
  if (!ctx) throw new Error('useEnvSettingsPage must be used inside <EnvSettingsPageProvider>');
  return ctx;
}

// ── Provider ──

export function EnvSettingsPageProvider(props: { children: JSX.Element }) {
  const env = useEnvContext();
  const runtimeUpdate = useRuntimeUpdateContext();
  const protocol = useProtocol();
  const notify = useNotification();

  const key = createMemo<number | null>(() => (protocol.status() === 'connected' ? env.settingsSeq() : null));

  const [settings, { mutate: mutateSettings, refetch }] = createResource<AgentSettingsResponse | null, number | null>(
    () => key(),
    async (k) => (k == null ? null : await fetchGatewayJSON<AgentSettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' })),
  );
  const [codexStatus, { refetch: refetchCodexStatus }] = createResource<CodexHostStatus | null, number | null>(
    () => key(),
    async (k) => (k == null ? null : await fetchGatewayJSON<CodexHostStatus>('/_redeven_proxy/api/codex/status', { method: 'GET' })),
  );
  const [codeRuntimeStatus, { refetch: refetchCodeRuntimeStatus }] = createResource<CodeRuntimeStatus | null, number | null>(
    () => key(),
    async (k) => (k == null ? null : await fetchCodeRuntimeStatus()),
  );

  const canInteract = createMemo(() => protocol.status() === 'connected' && !settings.loading && !settings.error);
  const canManageCodeRuntime = createMemo(() => Boolean(env.env()?.permissions?.can_read && env.env()?.permissions?.can_write && env.env()?.permissions?.can_execute));
  const canAdmin = createMemo(() => !!env.env()?.permissions?.can_admin || !!env.env()?.permissions?.is_owner);

  // Navigation
  const [activeSection, setActiveSection] = createSignal<EnvSettingsSection>('config');
  const [searchQuery, setSearchQuery] = createSignal('');

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
  const activeWorkSummary = createMemo(() => formatRuntimeServiceWorkload(runtimeService()));
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
  const [codeRuntimeActionLoading] = createSignal(false);
  const [codeRuntimeCancelLoading] = createSignal(false);
  const [codeRuntimeLocalPrepareFailure, setCodeRuntimeLocalPrepareFailure] = createSignal<any>(null);
  const [codeRuntimeSelectionLoadingVersion] = createSignal<string | null>(null);
  const [codeRuntimeRemoveVersionLoading] = createSignal<string | null>(null);
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
    if ((status as any).operation?.state === 'succeeded') setCodeRuntimeLocalPrepareFailure(null);
  });

  createEffect(() => {
    const pendingAction = pendingRuntimeSuccessAction();
    if (!pendingAction) return;
    const status = codeRuntimeStatus();
    if (!status) return;
    const operationAction = String((status as any).operation?.action ?? '').trim();
    if ((status as any).operation?.state === 'running') return;
    if ((status as any).operation?.state === 'succeeded' && operationAction === pendingAction) {
      if (pendingAction === 'remove_local_environment_version') {
        notify.success('Version removed', 'The selected Browser Editor version has been removed.');
      } else {
        notify.success('Browser Editor ready', 'The latest Browser Editor is ready for this environment.');
      }
      setPendingRuntimeSuccessAction('');
      return;
    }
  });

  // Loading curtain
  const [, setLoadingCurtain] = createSignal<{ visible: boolean; surface: string; eyebrow?: string; message?: string }>({ visible: false, surface: '' });
  const showLoadingCurtain = (opts: { surface: string; eyebrow?: string; message?: string }) => setLoadingCurtain({ visible: true, ...opts });
  const hideLoadingCurtain = () => setLoadingCurtain({ visible: false, surface: '' });

  const saveSettings = async (body: any): Promise<SettingsUpdateResponse> => {
    const json = await fetchGatewayJSON<any>('/_redeven_proxy/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const normalized = normalizeSettingsUpdateResponse(json);
    if (normalized.settings) mutateSettings(normalized.settings);
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
  const prepareManagedCodeRuntime = () => {};
  const cancelManagedCodeRuntimeOperation = () => {};
  const selectManagedCodeRuntimeVersion = (_v: string) => {};
  const removeManagedCodeRuntimeVersion = (_v: string) => {};

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
    codeRuntimeLocalPrepareFailure, canManageCodeRuntime,
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
