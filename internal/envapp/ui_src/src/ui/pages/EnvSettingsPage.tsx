import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import {
  Code,
  Database,
  FileCode,
  Globe,
  Layers,
  RefreshIcon,
  Shield,
  Terminal,
  Zap,
} from '@floegence/floe-webapp-core/icons';
import { Sidebar, SidebarContent, SidebarItem, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Checkbox, ConfirmDialog, Dialog, Input, Select } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import { useRuntimeUpdateContext } from '../maintenance/RuntimeUpdateContext';
import { resolveAgentUpgradeState } from '../maintenance/agentUpgradeState';
import { isReleaseVersion } from '../maintenance/agentVersion';
import { formatAgentStatusLabel, formatUnknownError } from '../maintenance/shared';
import type { RuntimeServiceSnapshot } from '../protocol/redeven_v1/sdk/sys';
import { manageDesktopUpdate, openExternalURLInDesktopShell } from '../services/desktopShellBridge';
import { fetchGatewayJSON } from '../services/gatewayApi';
import {
  cancelCodeRuntimeOperation,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationSucceeded,
  fetchCodeRuntimeStatus,
  installCodeRuntime,
  removeCodeRuntimeVersion,
  selectCodeRuntimeVersion,
  type CodeRuntimeStatus,
} from '../services/codeRuntimeApi';
import { FlowerIcon } from '../icons/FlowerIcon';
import { CodexIcon } from '../icons/CodexIcon';
import { useEnvContext, type EnvSettingsSection } from './EnvContext';
import { EnvDebugConsoleSettingsPanel } from './EnvDebugConsoleSettingsPanel';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { AIProviderDialog } from './settings/AIProviderDialog';
import { CodeRuntimeSettingsCard } from './settings/CodeRuntimeSettingsCard';
import {
  DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
  cloneAIProviderRow,
  defaultBaseURLForProviderType,
  defaultContextWindowForProviderType,
  formatTokenCount,
  modelID,
  normalizeAIProviderRowDraft,
  normalizeContextWindowByProvider,
  normalizeEffectiveContextPercent,
  normalizePositiveInteger,
  providerBuiltInWebSearchLabel,
  providerNeedsWebSearchConfig,
  providerPresetForType,
  providerTypeRequiresBaseURL,
  recommendedModelsForProviderType,
} from './settings/aiCatalog';
import { buildPermissionPolicyValue } from './settings/permissionPolicy';
import { PermissionMatrixTable, PermissionRuleTable } from './settings/PermissionPolicyTables';
import {
  AutoSaveIndicator,
  CodeBadge,
  FieldLabel,
  JSONEditor,
  SectionGroup,
  SettingsCard,
  SettingsKeyValueTable,
  SettingsPill,
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeaderCell,
  SettingsTableHeaderRow,
  SettingsTableRow,
  SubSectionHeader,
  ViewToggle,
  type ViewMode,
} from './settings/SettingsPrimitives';
import { SETTINGS_GROUP_META, SETTINGS_NAV_ITEMS, settingsSectionElementID } from './settings/settingsStructure';
import { SkillsCatalogTable } from './settings/SkillsCatalogTable';
import type {
  AgentSettingsResponse,
  AIConfig,
  AIProvider,
  AIProviderDialogMode,
  AIProviderModel,
  AIProviderModelPreset,
  AIProviderModelRow,
  AIProviderRow,
  AIProviderType,
  AIProviderWebSearchMode,
  AIPreservedUIFields,
  CodexHostStatus,
  PermissionPolicy,
  PermissionRow,
  PermissionSet,
  SettingsAIUpdateMeta,
  SettingsUpdateResponse,
  SkillBrowseFileResponse,
  SkillBrowseTreeResponse,
  SkillCatalogEntry,
  SkillGitHubCatalogResponse,
  SkillGitHubImportResponse,
  SkillGitHubValidateItem,
  SkillGitHubValidateResponse,
  SkillReinstallResponse,
  SkillsCatalogResponse,
  SkillSourceItem,
  SkillSourcesResponse,
} from './settings/types';

// ============================================================================
// Constants & Helpers
// ============================================================================

const DEFAULT_CODE_SERVER_PORT_MIN = 20000;
const DEFAULT_CODE_SERVER_PORT_MAX = 21000;
const AUTO_SAVE_DELAY_MS = 700;

function formatSavedTime(unixMs: number | null): string {
  if (!unixMs) return '';
  try {
    return new Date(unixMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function autoSaveMessage(label: string, unixMs: number): string {
  const t = formatSavedTime(unixMs);
  return t ? `${label} saved at ${t}.` : `${label} saved.`;
}

function autoSaveRestartRequiredMessage(label: string, unixMs: number): string {
  return `${autoSaveMessage(label, unixMs)} Restart manually to apply.`;
}

function isSettingsResponseLike(raw: unknown): raw is AgentSettingsResponse {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw as any;
  return typeof v.config_path === 'string' && typeof v.connection === 'object' && typeof v.runtime === 'object';
}

function normalizeSettingsUpdateResponse(raw: unknown): { settings: AgentSettingsResponse | null; aiUpdate: SettingsAIUpdateMeta | null } {
  if (isSettingsResponseLike(raw)) {
    return { settings: raw, aiUpdate: null };
  }
  if (!raw || typeof raw !== 'object') {
    return { settings: null, aiUpdate: null };
  }
  const v = raw as any;
  const settings = isSettingsResponseLike(v.settings) ? (v.settings as AgentSettingsResponse) : null;
  const aiUpdate = v.ai_update && typeof v.ai_update === 'object' ? (v.ai_update as SettingsAIUpdateMeta) : null;
  return { settings, aiUpdate };
}

function newProviderID(): string {
  // Provider ids are stable primary keys. Generate them once and never ask users to edit them.
  // Use a lowercase uuid (browser Web Crypto) to avoid case-sensitivity surprises.
  try {
    const uuid = (globalThis.crypto as any)?.randomUUID?.();
    if (uuid && typeof uuid === 'string') return `prov_${uuid}`;
  } catch {
    // ignore
  }
  // Fallback: timestamp + random.
  const rnd = Math.random().toString(16).slice(2);
  return `prov_${Date.now().toString(16)}_${rnd}`;
}

function newAIProviderDraft(): AIProviderRow {
  const defaultType: AIProviderType = 'openai';
  const defaultPresetModels = recommendedModelsForProviderType(defaultType);
  const firstPreset = defaultPresetModels[0];
  const firstModelName = String(firstPreset?.model_name ?? '').trim();
  return normalizeAIProviderRowDraft({
    id: newProviderID(),
    name: providerPresetForType(defaultType).name,
    type: defaultType,
    base_url: defaultBaseURLForProviderType(defaultType),
    models: [
      {
        model_name: firstModelName,
        context_window: normalizePositiveInteger(firstPreset?.context_window),
        max_output_tokens: normalizePositiveInteger(firstPreset?.max_output_tokens),
        effective_context_window_percent: normalizeEffectiveContextPercent(firstPreset?.effective_context_window_percent),
      },
    ],
  });
}

function defaultPermissionPolicy(): PermissionPolicy {
  return { schema_version: 1, local_max: { read: true, write: false, execute: true } };
}

function defaultAIConfig(): AIConfig {
  return {
    current_model_id: 'openai/gpt-5.2-mini',
    execution_policy: {
      require_user_approval: false,
      block_dangerous_commands: false,
    },
    terminal_exec_policy: {
      default_timeout_ms: 120000,
      max_timeout_ms: 600000,
    },
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        base_url: 'https://api.openai.com/v1',
        models: [
          {
            model_name: 'gpt-5.2-mini',
            context_window: 400000,
            max_output_tokens: 128000,
            effective_context_window_percent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
          },
        ],
      },
    ],
  };
}

function normalizeAIProviderWebSearchMode(raw: unknown): AIProviderWebSearchMode {
  const mode = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (mode === 'openai_builtin' || mode === 'brave') return mode;
  return 'disabled';
}

function normalizeAIProviderWebSearchForType(providerType: AIProviderType, raw: unknown): { mode: AIProviderWebSearchMode } | undefined {
  if (!providerNeedsWebSearchConfig(providerType)) return undefined;
  const source = isJSONObject(raw) ? (raw as any).mode : raw;
  return { mode: normalizeAIProviderWebSearchMode(source) };
}

function providerWebSearchSummary(provider: AIProviderRow): string {
  const builtInLabel = providerBuiltInWebSearchLabel(provider.type);
  if (builtInLabel) return builtInLabel;
  if (!providerNeedsWebSearchConfig(provider.type)) return 'Not supported';
  switch (normalizeAIProviderWebSearchMode(provider.web_search?.mode)) {
    case 'openai_builtin':
      return 'OpenAI Responses built-in';
    case 'brave':
      return 'Brave web.search';
    default:
      return 'Disabled';
  }
}

type AIModelOption = Readonly<{ id: string; label: string }>;

function collectAIModelOptions(rows: AIProviderRow[]): AIModelOption[] {
  const options: AIModelOption[] = [];
  for (const p of Array.isArray(rows) ? rows : []) {
    const providerID = String(p?.id ?? '').trim();
    if (!providerID) continue;
    const providerName = String(p?.name ?? '').trim() || providerID;
    for (const m of Array.isArray(p?.models) ? p.models : []) {
      const modelName = String(m?.model_name ?? '').trim();
      if (!modelName) continue;
      options.push({
        id: modelID(providerID, modelName),
        label: `${providerName} / ${modelName}`,
      });
    }
  }
  return options;
}

function normalizeAICurrentModelID(raw: string, rows: AIProviderRow[]): string {
  const current = String(raw ?? '').trim();
  const options = collectAIModelOptions(rows);
  if (options.length === 0) return '';
  if (options.some((it) => it.id === current)) return current;
  return options[0].id;
}

function isJSONObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseJSONOrThrow(raw: string): any {
  const t = String(raw ?? '').trim();
  if (!t) throw new Error('Please provide JSON.');
  try {
    return JSON.parse(t);
  } catch {
    throw new Error('Invalid JSON.');
  }
}

function normalizePortRange(min: number, max: number): { use_default: boolean; effective_min: number; effective_max: number } {
  let m = Number(min);
  let M = Number(max);
  if (!Number.isFinite(m)) m = 0;
  if (!Number.isFinite(M)) M = 0;

  if (m <= 0 || M <= 0 || M > 65535 || m >= M) {
    return { use_default: true, effective_min: DEFAULT_CODE_SERVER_PORT_MIN, effective_max: DEFAULT_CODE_SERVER_PORT_MAX };
  }
  if (m < 1024) m = 1024;
  if (M < 1024) M = 1024;
  if (m >= M) {
    return { use_default: true, effective_min: DEFAULT_CODE_SERVER_PORT_MIN, effective_max: DEFAULT_CODE_SERVER_PORT_MAX };
  }
  return { use_default: false, effective_min: m, effective_max: M };
}

function mapToPermissionRows(m: Record<string, PermissionSet> | undefined): PermissionRow[] {
  if (!m) return [];
  const keys = Object.keys(m);
  keys.sort();
  return keys.map((k) => ({
    key: k,
    read: !!m[k]?.read,
    write: !!m[k]?.write,
    execute: !!m[k]?.execute,
  }));
}

function normalizeRepoInput(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

function formatRuntimeServiceOwner(snapshot: RuntimeServiceSnapshot | undefined): string {
  if (!snapshot) return 'Unknown';
  if (snapshot.serviceOwner === 'desktop' || snapshot.desktopManaged) return 'Redeven Desktop';
  if (snapshot.serviceOwner === 'external') return 'External service';
  return 'Unknown';
}

function formatRuntimeServiceCompatibility(snapshot: RuntimeServiceSnapshot | undefined): string {
  const value = String(snapshot?.compatibility ?? 'unknown').trim();
  switch (value) {
    case 'compatible':
      return 'Compatible';
    case 'update_available':
      return 'Update available';
    case 'restart_recommended':
      return 'Restart recommended';
    case 'update_required':
      return 'Update required';
    case 'desktop_update_required':
      return 'Desktop update required';
    case 'managed_elsewhere':
      return 'Managed elsewhere';
    default:
      return 'Unknown';
  }
}

function runtimeServiceCompatibilityTone(snapshot: RuntimeServiceSnapshot | undefined): 'default' | 'warning' | 'success' {
  switch (snapshot?.compatibility) {
    case 'compatible':
      return 'success';
    case 'update_available':
    case 'restart_recommended':
    case 'update_required':
    case 'desktop_update_required':
    case 'managed_elsewhere':
      return 'warning';
    default:
      return 'default';
  }
}

function formatRuntimeServiceWorkload(snapshot: RuntimeServiceSnapshot | undefined): string {
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

function formatDesktopBrokerBindingState(value: unknown): string {
  switch (String(value ?? '').trim()) {
    case 'bound':
      return 'Bound';
    case 'unbound':
      return 'Unbound';
    case 'unsupported':
      return 'Unsupported';
    case 'expired':
      return 'Expired';
    case 'error':
      return 'Error';
    default:
      return 'Unknown';
  }
}

function desktopBrokerBindingTone(value: unknown): 'default' | 'warning' | 'success' {
  switch (String(value ?? '').trim()) {
    case 'bound':
      return 'success';
    case 'unsupported':
    case 'expired':
    case 'error':
      return 'warning';
    default:
      return 'default';
  }
}

function formatDesktopBrokerNotice(bindingState: unknown, status: { connected?: boolean; available?: boolean; last_error?: string } | null): string {
  switch (String(bindingState ?? '').trim()) {
    case 'bound':
      if (status?.available) {
        return 'Desktop is providing a session model bridge for this SSH environment. Remote provider settings remain local to this host.';
      }
      return 'Desktop is connected, but no usable model is available yet. Configure the local API key on this computer.';
    case 'unsupported':
      return 'This SSH runtime does not support Desktop model bridge binding yet. Restart the remote runtime, then try again when it is safe to interrupt active work.';
    case 'expired':
      return 'Desktop model bridge access expired. Reopen the SSH environment to bind a fresh session.';
    case 'error':
      return status?.last_error
        ? `Desktop model bridge binding failed: ${status.last_error}`
        : 'Desktop model bridge binding failed. Reopen the SSH environment to retry.';
    default:
      if (status?.available) {
        return 'Desktop is providing a session model bridge for this SSH environment. Remote provider settings remain local to this host.';
      }
      if (status?.connected) {
        return 'Desktop is connected, but no usable model is available yet. Configure the local API key on this computer.';
      }
      return 'Flower is currently disabled. Once the settings below become valid, Flower will be enabled automatically.';
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function EnvSettingsPage() {
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
  const debugConsoleEnabled = createMemo(() => env.debugConsoleEnabled());

  // Settings quick-jump directory (sidebar/select).
  const [activeSection, setActiveSection] = createSignal<EnvSettingsSection>('config');
  let scrollEl: HTMLDivElement | undefined;

  const scrollToSection = (section: EnvSettingsSection, behavior: ScrollBehavior = 'smooth') => {
    const el = document.getElementById(settingsSectionElementID(section));
    if (!el) return;
    setActiveSection(section);
    el.scrollIntoView({ behavior, block: 'start' });
  };

  let scrollRAF = 0;
  const updateActiveFromScroll = () => {
    if (!scrollEl) return;
    const threshold = 96;
    const containerTop = scrollEl.getBoundingClientRect().top;

    let current: EnvSettingsSection | null = null;
    for (const it of SETTINGS_NAV_ITEMS) {
      const el = document.getElementById(settingsSectionElementID(it.id));
      if (!el) continue;
      const top = el.getBoundingClientRect().top - containerTop;
      if (top - threshold <= 0) {
        current = it.id;
        continue;
      }
      if (!current) current = it.id;
      break;
    }

    if (current) setActiveSection(current);
  };

  onMount(() => {
    if (!scrollEl) return;
    const onScroll = () => {
      if (scrollRAF) cancelAnimationFrame(scrollRAF);
      scrollRAF = requestAnimationFrame(updateActiveFromScroll);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    updateActiveFromScroll();
    onCleanup(() => {
      scrollEl?.removeEventListener('scroll', onScroll);
      if (scrollRAF) cancelAnimationFrame(scrollRAF);
    });
  });

  // ============================================================================
  // Runtime maintenance actions (E2EE, data plane)
  // ============================================================================

  const canAdmin = createMemo(() => !!env.env()?.permissions?.can_admin || !!env.env()?.permissions?.is_owner);
  const controlplaneStatus = createMemo(() => (env.env()?.status ? String(env.env()!.status) : ''));
  const latestVersion = createMemo(() => runtimeUpdate.version.latestMeta());
  const latestVersionLoading = createMemo(() => runtimeUpdate.version.latestMetaLoading());
  const latestVersionError = createMemo(() => runtimeUpdate.version.latestMetaError());
  const upgradeState = createMemo(() => resolveAgentUpgradeState(latestVersion()));
  const displayedStatus = createMemo(() => runtimeUpdate.maintenance.displayedStatus());
  const maintenanceStage = createMemo(() => runtimeUpdate.maintenance.stage());
  const maintenanceError = createMemo(() => runtimeUpdate.maintenance.error());
  const maintaining = createMemo(() => runtimeUpdate.maintenance.maintaining());
  const isUpgrading = createMemo(() => runtimeUpdate.maintenance.isUpgrading());
  const isRestarting = createMemo(() => runtimeUpdate.maintenance.isRestarting());
  const runtimeService = createMemo(() => runtimeUpdate.version.runtimeService());
  const activeWorkSummary = createMemo(() => formatRuntimeServiceWorkload(runtimeService()));
  const runtimeDesktopBrokerBinding = createMemo(() => runtimeService()?.bindings?.desktopAiBroker);

  createEffect(() => {
    if (codeRuntimeStatus()?.operation.state !== 'running') return;
    const timer = window.setInterval(() => {
      void refetchCodeRuntimeStatus();
    }, 1000);
    onCleanup(() => {
      window.clearInterval(timer);
    });
  });

  createEffect(() => {
    const pendingAction = pendingRuntimeSuccessAction();
    if (!pendingAction) return;

    const status = codeRuntimeStatus();
    if (!status) return;

    const operationAction = String(status.operation.action ?? '').trim();
    if (status.operation.state === 'running') return;

    if (codeRuntimeOperationSucceeded(status) && operationAction === pendingAction) {
      if (pendingAction === 'remove_local_environment_version') {
        notify.success('Version removed', 'The selected managed code-server version has been removed from the Local Environment inventory.');
      } else {
        notify.success('Runtime ready', 'The latest managed code-server runtime is now installed for this Local Environment and selected for the current environment.');
      }
      setPendingRuntimeSuccessAction('');
      return;
    }

    if (codeRuntimeOperationNeedsAttention(status) && operationAction === pendingAction) {
      setPendingRuntimeSuccessAction('');
    }
  });

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

  const [upgradeOpen, setUpgradeOpen] = createSignal(false);
  const [restartOpen, setRestartOpen] = createSignal(false);
  const statusLabel = createMemo(() => formatAgentStatusLabel(displayedStatus()));

  const refreshSettingsPage = async () => {
    await Promise.allSettled([
      refetch(),
      runtimeUpdate.version.refetchLatestVersion(),
    ]);
  };

  const agentCardBadge = createMemo(() => {
    if (isUpgrading()) return 'Updating';
    if (isRestarting()) return 'Restarting';
    return statusLabel();
  });
  const agentCardBadgeVariant = createMemo<'default' | 'warning' | 'success'>(() => {
    if (maintaining()) return 'warning';
    const st = displayedStatus();
    if (st === 'online') return 'success';
    if (st === 'offline') return 'warning';
    return 'default';
  });

  const canStartUpgrade = createMemo(() => {
    if (maintaining()) return false;
    if (!upgradeState().allowsUpgradeAction) return false;
    if (protocol.status() !== 'connected') return false;
    if (!targetUpgradeVersionValid()) return false;
    if (!canAdmin()) return false;
    return controlplaneStatus() === 'online';
  });

  const canStartRestart = createMemo(() => {
    if (maintaining()) return false;
    if (protocol.status() !== 'connected') return false;
    if (!canAdmin()) return false;
    return controlplaneStatus() === 'online';
  });

  const startUpgrade = async () => {
    try {
      if (upgradeState().policy === 'desktop_release') {
        const desktopResult = await manageDesktopUpdate();
        if (!desktopResult?.ok && upgradeState().releasePageURL) {
          await openExternalURLInDesktopShell(upgradeState().releasePageURL);
        }
        return;
      }
      await runtimeUpdate.maintenance.startUpgrade(targetUpgradeVersion());
    } finally {
      setUpgradeOpen(false);
    }
  };
  const startRestart = async () => {
    try {
      await runtimeUpdate.maintenance.startRestart();
    } finally {
      setRestartOpen(false);
    }
  };

  const connectOverlayMessage = createMemo(() => (maintaining() ? 'Runtime restarting...' : env.connectionOverlayMessage()));
  const loadingCurtain = createMemo(() => {
    if (env.connectionOverlayVisible()) {
      return {
        visible: true,
        surface: 'page' as const,
        eyebrow: 'Runtime',
        message: connectOverlayMessage(),
      };
    }
    if (settings.loading && protocol.status() === 'connected') {
      return {
        visible: true,
        surface: undefined,
        eyebrow: 'Settings',
        message: 'Loading settings...',
      };
    }
    return {
      visible: false,
      surface: undefined,
      eyebrow: 'Settings',
      message: '',
    };
  });

  // View mode signals
  const [configView, setConfigView] = createSignal<ViewMode>('ui');
  const [connectionView, setConnectionView] = createSignal<ViewMode>('ui');
  const [runtimeView, setRuntimeView] = createSignal<ViewMode>('ui');
  const [loggingView, setLoggingView] = createSignal<ViewMode>('ui');
  const [codespacesView, setCodespacesView] = createSignal<ViewMode>('ui');
  const [policyView, setPolicyView] = createSignal<ViewMode>('ui');
  const [aiView, setAiView] = createSignal<ViewMode>('ui');
  const [codeRuntimeActionLoading, setCodeRuntimeActionLoading] = createSignal(false);
  const [codeRuntimeCancelLoading, setCodeRuntimeCancelLoading] = createSignal(false);
  const [codeRuntimeSelectionLoadingVersion, setCodeRuntimeSelectionLoadingVersion] = createSignal<string | null>(null);
  const [codeRuntimeRemoveVersionLoading, setCodeRuntimeRemoveVersionLoading] = createSignal<string | null>(null);
  const [pendingRuntimeSuccessAction, setPendingRuntimeSuccessAction] = createSignal<'' | 'install' | 'remove_local_environment_version'>('');

  // Dirty flags
  const [runtimeDirty, setRuntimeDirty] = createSignal(false);
  const [loggingDirty, setLoggingDirty] = createSignal(false);
  const [codespacesDirty, setCodespacesDirty] = createSignal(false);
  const refreshCodexHostStatus = async () => {
    try {
      await refetchCodexStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Codex status refresh failed', msg || 'Request failed.');
    }
  };
  const refreshCodeRuntimeStatus = async () => {
    try {
      await refetchCodeRuntimeStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Runtime status refresh failed', msg || 'Request failed.');
    }
  };
  const installManagedCodeRuntime = async () => {
    setCodeRuntimeActionLoading(true);
    setPendingRuntimeSuccessAction('install');
    try {
      await installCodeRuntime();
      await refetchCodeRuntimeStatus();
    } catch (e) {
      setPendingRuntimeSuccessAction('');
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Install failed', msg || 'Request failed.');
    } finally {
      setCodeRuntimeActionLoading(false);
    }
  };
  const selectManagedCodeRuntimeVersion = async (version: string) => {
    setCodeRuntimeSelectionLoadingVersion(version);
    try {
      await selectCodeRuntimeVersion(version);
      await refetchCodeRuntimeStatus();
      notify.success('Local Environment updated', `This Local Environment now uses managed version ${version}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Selection failed', msg || 'Request failed.');
    } finally {
      setCodeRuntimeSelectionLoadingVersion(null);
    }
  };
  const removeManagedCodeRuntimeVersion = async (version: string) => {
    setCodeRuntimeRemoveVersionLoading(version);
    setPendingRuntimeSuccessAction('remove_local_environment_version');
    try {
      await removeCodeRuntimeVersion(version);
      await refetchCodeRuntimeStatus();
    } catch (e) {
      setPendingRuntimeSuccessAction('');
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Version removal failed', msg || 'Request failed.');
    } finally {
      setCodeRuntimeRemoveVersionLoading(null);
    }
  };
  const cancelManagedCodeRuntimeOperation = async () => {
    setCodeRuntimeCancelLoading(true);
    try {
      await cancelCodeRuntimeOperation();
      await refetchCodeRuntimeStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Cancel failed', msg || 'Request failed.');
    } finally {
      setCodeRuntimeCancelLoading(false);
    }
  };
  const [policyDirty, setPolicyDirty] = createSignal(false);
  const [aiDirty, setAiDirty] = createSignal(false);

  // Runtime fields
  const [agentHomeDir, setAgentHomeDir] = createSignal('');
  const [shell, setShell] = createSignal('');

  // Logging fields
  const [logFormat, setLogFormat] = createSignal('');
  const [logLevel, setLogLevel] = createSignal('');

  // Codespaces fields
  const [useDefaultCodePorts, setUseDefaultCodePorts] = createSignal(true);
  const [codePortMin, setCodePortMin] = createSignal<number | ''>('');
  const [codePortMax, setCodePortMax] = createSignal<number | ''>('');

  // Permission policy fields
  const [policyLocalRead, setPolicyLocalRead] = createSignal(true);
  const [policyLocalWrite, setPolicyLocalWrite] = createSignal(false);
  const [policyLocalExecute, setPolicyLocalExecute] = createSignal(true);
  const [policyByUser, setPolicyByUser] = createSignal<PermissionRow[]>([]);
  const [policyByApp, setPolicyByApp] = createSignal<PermissionRow[]>([]);

  // AI fields
  const [aiProviders, setAiProviders] = createSignal<AIProviderRow[]>([
    {
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      base_url: 'https://api.openai.com/v1',
      models: [{ model_name: 'gpt-5.2-mini', context_window: 400000, max_output_tokens: 128000, effective_context_window_percent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT }],
    },
  ]);
  const [aiCurrentModelID, setAiCurrentModelID] = createSignal('openai/gpt-5.2-mini');
  const [aiPreservedFields, setAiPreservedFields] = createSignal<AIPreservedUIFields>({});
  const [aiRequireUserApproval, setAiRequireUserApproval] = createSignal(false);
  const [aiBlockDangerousCommands, setAiBlockDangerousCommands] = createSignal(false);
  const [aiProviderDialogOpen, setAiProviderDialogOpen] = createSignal(false);
  const [aiProviderDialogMode, setAiProviderDialogMode] = createSignal<AIProviderDialogMode>('edit');
  const [aiProviderDialogSourceIndex, setAiProviderDialogSourceIndex] = createSignal<number | null>(null);
  const [aiProviderDialogDraft, setAiProviderDialogDraft] = createSignal<AIProviderRow | null>(null);
  const [aiProviderPresetModel, setAiProviderPresetModel] = createSignal('');

  // AI provider keys (stored locally in secrets.json; never returned in plaintext).
  const [aiProviderKeySet, setAiProviderKeySet] = createSignal<Record<string, boolean>>({});
  const [aiProviderKeyDraft, setAiProviderKeyDraft] = createSignal<Record<string, string>>({});
  const [aiProviderKeySaving, setAiProviderKeySaving] = createSignal<Record<string, boolean>>({});

  // Provider-scoped web search keys (stored locally in secrets.json; never returned in plaintext).
  const [webSearchKeySet, setWebSearchKeySet] = createSignal<Record<string, boolean>>({});
  const [webSearchKeyDraft, setWebSearchKeyDraft] = createSignal<Record<string, string>>({});
  const [webSearchKeySaving, setWebSearchKeySaving] = createSignal<Record<string, boolean>>({});

  const [skillsCatalog, setSkillsCatalog] = createSignal<SkillsCatalogResponse | null>(null);
  const [skillsLoading, setSkillsLoading] = createSignal(false);
  const [skillsReloading, setSkillsReloading] = createSignal(false);
  const [skillsError, setSkillsError] = createSignal<string | null>(null);
  const [skillQuery, setSkillQuery] = createSignal('');
  const [skillScopeFilter, setSkillScopeFilter] = createSignal<'all' | 'user' | 'user_agents'>('all');
  const [skillToggleSaving, setSkillToggleSaving] = createSignal<Record<string, boolean>>({});
  const [skillCreateOpen, setSkillCreateOpen] = createSignal(false);
  const [skillCreateScope, setSkillCreateScope] = createSignal<'user' | 'user_agents'>('user');
  const [skillCreateName, setSkillCreateName] = createSignal('');
  const [skillCreateDescription, setSkillCreateDescription] = createSignal('');
  const [skillCreateBody, setSkillCreateBody] = createSignal('');
  const [skillCreateSaving, setSkillCreateSaving] = createSignal(false);
  const [skillDeleteOpen, setSkillDeleteOpen] = createSignal(false);
  const [skillDeleteSaving, setSkillDeleteSaving] = createSignal(false);
  const [skillDeleteTarget, setSkillDeleteTarget] = createSignal<SkillCatalogEntry | null>(null);
  const [skillSources, setSkillSources] = createSignal<Record<string, SkillSourceItem>>({});
  const [, setSkillSourcesLoading] = createSignal(false);
  const [skillReinstalling, setSkillReinstalling] = createSignal<Record<string, boolean>>({});

  const [skillInstallOpen, setSkillInstallOpen] = createSignal(false);
  const [skillInstallScope, setSkillInstallScope] = createSignal<'user' | 'user_agents'>('user');
  const [skillInstallURL, setSkillInstallURL] = createSignal('');
  const [skillInstallRepo, setSkillInstallRepo] = createSignal('openai/skills');
  const [skillInstallRef, setSkillInstallRef] = createSignal('main');
  const [skillInstallPaths, setSkillInstallPaths] = createSignal('skills/.curated/skill-installer');
  const [skillInstallOverwrite, setSkillInstallOverwrite] = createSignal(false);
  const [skillInstallValidating, setSkillInstallValidating] = createSignal(false);
  const [skillInstallSaving, setSkillInstallSaving] = createSignal(false);
  const [skillInstallResolved, setSkillInstallResolved] = createSignal<SkillGitHubValidateItem[]>([]);
  const [skillGitHubCatalog, setSkillGitHubCatalog] = createSignal<SkillGitHubCatalogResponse | null>(null);
  const [skillGitHubCatalogLoading, setSkillGitHubCatalogLoading] = createSignal(false);

  const [skillBrowseOpen, setSkillBrowseOpen] = createSignal(false);
  const [skillBrowseTarget, setSkillBrowseTarget] = createSignal<SkillCatalogEntry | null>(null);
  const [skillBrowseDir, setSkillBrowseDir] = createSignal('.');
  const [skillBrowseTree, setSkillBrowseTree] = createSignal<SkillBrowseTreeResponse | null>(null);
  const [skillBrowseTreeLoading, setSkillBrowseTreeLoading] = createSignal(false);
  const [skillBrowseFileLoading, setSkillBrowseFileLoading] = createSignal(false);
  const [skillBrowseFile, setSkillBrowseFile] = createSignal<SkillBrowseFileResponse | null>(null);

  // JSON editor values
  const [runtimeJSON, setRuntimeJSON] = createSignal('');
  const [loggingJSON, setLoggingJSON] = createSignal('');
  const [codespacesJSON, setCodespacesJSON] = createSignal('');
  const [policyJSON, setPolicyJSON] = createSignal('');
  const [aiJSON, setAiJSON] = createSignal('');

  // Saving states
  const [runtimeSaving, setRuntimeSaving] = createSignal(false);
  const [loggingSaving, setLoggingSaving] = createSignal(false);
  const [codespacesSaving, setCodespacesSaving] = createSignal(false);
  const [policySaving, setPolicySaving] = createSignal(false);
  const [aiSaving, setAiSaving] = createSignal(false);
  const [runtimeSavedAt, setRuntimeSavedAt] = createSignal<number | null>(null);
  const [loggingSavedAt, setLoggingSavedAt] = createSignal<number | null>(null);
  const [codespacesSavedAt, setCodespacesSavedAt] = createSignal<number | null>(null);
  const [policySavedAt, setPolicySavedAt] = createSignal<number | null>(null);
  const [aiSavedAt, setAiSavedAt] = createSignal<number | null>(null);
  const [disableAIOpen, setDisableAIOpen] = createSignal(false);
  const [disableAISaving, setDisableAISaving] = createSignal(false);

  // Error states
  const [runtimeError, setRuntimeError] = createSignal<string | null>(null);
  const [loggingError, setLoggingError] = createSignal<string | null>(null);
  const [codespacesError, setCodespacesError] = createSignal<string | null>(null);
  const [policyError, setPolicyError] = createSignal<string | null>(null);
  const [aiError, setAiError] = createSignal<string | null>(null);

  const aiEnabled = createMemo(() => !!settings()?.ai);
  const desktopBrokerStatus = createMemo(() => settings()?.ai_runtime?.desktop_broker ?? null);
  const desktopBrokerBindingState = createMemo(() => (
    String(desktopBrokerStatus()?.binding_state ?? runtimeDesktopBrokerBinding()?.state ?? '').trim()
  ));
  const flowerBadge = createMemo(() => {
    if (aiEnabled()) return 'Remote config';
    if (desktopBrokerBindingState() === 'bound' && desktopBrokerStatus()?.available) return 'Desktop broker';
    if (desktopBrokerBindingState() === 'bound') return 'Desktop bound';
    if (desktopBrokerStatus()?.available) return 'Desktop broker';
    if (desktopBrokerStatus()?.connected) return 'Desktop connected';
    return 'Disabled';
  });
  const flowerBadgeVariant = createMemo<'default' | 'warning' | 'success'>(() => {
    if (aiEnabled() || desktopBrokerBindingState() === 'bound' || desktopBrokerStatus()?.available) return 'success';
    if (desktopBrokerBindingState() === 'unsupported' || desktopBrokerBindingState() === 'expired' || desktopBrokerBindingState() === 'error') {
      return 'warning';
    }
    return 'default';
  });
  const codexStatusError = createMemo(() => {
    const payloadError = String(codexStatus()?.error ?? '').trim();
    if (payloadError) return payloadError;
    const err = codexStatus.error;
    if (!err) return null;
    return err instanceof Error ? err.message : String(err);
  });
  const codexStatusRows = createMemo(() => {
    const current = codexStatus();
    return [
      {
        label: 'host_binary_detected',
        value: current?.available ? 'Yes' : 'No',
        note: 'Whether Redeven can resolve `codex` from the host PATH.',
      },
      {
        label: 'bridge_state',
        value: current?.ready ? 'Connected' : 'On-demand',
        note: 'The app-server bridge starts only when the Codex workspace needs it.',
      },
      {
        label: 'binary_path',
        value: current?.binary_path || 'Not detected',
        note: 'Resolved host binary used for Codex sessions.',
        mono: true,
      },
      {
        label: 'agent_home_dir',
        value: current?.agent_home_dir || 'Not detected',
        note: 'Current runtime home directory exposed to the Codex bridge.',
        mono: true,
      },
      {
        label: 'error',
        value: codexStatusError() || 'None',
        note: 'Latest host capability or bridge startup error, if any.',
      },
    ] as const;
  });
  const codeRuntimeStatusError = createMemo(() => {
    const err = codeRuntimeStatus.error;
    if (!err) return null;
    return err instanceof Error ? err.message : String(err);
  });
  const aiModelOptions = createMemo(() => collectAIModelOptions(aiProviders()));
  const aiProviderDialogProvider = createMemo(() => aiProviderDialogDraft());
  const aiProviderDialogRecommendedModels = createMemo<readonly AIProviderModelPreset[]>(() => {
    const provider = aiProviderDialogProvider();
    if (!provider) return [];
    return recommendedModelsForProviderType(provider.type);
  });
  const aiProviderDialogRecommendedModelOptions = createMemo(() =>
    aiProviderDialogRecommendedModels().map((model) => {
      const output = model.max_output_tokens ? ` / max ${formatTokenCount(model.max_output_tokens)}` : '';
      return {
        value: model.model_name,
        label: `${model.model_name} (ctx ${formatTokenCount(model.context_window)}${output})`,
      };
    }),
  );
  const aiProviderDialogTitle = createMemo(() => (aiProviderDialogMode() === 'create' ? 'Add provider' : 'Edit provider'));

  const configPath = () => String(settings()?.config_path ?? '').trim();

  const configJSONText = createMemo(() => JSON.stringify({ config_path: configPath() || '' }, null, 2));
  const connectionJSONText = createMemo(() => JSON.stringify(settings()?.connection ?? null, null, 2));

  const buildRuntimePatch = () => ({ agent_home_dir: String(agentHomeDir() ?? ''), shell: String(shell() ?? '') });
  const buildLoggingPatch = () => ({ log_format: String(logFormat() ?? ''), log_level: String(logLevel() ?? '') });
  const buildCodespacesPatch = () => {
    if (useDefaultCodePorts()) return { code_server_port_min: 0, code_server_port_max: 0 };
    const min = codePortMin();
    const max = codePortMax();
    return { code_server_port_min: Number(min), code_server_port_max: Number(max) };
  };

  const buildPolicyValue = (): PermissionPolicy => {
    const localMax: PermissionSet = {
      read: !!policyLocalRead(),
      write: !!policyLocalWrite(),
      execute: !!policyLocalExecute(),
    };
    return buildPermissionPolicyValue(localMax, policyByUser(), policyByApp());
  };

  const buildAIValue = (): AIConfig => {
    const providers = aiProviders().map((p) => {
      const out: any = {
        id: String(p.id ?? '').trim(),
        type: p.type,
        models: [] as AIProviderModel[],
      };
      const name = String(p.name ?? '').trim();
      if (name) out.name = name;
      const baseURL = String(p.base_url ?? '').trim();
      if (baseURL) out.base_url = baseURL;
      const webSearch = normalizeAIProviderWebSearchForType(p.type, p.web_search);
      if (webSearch) out.web_search = webSearch;
      out.models = (p.models ?? []).map((m) => {
        const modelOut: any = { model_name: String(m.model_name ?? '').trim() };
        const contextWindow = normalizePositiveInteger(m.context_window);
        if (contextWindow != null) modelOut.context_window = contextWindow;
        const maxOutputTokens = normalizePositiveInteger(m.max_output_tokens);
        if (maxOutputTokens != null) modelOut.max_output_tokens = maxOutputTokens;
        const effectiveContextPercent = normalizeEffectiveContextPercent(m.effective_context_window_percent);
        if (effectiveContextPercent != null) modelOut.effective_context_window_percent = effectiveContextPercent;
        return modelOut as AIProviderModel;
      });

      return out as AIProvider;
    });

    const preserved = aiPreservedFields();
    const currentModelID = normalizeAICurrentModelID(aiCurrentModelID(), aiProviders());
    if (!currentModelID) throw new Error('Flower JSON is missing current_model_id.');

    const out: any = { current_model_id: currentModelID, providers };
    if (preserved.mode === 'act' || preserved.mode === 'plan') out.mode = preserved.mode;
    if (typeof preserved.tool_recovery_enabled === 'boolean') out.tool_recovery_enabled = preserved.tool_recovery_enabled;
    if (typeof preserved.tool_recovery_max_steps === 'number' && Number.isFinite(preserved.tool_recovery_max_steps)) {
      out.tool_recovery_max_steps = Math.trunc(preserved.tool_recovery_max_steps);
    }
    if (typeof preserved.tool_recovery_allow_path_rewrite === 'boolean') {
      out.tool_recovery_allow_path_rewrite = preserved.tool_recovery_allow_path_rewrite;
    }
    if (typeof preserved.tool_recovery_allow_probe_tools === 'boolean') {
      out.tool_recovery_allow_probe_tools = preserved.tool_recovery_allow_probe_tools;
    }
    if (typeof preserved.tool_recovery_fail_on_repeated_signature === 'boolean') {
      out.tool_recovery_fail_on_repeated_signature = preserved.tool_recovery_fail_on_repeated_signature;
    }
    if (preserved.terminal_exec_policy) {
      out.terminal_exec_policy = {
        ...preserved.terminal_exec_policy,
      };
    }
    out.execution_policy = {
      require_user_approval: !!aiRequireUserApproval(),
      block_dangerous_commands: !!aiBlockDangerousCommands(),
    };
    return out as AIConfig;
  };

  const validateAIValue = (cfg: AIConfig) => {
    const mode = String((cfg as any).mode ?? '').trim();
    if (mode && mode !== 'act' && mode !== 'plan') throw new Error(`Invalid Flower mode: ${mode}`);
    const trEnabled = (cfg as any).tool_recovery_enabled;
    if (trEnabled !== undefined && typeof trEnabled !== 'boolean') {
      throw new Error('tool_recovery_enabled must be a boolean.');
    }
    const trMax = (cfg as any).tool_recovery_max_steps;
    if (trMax !== undefined) {
      if (typeof trMax !== 'number' || !Number.isFinite(trMax) || !Number.isInteger(trMax)) {
        throw new Error('tool_recovery_max_steps must be an integer.');
      }
      if (trMax < 0 || trMax > 8) throw new Error('tool_recovery_max_steps must be in [0,8].');
    }
    const trPath = (cfg as any).tool_recovery_allow_path_rewrite;
    if (trPath !== undefined && typeof trPath !== 'boolean') {
      throw new Error('tool_recovery_allow_path_rewrite must be a boolean.');
    }
    const trProbe = (cfg as any).tool_recovery_allow_probe_tools;
    if (trProbe !== undefined && typeof trProbe !== 'boolean') {
      throw new Error('tool_recovery_allow_probe_tools must be a boolean.');
    }
    const trFail = (cfg as any).tool_recovery_fail_on_repeated_signature;
    if (trFail !== undefined && typeof trFail !== 'boolean') {
      throw new Error('tool_recovery_fail_on_repeated_signature must be a boolean.');
    }

    const ep = (cfg as any).execution_policy;
    if (ep !== undefined && ep !== null) {
      if (!isJSONObject(ep)) throw new Error('execution_policy must be an object.');
      if ((ep as any).require_user_approval !== undefined && typeof (ep as any).require_user_approval !== 'boolean') {
        throw new Error('execution_policy.require_user_approval must be a boolean.');
      }
      if ((ep as any).block_dangerous_commands !== undefined && typeof (ep as any).block_dangerous_commands !== 'boolean') {
        throw new Error('execution_policy.block_dangerous_commands must be a boolean.');
      }
    }
    const terminalExecPolicy = (cfg as any).terminal_exec_policy;
    if (terminalExecPolicy !== undefined && terminalExecPolicy !== null) {
      if (!isJSONObject(terminalExecPolicy)) throw new Error('terminal_exec_policy must be an object.');
      const defaultTimeoutMS = (terminalExecPolicy as any).default_timeout_ms;
      const maxTimeoutMS = (terminalExecPolicy as any).max_timeout_ms;
      if (defaultTimeoutMS !== undefined) {
        if (typeof defaultTimeoutMS !== 'number' || !Number.isFinite(defaultTimeoutMS) || !Number.isInteger(defaultTimeoutMS)) {
          throw new Error('terminal_exec_policy.default_timeout_ms must be an integer.');
        }
        if (defaultTimeoutMS < 1 || defaultTimeoutMS > 600000) {
          throw new Error('terminal_exec_policy.default_timeout_ms must be in [1,600000].');
        }
      }
      if (maxTimeoutMS !== undefined) {
        if (typeof maxTimeoutMS !== 'number' || !Number.isFinite(maxTimeoutMS) || !Number.isInteger(maxTimeoutMS)) {
          throw new Error('terminal_exec_policy.max_timeout_ms must be an integer.');
        }
        if (maxTimeoutMS < 1 || maxTimeoutMS > 600000) {
          throw new Error('terminal_exec_policy.max_timeout_ms must be in [1,600000].');
        }
      }
      if (
        typeof defaultTimeoutMS === 'number' &&
        Number.isFinite(defaultTimeoutMS) &&
        typeof maxTimeoutMS === 'number' &&
        Number.isFinite(maxTimeoutMS) &&
        defaultTimeoutMS > maxTimeoutMS
      ) {
        throw new Error('terminal_exec_policy.default_timeout_ms must not exceed max_timeout_ms.');
      }
    }

    const providers = Array.isArray((cfg as any).providers) ? (cfg as any).providers : [];
    if (providers.length === 0) throw new Error('Missing providers.');

    const providerIDs = new Set<string>();
    const modelIDs = new Set<string>();
    for (const p of providers) {
      const id = String((p as any).id ?? '').trim();
      const name = String((p as any).name ?? '').trim();
      const typ = String((p as any).type ?? '').trim();
      const baseURL = String((p as any).base_url ?? '').trim();
      const models = Array.isArray((p as any).models) ? (p as any).models : [];

      if (!id) throw new Error('Provider id is required.');
      if (id.includes('/')) throw new Error(`Provider "${id}" id must not contain "/".`);
      if (providerIDs.has(id)) throw new Error(`Duplicate provider id: ${id}`);
      providerIDs.add(id);
      if (name && name.length > 80) throw new Error(`Provider "${id}" name is too long.`);

      if (
        typ !== 'openai' &&
        typ !== 'anthropic' &&
        typ !== 'moonshot' &&
        typ !== 'chatglm' &&
        typ !== 'deepseek' &&
        typ !== 'qwen' &&
        typ !== 'openai_compatible'
      ) {
        throw new Error(`Invalid provider type: ${typ || '(empty)'}`);
      }
      if (providerTypeRequiresBaseURL(typ as AIProviderType) && !baseURL) throw new Error(`Provider "${id}" requires base_url.`);
      if (baseURL) {
        let u: URL;
        try {
          u = new URL(baseURL);
        } catch {
          throw new Error(`Provider "${id}" has invalid base_url.`);
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Provider "${id}" base_url must be http/https.`);
        if (!u.hostname) throw new Error(`Provider "${id}" base_url host is missing.`);
      }
      const webSearchRaw = (p as any).web_search;
      if (webSearchRaw !== undefined) {
        if (!isJSONObject(webSearchRaw)) throw new Error(`Provider "${id}" web_search must be an object.`);
        const webSearchMode = String((webSearchRaw as any).mode ?? '')
          .trim()
          .toLowerCase();
        if (webSearchMode && webSearchMode !== 'disabled' && webSearchMode !== 'openai_builtin' && webSearchMode !== 'brave') {
          throw new Error(`Provider "${id}" has invalid web_search.mode: ${webSearchMode}`);
        }
        if (typ !== 'openai_compatible' && webSearchMode && webSearchMode !== 'disabled') {
          throw new Error(`Provider "${id}" web_search is only supported for openai_compatible providers.`);
        }
      }

      if (models.length === 0) throw new Error(`Provider "${id}" is missing models.`);

      const modelNames = new Set<string>();
      for (const m of models) {
        const mn = String((m as any).model_name ?? '').trim();
        const contextWindowRaw = Number((m as any).context_window);
        const hasContextWindow = Number.isFinite(contextWindowRaw);
        const contextWindow = hasContextWindow ? Math.floor(contextWindowRaw) : 0;
        const maxOutputTokensRaw = Number((m as any).max_output_tokens);
        const hasMaxOutputTokens = Number.isFinite(maxOutputTokensRaw);
        const maxOutputTokens = hasMaxOutputTokens ? Math.floor(maxOutputTokensRaw) : 0;
        const effectiveContextPercentRaw = Number((m as any).effective_context_window_percent);
        const hasEffectiveContextPercent = Number.isFinite(effectiveContextPercentRaw);
        const effectiveContextPercent = hasEffectiveContextPercent ? Math.floor(effectiveContextPercentRaw) : 0;
        if ((m as any).label !== undefined) {
          throw new Error(`Provider "${id}" models[].label is not supported. Use model_name only.`);
        }
        if (!mn) throw new Error(`Provider "${id}" has a model with missing model_name.`);
        if (mn.includes('/')) throw new Error(`Provider "${id}" model_name must not contain "/".`);
        if (modelNames.has(mn)) throw new Error(`Provider "${id}" has duplicate model_name: ${mn}`);
        if (hasContextWindow && contextWindow <= 0) {
          throw new Error(`Provider "${id}" model "${mn}" context_window must be a positive integer.`);
        }
        if (typ === 'openai_compatible' && contextWindow <= 0) {
          throw new Error(`Provider "${id}" model "${mn}" requires context_window.`);
        }
        if (hasMaxOutputTokens && maxOutputTokens <= 0) {
          throw new Error(`Provider "${id}" model "${mn}" max_output_tokens must be a positive integer.`);
        }
        if (contextWindow > 0 && maxOutputTokens > contextWindow) {
          throw new Error(`Provider "${id}" model "${mn}" max_output_tokens must not exceed context_window.`);
        }
        if (hasEffectiveContextPercent && (effectiveContextPercent < 1 || effectiveContextPercent > 100)) {
          throw new Error(`Provider "${id}" model "${mn}" effective_context_window_percent must be in [1,100].`);
        }
        modelNames.add(mn);
        modelIDs.add(modelID(id, mn));
      }
    }

    const currentModelID = String((cfg as any).current_model_id ?? '').trim();
    if (!currentModelID) throw new Error('Missing current_model_id.');
    if (!modelIDs.has(currentModelID)) throw new Error(`current_model_id is not in providers[].models[]: ${currentModelID}`);
  };

  const normalizeAIProviders = (rows: AIProviderRow[]): AIProviderRow[] => {
    const list: AIProviderRow[] = (Array.isArray(rows) ? rows : []).map((p) => ({
      id: String((p as any).id ?? ''),
      name: String((p as any).name ?? ''),
      type: (p as any).type as AIProviderType,
      base_url: String((p as any).base_url ?? ''),
      web_search: normalizeAIProviderWebSearchForType((p as any).type as AIProviderType, (p as any).web_search),
      models: (Array.isArray((p as any).models) ? ((p as any).models as any[]) : []).map((m) => ({
        model_name: String(m?.model_name ?? ''),
        context_window: normalizePositiveInteger(m?.context_window),
        max_output_tokens: normalizePositiveInteger(m?.max_output_tokens),
        effective_context_window_percent: normalizeEffectiveContextPercent(m?.effective_context_window_percent),
      })),
    }));

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const models = Array.isArray(p.models) ? p.models : [];
      if (models.length === 0) {
        p.models = [{ model_name: '', context_window: defaultContextWindowForProviderType(p.type) }];
        continue;
      }
      p.models = models.map((m) => ({
        model_name: String(m?.model_name ?? ''),
        context_window: normalizeContextWindowByProvider(p.type, m?.context_window),
        max_output_tokens: normalizePositiveInteger(m?.max_output_tokens),
        effective_context_window_percent: normalizeEffectiveContextPercent(m?.effective_context_window_percent),
      }));
    }
    return list;
  };

  const providersNeedingWebSearchKeyStatus = (providers: AIProviderRow[]): string[] =>
    (Array.isArray(providers) ? providers : [])
      .filter((p) => p.type === 'openai_compatible' && normalizeAIProviderWebSearchMode(p.web_search?.mode) === 'brave')
      .map((p) => String(p.id ?? '').trim())
      .filter(Boolean);

  const readAIExecutionPolicy = (cfg: unknown) => {
    const raw = isJSONObject(cfg) ? (cfg as any).execution_policy : null;
    return {
      require_user_approval: !!(isJSONObject(raw) ? (raw as any).require_user_approval : false),
      block_dangerous_commands: !!(isJSONObject(raw) ? (raw as any).block_dangerous_commands : false),
    };
  };

  const readAIPreservedFields = (cfg: unknown): AIPreservedUIFields => {
    if (!isJSONObject(cfg)) return {};
    const modeRaw = String((cfg as any).mode ?? '').trim();
    const out: AIPreservedUIFields = {};
    if (modeRaw === 'act' || modeRaw === 'plan') out.mode = modeRaw as 'act' | 'plan';
    if (typeof (cfg as any).tool_recovery_enabled === 'boolean') out.tool_recovery_enabled = !!(cfg as any).tool_recovery_enabled;
    if (typeof (cfg as any).tool_recovery_max_steps === 'number' && Number.isFinite((cfg as any).tool_recovery_max_steps)) {
      out.tool_recovery_max_steps = Math.trunc((cfg as any).tool_recovery_max_steps);
    }
    if (typeof (cfg as any).tool_recovery_allow_path_rewrite === 'boolean') {
      out.tool_recovery_allow_path_rewrite = !!(cfg as any).tool_recovery_allow_path_rewrite;
    }
    if (typeof (cfg as any).tool_recovery_allow_probe_tools === 'boolean') {
      out.tool_recovery_allow_probe_tools = !!(cfg as any).tool_recovery_allow_probe_tools;
    }
    if (typeof (cfg as any).tool_recovery_fail_on_repeated_signature === 'boolean') {
      out.tool_recovery_fail_on_repeated_signature = !!(cfg as any).tool_recovery_fail_on_repeated_signature;
    }
    if (isJSONObject((cfg as any).terminal_exec_policy)) {
      const raw = (cfg as any).terminal_exec_policy as Record<string, unknown>;
      const terminalExecPolicy: { default_timeout_ms?: number; max_timeout_ms?: number } = {};
      if (typeof raw.default_timeout_ms === 'number' && Number.isFinite(raw.default_timeout_ms)) {
        terminalExecPolicy.default_timeout_ms = Math.trunc(raw.default_timeout_ms);
      }
      if (typeof raw.max_timeout_ms === 'number' && Number.isFinite(raw.max_timeout_ms)) {
        terminalExecPolicy.max_timeout_ms = Math.trunc(raw.max_timeout_ms);
      }
      if (
        terminalExecPolicy.default_timeout_ms !== undefined ||
        terminalExecPolicy.max_timeout_ms !== undefined
      ) {
        out.terminal_exec_policy = terminalExecPolicy;
      }
    }
    return out;
  };

  const refreshAIProviderKeyStatus = async (providerIDs: string[]) => {
    const ids = Array.from(
      new Set(
        (Array.isArray(providerIDs) ? providerIDs : [])
          .map((x) => String(x ?? '').trim())
          .filter((x) => !!x),
      ),
    );
    if (ids.length === 0) {
      setAiProviderKeySet({});
      return;
    }
    try {
      const resp = await fetchGatewayJSON<{ provider_api_key_set: Record<string, boolean> }>('/_redeven_proxy/api/ai/provider_keys/status', {
        method: 'POST',
        body: JSON.stringify({ provider_ids: ids }),
      });
      setAiProviderKeySet(resp?.provider_api_key_set ?? {});
    } catch {
      // Best-effort only: the AI config UI should still work even if key status is unavailable.
    }
  };

  const updateAIProviderKey = async (providerID: string, apiKey: string | null) => {
    const id = String(providerID ?? '').trim();
    if (!id) {
      notify.error('Invalid provider', 'Provider id is required.');
      return;
    }
    if (!canAdmin()) {
      notify.error('Permission denied', 'Admin permission required.');
      return;
    }

    setAiProviderKeySaving((prev) => ({ ...prev, [id]: true }));
    try {
      const body = { patches: [{ provider_id: id, api_key: apiKey }] };
      const resp = await fetchGatewayJSON<{ provider_api_key_set: Record<string, boolean> }>('/_redeven_proxy/api/ai/provider_keys', {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      const next = resp?.provider_api_key_set ?? {};
      setAiProviderKeySet((prev) => ({ ...prev, ...next }));
      setAiProviderKeyDraft((prev) => ({ ...prev, [id]: '' }));

      if (apiKey) notify.success('Saved', `API key saved for provider "${id}".`);
      else notify.success('Cleared', `API key cleared for provider "${id}".`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setAiProviderKeySaving((prev) => ({ ...prev, [id]: false }));
    }
  };

  const saveAIProviderKey = (providerID: string) => {
    const id = String(providerID ?? '').trim();
    if (!id) {
      notify.error('Invalid provider', 'Provider id is required.');
      return;
    }
    const key = String(aiProviderKeyDraft()?.[id] ?? '').trim();
    if (!key) {
      notify.error('Missing API key', 'Please paste an API key first.');
      return;
    }
    void updateAIProviderKey(id, key);
  };

  const clearAIProviderKey = (providerID: string) => {
    const id = String(providerID ?? '').trim();
    if (!id) {
      notify.error('Invalid provider', 'Provider id is required.');
      return;
    }
    void updateAIProviderKey(id, null);
  };

  const normalizeProviderModelRows = (providerType: AIProviderType, rows: AIProviderModelRow[]): AIProviderModelRow[] => {
    const seen = new Set<string>();
    const out: AIProviderModelRow[] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const modelName = String(row?.model_name ?? '').trim();
      if (!modelName || seen.has(modelName)) continue;
      seen.add(modelName);
      out.push({
        model_name: modelName,
        context_window: normalizeContextWindowByProvider(providerType, row?.context_window),
        max_output_tokens: normalizePositiveInteger(row?.max_output_tokens),
        effective_context_window_percent: normalizeEffectiveContextPercent(row?.effective_context_window_percent),
      });
    }
    return out;
  };

  const updateAIProviderDialogDraft = (updater: (current: AIProviderRow) => AIProviderRow) => {
    setAiProviderDialogDraft((prev) => {
      if (!prev) return prev;
      return normalizeAIProviderRowDraft(updater(cloneAIProviderRow(prev)));
    });
  };

  const updateAIProviderDialogModelField = (
    index: number,
    key: 'context_window' | 'max_output_tokens' | 'effective_context_window_percent',
    rawValue: string,
  ) => {
    updateAIProviderDialogDraft((current) => ({
      ...current,
      models: (Array.isArray(current.models) ? current.models : []).map((model, modelIndex) => {
        if (modelIndex !== index) return model;
        const normalizedValue =
          key === 'effective_context_window_percent'
            ? normalizeEffectiveContextPercent(rawValue)
            : normalizePositiveInteger(rawValue);
        return { ...model, [key]: normalizedValue };
      }),
    }));
  };

  const addRecommendedModelToDraft = (modelName: string) => {
    const targetName = String(modelName ?? '').trim();
    if (!targetName) return;
    updateAIProviderDialogDraft((current) => {
      const targetPreset = recommendedModelsForProviderType(current.type).find((item) => item.model_name === targetName);
      const merged = normalizeProviderModelRows(current.type, [
        ...(Array.isArray(current.models) ? current.models : []),
        {
          model_name: targetName,
          context_window: normalizePositiveInteger(targetPreset?.context_window),
          max_output_tokens: normalizePositiveInteger(targetPreset?.max_output_tokens),
          effective_context_window_percent: normalizeEffectiveContextPercent(targetPreset?.effective_context_window_percent),
        },
      ]);
      return {
        ...current,
        models: merged.length > 0 ? merged : [{ model_name: '', context_window: defaultContextWindowForProviderType(current.type) }],
      };
    });
  };

  const applyRecommendedModelsToDraft = () => {
    const provider = aiProviderDialogProvider();
    if (!provider) return;
    const recommendedRows = normalizeProviderModelRows(
      provider.type,
      recommendedModelsForProviderType(provider.type).map((model) => ({
        model_name: model.model_name,
        context_window: normalizePositiveInteger(model.context_window),
        max_output_tokens: normalizePositiveInteger(model.max_output_tokens),
        effective_context_window_percent: normalizeEffectiveContextPercent(model.effective_context_window_percent),
      })),
    );
    if (recommendedRows.length === 0) {
      notify.info('No presets', `No recommended models are available for provider type "${provider.type}".`);
      return;
    }
    updateAIProviderDialogDraft((current) => ({
      ...current,
      models: recommendedRows,
    }));
    notify.success('Models applied', `${recommendedRows.length} recommended model(s) applied.`);
  };

  const closeAIProviderDialog = () => {
    setAiProviderDialogOpen(false);
    setAiProviderDialogMode('edit');
    setAiProviderDialogSourceIndex(null);
    setAiProviderDialogDraft(null);
    setAiProviderPresetModel('');
  };

  const openAIProviderDialog = (index: number) => {
    const list = aiProviders();
    if (index < 0 || index >= list.length) return;
    const draft = normalizeAIProviderRowDraft(cloneAIProviderRow(list[index]));
    setAiProviderDialogMode('edit');
    setAiProviderDialogSourceIndex(index);
    setAiProviderDialogDraft(draft);
    setAiProviderPresetModel(String(recommendedModelsForProviderType(draft.type)[0]?.model_name ?? ''));
    setAiProviderDialogOpen(true);
  };

  const addAIProviderAndOpenDialog = () => {
    const draft = newAIProviderDraft();
    setAiProviderDialogMode('create');
    setAiProviderDialogSourceIndex(null);
    setAiProviderDialogDraft(draft);
    setAiProviderPresetModel(String(recommendedModelsForProviderType(draft.type)[0]?.model_name ?? ''));
    setAiProviderDialogOpen(true);
  };

  const confirmAIProviderDialog = () => {
    const draft = aiProviderDialogDraft();
    if (!draft) {
      closeAIProviderDialog();
      return;
    }

    const mode = aiProviderDialogMode();
    const sourceIndex = aiProviderDialogSourceIndex();
    const normalizedDraft = normalizeAIProviderRowDraft(draft);
    const normalizedDraftID = String(normalizedDraft.id ?? '').trim();

    let nextProviders = aiProviders().map((item) => cloneAIProviderRow(item));

    if (mode === 'edit') {
      if (sourceIndex == null || sourceIndex < 0 || sourceIndex >= nextProviders.length) {
        notify.error('Provider missing', 'The provider no longer exists.');
        closeAIProviderDialog();
        return;
      }
      nextProviders = nextProviders.map((item, idx) => (idx === sourceIndex ? normalizedDraft : item));
    } else {
      nextProviders = [...nextProviders, normalizedDraft];
    }

    const normalizedProviders = normalizeAIProviders(nextProviders);
    setAiProviders(normalizedProviders);
    setAiCurrentModelID(normalizeAICurrentModelID(aiCurrentModelID(), normalizedProviders));
    setAiDirty(true);
    if (normalizedDraft.type === 'openai_compatible' && normalizeAIProviderWebSearchMode(normalizedDraft.web_search?.mode) === 'brave') {
      void refreshWebSearchKeyStatus([normalizedDraftID]);
    }
    closeAIProviderDialog();
    if (mode === 'create') notify.success('Provider added', 'Changes confirmed. Auto-save is in progress.');
    else notify.success('Provider updated', 'Changes confirmed. Auto-save is in progress.');
  };

  const refreshWebSearchKeyStatus = async (providerIDs: string[]) => {
    const ids = Array.from(
      new Set(
        (Array.isArray(providerIDs) ? providerIDs : [])
          .map((x) => String(x ?? '').trim())
          .filter((x) => !!x),
      ),
    );
    if (ids.length === 0) {
      setWebSearchKeySet({});
      return;
    }
    try {
      const resp = await fetchGatewayJSON<{ provider_api_key_set: Record<string, boolean> }>('/_redeven_proxy/api/ai/web_search_provider_keys/status', {
        method: 'POST',
        body: JSON.stringify({ provider_ids: ids }),
      });
      setWebSearchKeySet(resp?.provider_api_key_set ?? {});
    } catch {
      // Best-effort only.
    }
  };

  const updateWebSearchKey = async (providerID: string, apiKey: string | null) => {
    const id = String(providerID ?? '').trim();
    if (!id) {
      notify.error('Invalid provider', 'Provider id is required.');
      return;
    }
    if (!canAdmin()) {
      notify.error('Permission denied', 'Admin permission required.');
      return;
    }

    setWebSearchKeySaving((prev) => ({ ...prev, [id]: true }));
    try {
      const body = { patches: [{ provider_id: id, api_key: apiKey }] };
      const resp = await fetchGatewayJSON<{ provider_api_key_set: Record<string, boolean> }>('/_redeven_proxy/api/ai/web_search_provider_keys', {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      const next = resp?.provider_api_key_set ?? {};
      setWebSearchKeySet((prev) => ({ ...prev, ...next }));
      setWebSearchKeyDraft((prev) => ({ ...prev, [id]: '' }));

      if (apiKey) notify.success('Saved', `Web search API key saved for provider "${id}".`);
      else notify.success('Cleared', `Web search API key cleared for provider "${id}".`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setWebSearchKeySaving((prev) => ({ ...prev, [id]: false }));
    }
  };

  const saveWebSearchKey = (providerID: string) => {
    const id = String(providerID ?? '').trim();
    if (!id) {
      notify.error('Invalid provider', 'Provider id is required.');
      return;
    }
    const key = String(webSearchKeyDraft()?.[id] ?? '').trim();
    if (!key) {
      notify.error('Missing API key', 'Please paste a Brave API key first.');
      return;
    }
    void updateWebSearchKey(id, key);
  };

  const clearWebSearchKey = (providerID: string) => {
    const id = String(providerID ?? '').trim();
    if (!id) {
      notify.error('Invalid provider', 'Provider id is required.');
      return;
    }
    void updateWebSearchKey(id, null);
  };

  const filteredSkills = createMemo(() => {
    const list = skillsCatalog()?.skills ?? [];
    const q = String(skillQuery() ?? '').trim().toLowerCase();
    const scope = skillScopeFilter();
    return list
      .filter((item) => {
        if (scope !== 'all' && item.scope !== scope) return false;
        if (!q) return true;
        return (
          String(item.name ?? '').toLowerCase().includes(q) ||
          String(item.description ?? '').toLowerCase().includes(q) ||
          String(item.path ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (!!a.effective !== !!b.effective) return a.effective ? -1 : 1;
        const pa = Number(a.priority ?? 0);
        const pb = Number(b.priority ?? 0);
        if (pa !== pb) return pb - pa;
        return String(a.name ?? '').localeCompare(String(b.name ?? ''));
      });
  });

  const refreshSkillSources = async () => {
    setSkillSourcesLoading(true);
    try {
      const data = await fetchGatewayJSON<SkillSourcesResponse>('/_redeven_proxy/api/ai/skills/sources', { method: 'GET' });
      const map: Record<string, SkillSourceItem> = {};
      for (const item of data?.items ?? []) {
        const key = String(item?.skill_path ?? '').trim();
        if (!key) continue;
        map[key] = item;
      }
      setSkillSources(map);
    } catch {
      // Keep this best-effort; catalog should still remain usable.
    } finally {
      setSkillSourcesLoading(false);
    }
  };

  const refreshGitHubCatalog = async (forceReload: boolean) => {
    setSkillGitHubCatalogLoading(true);
    try {
      const query = new URLSearchParams({
        repo: 'openai/skills',
        ref: 'main',
        base_path: 'skills/.curated',
      });
      if (forceReload) query.set('force_reload', 'true');
      const data = await fetchGatewayJSON<SkillGitHubCatalogResponse>(`/_redeven_proxy/api/ai/skills/import/github/catalog?${query.toString()}`, { method: 'GET' });
      setSkillGitHubCatalog(data);
    } catch {
      // Keep silent in dialog; users can still install from direct URL.
    } finally {
      setSkillGitHubCatalogLoading(false);
    }
  };

  const refreshSkillsCatalog = async (forceReload: boolean) => {
    if (forceReload) setSkillsReloading(true);
    else setSkillsLoading(true);
    setSkillsError(null);
    try {
      const endpoint = forceReload ? '/_redeven_proxy/api/ai/skills/reload' : '/_redeven_proxy/api/ai/skills';
      const method = forceReload ? 'POST' : 'GET';
      const data = await fetchGatewayJSON<SkillsCatalogResponse>(endpoint, { method });
      setSkillsCatalog(data);
      void refreshSkillSources();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSkillsError(msg || 'Failed to load skills.');
    } finally {
      setSkillsReloading(false);
      setSkillsLoading(false);
    }
  };

  const toggleSkill = async (entry: SkillCatalogEntry, enabled: boolean) => {
    const path = String(entry.path ?? '').trim();
    if (!path) return;
    if (!canAdmin()) {
      notify.error('Permission denied', 'Admin permission required.');
      return;
    }
    setSkillToggleSaving((prev) => ({ ...prev, [path]: true }));
    try {
      const data = await fetchGatewayJSON<SkillsCatalogResponse>('/_redeven_proxy/api/ai/skills/toggles', {
        method: 'PUT',
        body: JSON.stringify({ patches: [{ path, enabled }] }),
      });
      setSkillsCatalog(data);
      notify.success('Saved', `Skill ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setSkillToggleSaving((prev) => ({ ...prev, [path]: false }));
    }
  };

  const openInstallDialog = () => {
    setSkillInstallOpen(true);
    setSkillInstallResolved([]);
    if (!skillGitHubCatalog()) {
      void refreshGitHubCatalog(false);
    }
  };

  const buildSkillInstallBody = () => {
    const scope = String(skillInstallScope() ?? '').trim();
    const url = String(skillInstallURL() ?? '').trim();
    const repo = normalizeRepoInput(skillInstallRepo());
    const ref = String(skillInstallRef() ?? '').trim() || 'main';
    const rawPaths = String(skillInstallPaths() ?? '')
      .split(/[\n,]/g)
      .map((x) => String(x ?? '').trim())
      .filter((x) => !!x);
    if (url) {
      return {
        scope,
        url,
        overwrite: !!skillInstallOverwrite(),
        auth: { use_local_git_credentials: true },
      };
    }
    return {
      scope,
      repo,
      ref,
      paths: rawPaths,
      overwrite: !!skillInstallOverwrite(),
      auth: { use_local_git_credentials: true },
    };
  };

  const validateSkillInstall = async () => {
    if (!canAdmin()) {
      notify.error('Permission denied', 'Admin permission required.');
      return;
    }
    const body = buildSkillInstallBody();
    if (!String((body as any).url ?? '').trim() && !String((body as any).repo ?? '').trim()) {
      notify.error('Invalid source', 'Provide a GitHub URL or repo/path fields.');
      return;
    }
    setSkillInstallValidating(true);
    try {
      const data = await fetchGatewayJSON<SkillGitHubValidateResponse>('/_redeven_proxy/api/ai/skills/import/github/validate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSkillInstallResolved(data?.resolved ?? []);
      notify.success('Validated', `Resolved ${data?.resolved?.length ?? 0} skill(s).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Validate failed', msg || 'Request failed.');
    } finally {
      setSkillInstallValidating(false);
    }
  };

  const installSkillsFromGitHub = async () => {
    if (!canAdmin()) {
      notify.error('Permission denied', 'Admin permission required.');
      return;
    }
    const body = buildSkillInstallBody();
    if (!String((body as any).url ?? '').trim() && !String((body as any).repo ?? '').trim()) {
      notify.error('Invalid source', 'Provide a GitHub URL or repo/path fields.');
      return;
    }
    setSkillInstallSaving(true);
    try {
      const data = await fetchGatewayJSON<SkillGitHubImportResponse>('/_redeven_proxy/api/ai/skills/import/github', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSkillsCatalog(data?.catalog ?? null);
      setSkillInstallResolved([]);
      setSkillInstallOpen(false);
      setSkillInstallURL('');
      void refreshSkillSources();
      notify.success('Installed', `Installed ${data?.imports?.length ?? 0} skill(s).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Install failed', msg || 'Request failed.');
    } finally {
      setSkillInstallSaving(false);
    }
  };

  const reinstallSkill = async (entry: SkillCatalogEntry) => {
    const path = String(entry.path ?? '').trim();
    if (!path) return;
    if (!canAdmin()) {
      notify.error('Permission denied', 'Admin permission required.');
      return;
    }
    setSkillReinstalling((prev) => ({ ...prev, [path]: true }));
    try {
      const data = await fetchGatewayJSON<SkillReinstallResponse>('/_redeven_proxy/api/ai/skills/reinstall', {
        method: 'POST',
        body: JSON.stringify({ paths: [path], overwrite: true }),
      });
      setSkillsCatalog(data?.catalog ?? null);
      void refreshSkillSources();
      notify.success('Reinstalled', `Skill "${entry.name}" reinstalled.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Reinstall failed', msg || 'Request failed.');
    } finally {
      setSkillReinstalling((prev) => ({ ...prev, [path]: false }));
    }
  };

  const loadSkillBrowseTree = async (entry: SkillCatalogEntry, dir: string) => {
    const skillPath = String(entry.path ?? '').trim();
    if (!skillPath) return;
    setSkillBrowseTreeLoading(true);
    try {
      const query = new URLSearchParams({ skill_path: skillPath, dir: String(dir ?? '.').trim() || '.' });
      const data = await fetchGatewayJSON<SkillBrowseTreeResponse>(`/_redeven_proxy/api/ai/skills/browse/tree?${query.toString()}`, { method: 'GET' });
      setSkillBrowseTree(data);
      setSkillBrowseDir(String(data?.dir ?? '.'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Browse failed', msg || 'Request failed.');
    } finally {
      setSkillBrowseTreeLoading(false);
    }
  };

  const openSkillBrowse = (entry: SkillCatalogEntry) => {
    setSkillBrowseTarget(entry);
    setSkillBrowseOpen(true);
    setSkillBrowseFile(null);
    setSkillBrowseTree(null);
    setSkillBrowseDir('.');
    void loadSkillBrowseTree(entry, '.');
  };

  const openSkillBrowseFile = async (entry: SkillCatalogEntry, relPath: string) => {
    const skillPath = String(entry.path ?? '').trim();
    const filePath = String(relPath ?? '').trim();
    if (!skillPath || !filePath) return;
    setSkillBrowseFileLoading(true);
    try {
      const query = new URLSearchParams({
        skill_path: skillPath,
        file: filePath,
        encoding: 'utf8',
        max_bytes: String(1024 * 1024),
      });
      const data = await fetchGatewayJSON<SkillBrowseFileResponse>(`/_redeven_proxy/api/ai/skills/browse/file?${query.toString()}`, { method: 'GET' });
      setSkillBrowseFile(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Read failed', msg || 'Request failed.');
    } finally {
      setSkillBrowseFileLoading(false);
    }
  };

  const createSkill = async () => {
    if (!canAdmin()) {
      notify.error('Permission denied', 'Admin permission required.');
      return;
    }
    const scope = String(skillCreateScope() ?? '').trim();
    const name = String(skillCreateName() ?? '').trim();
    const description = String(skillCreateDescription() ?? '').trim();
    const body = String(skillCreateBody() ?? '').trim();
    if (!name) {
      notify.error('Invalid name', 'Skill name is required.');
      return;
    }
    if (!description) {
      notify.error('Invalid description', 'Skill description is required.');
      return;
    }
    setSkillCreateSaving(true);
    try {
      const data = await fetchGatewayJSON<SkillsCatalogResponse>('/_redeven_proxy/api/ai/skills', {
        method: 'POST',
        body: JSON.stringify({ scope, name, description, body }),
      });
      setSkillsCatalog(data);
      void refreshSkillSources();
      setSkillCreateOpen(false);
      setSkillCreateName('');
      setSkillCreateDescription('');
      setSkillCreateBody('');
      notify.success('Created', `Skill "${name}" created.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Create failed', msg || 'Request failed.');
    } finally {
      setSkillCreateSaving(false);
    }
  };

  const askDeleteSkill = (entry: SkillCatalogEntry) => {
    setSkillDeleteTarget(entry);
    setSkillDeleteOpen(true);
  };

  const deleteSkill = async () => {
    const target = skillDeleteTarget();
    if (!target) return;
    if (!canAdmin()) {
      notify.error('Permission denied', 'Admin permission required.');
      return;
    }
    setSkillDeleteSaving(true);
    try {
      const data = await fetchGatewayJSON<SkillsCatalogResponse>('/_redeven_proxy/api/ai/skills', {
        method: 'DELETE',
        body: JSON.stringify({ scope: target.scope, name: target.name }),
      });
      setSkillsCatalog(data);
      void refreshSkillSources();
      setSkillDeleteOpen(false);
      setSkillDeleteTarget(null);
      notify.success('Deleted', `Skill "${target.name}" deleted.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Delete failed', msg || 'Request failed.');
    } finally {
      setSkillDeleteSaving(false);
    }
  };

  createEffect(() => {
    const current = key();
    if (current == null) return;
    void refreshSkillsCatalog(false);
  });

  // Reset local state when settings are loaded (but do not overwrite user edits).
  createEffect(() => {
    const s = settings();
    if (!s) return;

    if (!runtimeDirty()) {
      const r = s.runtime;
      setAgentHomeDir(String(r?.agent_home_dir ?? ''));
      setShell(String(r?.shell ?? ''));
      setRuntimeJSON(JSON.stringify({ agent_home_dir: String(r?.agent_home_dir ?? ''), shell: String(r?.shell ?? '') }, null, 2));
    }

    if (!loggingDirty()) {
      const l = s.logging;
      setLogFormat(String(l?.log_format ?? ''));
      setLogLevel(String(l?.log_level ?? ''));
      setLoggingJSON(JSON.stringify({ log_format: String(l?.log_format ?? ''), log_level: String(l?.log_level ?? '') }, null, 2));
    }

    if (!codespacesDirty()) {
      const c = s.codespaces;
      const min = Number(c?.code_server_port_min ?? 0);
      const max = Number(c?.code_server_port_max ?? 0);
      const n = normalizePortRange(min, max);

      setUseDefaultCodePorts(n.use_default);
      setCodePortMin(n.use_default ? '' : n.effective_min);
      setCodePortMax(n.use_default ? '' : n.effective_max);
      setCodespacesJSON(JSON.stringify({ code_server_port_min: min, code_server_port_max: max }, null, 2));
    }

    if (!policyDirty()) {
      const p = s.permission_policy ?? defaultPermissionPolicy();
      setPolicyLocalRead(!!p.local_max?.read);
      setPolicyLocalWrite(!!p.local_max?.write);
      setPolicyLocalExecute(!!p.local_max?.execute);
      setPolicyByUser(mapToPermissionRows(p.by_user));
      setPolicyByApp(mapToPermissionRows(p.by_app));
      setPolicyJSON(JSON.stringify(p, null, 2));
    }

    if (!aiDirty()) {
      const a = s.ai ?? defaultAIConfig();
      const executionPolicy = readAIExecutionPolicy(a);
      setAiRequireUserApproval(!!executionPolicy.require_user_approval);
      setAiBlockDangerousCommands(!!executionPolicy.block_dangerous_commands);
      setAiPreservedFields(readAIPreservedFields(a));
      const rows: AIProviderRow[] = (a.providers ?? []).map((p) => ({
        id: String(p.id ?? ''),
        name: String(p.name ?? ''),
        type: p.type,
        base_url: String(p.base_url ?? ''),
        web_search: normalizeAIProviderWebSearchForType(p.type, (p as any).web_search),
        models: (p.models ?? []).map((m) => ({
          model_name: String(m.model_name ?? ''),
          context_window: normalizePositiveInteger((m as any).context_window),
          max_output_tokens: normalizePositiveInteger((m as any).max_output_tokens),
          effective_context_window_percent: normalizeEffectiveContextPercent((m as any).effective_context_window_percent),
        })),
      }));
      const fallback = defaultAIConfig();
      const fallbackRows: AIProviderRow[] = (fallback.providers ?? []).map((p) => ({
        id: String(p.id ?? ''),
        name: String(p.name ?? ''),
        type: p.type,
        base_url: String(p.base_url ?? ''),
        web_search: normalizeAIProviderWebSearchForType(p.type, (p as any).web_search),
        models: (p.models ?? []).map((m) => ({
          model_name: String(m.model_name ?? ''),
          context_window: normalizePositiveInteger((m as any).context_window),
          max_output_tokens: normalizePositiveInteger((m as any).max_output_tokens),
          effective_context_window_percent: normalizeEffectiveContextPercent((m as any).effective_context_window_percent),
        })),
      }));
      const normalizedProviders = normalizeAIProviders(rows.length > 0 ? rows : fallbackRows);
      setAiProviders(normalizedProviders);
      setAiCurrentModelID(normalizeAICurrentModelID(String((a as any).current_model_id ?? ''), normalizedProviders));

      setAiJSON(JSON.stringify(a, null, 2));

      const keySet = s.ai_secrets?.provider_api_key_set;
      if (keySet && typeof keySet === 'object') setAiProviderKeySet(keySet);
      void refreshAIProviderKeyStatus((a.providers ?? []).map((p) => String(p.id ?? '')));
      void refreshWebSearchKeyStatus(providersNeedingWebSearchKeyStatus(normalizedProviders));
    }

  });

  createEffect(() => {
    if (!aiProviderDialogOpen()) return;
    if (aiProviderDialogMode() !== 'edit') return;
    const idx = aiProviderDialogSourceIndex();
    if (idx == null || idx < 0 || idx >= aiProviders().length) {
      closeAIProviderDialog();
    }
  });

  createEffect(() => {
    if (aiView() !== 'ui' && aiProviderDialogOpen()) {
      closeAIProviderDialog();
    }
  });

  createEffect(() => {
    if (!aiProviderDialogOpen()) return;
    const provider = aiProviderDialogProvider();
    if (!provider) return;
    const models = recommendedModelsForProviderType(provider.type);
    const current = String(aiProviderPresetModel() ?? '').trim();
    if (models.length === 0) {
      if (current) setAiProviderPresetModel('');
      return;
    }
    if (!models.some((it) => it.model_name === current)) {
      setAiProviderPresetModel(models[0].model_name);
    }
  });

  // Focus/scroll to the requested section when opened via "Open Settings" from other pages.
  createEffect(() => {
    const seq = env.settingsFocusSeq();
    const section = env.settingsFocusSection();
    if (!seq || !section) return;
    requestAnimationFrame(() => scrollToSection(section));
  });

  const saveSettings = async (body: any): Promise<{ settings: AgentSettingsResponse | null; aiUpdate: SettingsAIUpdateMeta | null }> => {
    const data = await fetchGatewayJSON<AgentSettingsResponse | SettingsUpdateResponse>('/_redeven_proxy/api/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    const normalized = normalizeSettingsUpdateResponse(data);
    if (normalized.settings) {
      // Keep the local resource in sync before dirty flags are cleared, otherwise
      // section reset effects can briefly rehydrate stale pre-save values.
      mutateSettings(normalized.settings);
    }
    env.bumpSettingsSeq();
    return normalized;
  };

  // View switchers
  const switchRuntimeView = (next: ViewMode) => {
    setRuntimeError(null);
    if (next === runtimeView()) return;
    if (next === 'json') {
      setRuntimeJSON(JSON.stringify(buildRuntimePatch(), null, 2));
      setRuntimeView('json');
      return;
    }
    try {
      const v = parseJSONOrThrow(runtimeJSON());
      if (!isJSONObject(v)) throw new Error('Runtime JSON must be an object.');
      if (typeof (v as any).agent_home_dir !== 'string' || typeof (v as any).shell !== 'string') {
        throw new Error('Runtime JSON must include "agent_home_dir" and "shell" as strings.');
      }
      setAgentHomeDir(String((v as any).agent_home_dir ?? ''));
      setShell(String((v as any).shell ?? ''));
      setRuntimeView('ui');
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : String(e));
    }
  };

  const switchLoggingView = (next: ViewMode) => {
    setLoggingError(null);
    if (next === loggingView()) return;
    if (next === 'json') {
      setLoggingJSON(JSON.stringify(buildLoggingPatch(), null, 2));
      setLoggingView('json');
      return;
    }
    try {
      const v = parseJSONOrThrow(loggingJSON());
      if (!isJSONObject(v)) throw new Error('Logging JSON must be an object.');
      if (typeof (v as any).log_format !== 'string' || typeof (v as any).log_level !== 'string') {
        throw new Error('Logging JSON must include "log_format" and "log_level" as strings.');
      }
      setLogFormat(String((v as any).log_format ?? ''));
      setLogLevel(String((v as any).log_level ?? ''));
      setLoggingView('ui');
    } catch (e) {
      setLoggingError(e instanceof Error ? e.message : String(e));
    }
  };

  const switchCodespacesView = (next: ViewMode) => {
    setCodespacesError(null);
    if (next === codespacesView()) return;
    if (next === 'json') {
      setCodespacesJSON(JSON.stringify(buildCodespacesPatch(), null, 2));
      setCodespacesView('json');
      return;
    }
    try {
      const v = parseJSONOrThrow(codespacesJSON());
      if (!isJSONObject(v)) throw new Error('Codespaces JSON must be an object.');
      const min = Number((v as any).code_server_port_min ?? NaN);
      const max = Number((v as any).code_server_port_max ?? NaN);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new Error('Codespaces JSON must include "code_server_port_min" and "code_server_port_max" as numbers.');
      }
      const n = normalizePortRange(min, max);
      setUseDefaultCodePorts(n.use_default);
      setCodePortMin(n.use_default ? '' : n.effective_min);
      setCodePortMax(n.use_default ? '' : n.effective_max);
      setCodespacesView('ui');
    } catch (e) {
      setCodespacesError(e instanceof Error ? e.message : String(e));
    }
  };

  const switchPolicyView = (next: ViewMode) => {
    setPolicyError(null);
    if (next === policyView()) return;
    if (next === 'json') {
      try {
        const v = buildPolicyValue();
        setPolicyJSON(JSON.stringify(v, null, 2));
      } catch {
        // Keep whatever is currently in the editor if we fail to build.
      }
      setPolicyView('json');
      return;
    }

    try {
      const v = parseJSONOrThrow(policyJSON());
      if (!isJSONObject(v)) throw new Error('Permission policy JSON must be an object.');
      if (Number((v as any).schema_version ?? 0) !== 1) throw new Error('schema_version must be 1.');
      const lm = (v as any).local_max;
      if (!isJSONObject(lm)) throw new Error('local_max is required.');

      const localRead = !!(lm as any).read;
      const localWrite = !!(lm as any).write;
      const localExec = !!(lm as any).execute;
      setPolicyLocalRead(localRead);
      setPolicyLocalWrite(localWrite);
      setPolicyLocalExecute(localExec);

      const byUserRaw = (v as any).by_user;
      const byAppRaw = (v as any).by_app;
      setPolicyByUser(mapToPermissionRows(isJSONObject(byUserRaw) ? (byUserRaw as any) : undefined));
      setPolicyByApp(mapToPermissionRows(isJSONObject(byAppRaw) ? (byAppRaw as any) : undefined));
      setPolicyView('ui');
    } catch (e) {
      setPolicyError(e instanceof Error ? e.message : String(e));
    }
  };

  const switchAIView = (next: ViewMode) => {
    setAiError(null);
    if (next === aiView()) return;
    if (next === 'json') {
      try {
        const v = buildAIValue();
        setAiJSON(JSON.stringify(v, null, 2));
      } catch {
        // Keep whatever is currently in the editor if we fail to build.
      }
      setAiView('json');
      return;
    }

    try {
      const v = parseJSONOrThrow(aiJSON());
      if (!isJSONObject(v)) throw new Error('Flower JSON must be an object.');

      const providersRaw = (v as any).providers;
      if (!Array.isArray(providersRaw)) throw new Error('Flower JSON is missing providers[].');

      const normalizedProviders = normalizeAIProviders(
        providersRaw.map((p) => ({
          id: String(p?.id ?? ''),
          name: String(p?.name ?? ''),
          type: String(p?.type ?? '') as AIProviderType,
          base_url: String(p?.base_url ?? ''),
          web_search: normalizeAIProviderWebSearchForType(String(p?.type ?? '') as AIProviderType, p?.web_search),
          models: Array.isArray(p?.models)
            ? (p.models as any[]).map((m) => ({
                model_name: String(m?.model_name ?? ''),
                context_window: normalizePositiveInteger(m?.context_window),
                max_output_tokens: normalizePositiveInteger(m?.max_output_tokens),
                effective_context_window_percent: normalizeEffectiveContextPercent(m?.effective_context_window_percent),
              }))
            : [],
        })),
      );
      setAiProviders(normalizedProviders);
      setAiCurrentModelID(normalizeAICurrentModelID(String((v as any).current_model_id ?? ''), normalizedProviders));
      const executionPolicy = readAIExecutionPolicy(v);
      setAiRequireUserApproval(!!executionPolicy.require_user_approval);
      setAiBlockDangerousCommands(!!executionPolicy.block_dangerous_commands);
      setAiPreservedFields(readAIPreservedFields(v));
      void refreshAIProviderKeyStatus(providersRaw.map((p) => String(p?.id ?? '')));
      void refreshWebSearchKeyStatus(providersNeedingWebSearchKeyStatus(normalizedProviders));
      setAiView('ui');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    }
  };

  // Save handlers
  const buildRuntimeDraft = () => {
    const body = runtimeView() === 'json' ? parseJSONOrThrow(runtimeJSON()) : buildRuntimePatch();
    if (!isJSONObject(body)) throw new Error('Runtime JSON must be an object.');
    return { body, signature: JSON.stringify(body) };
  };

  const buildLoggingDraft = () => {
    const body = loggingView() === 'json' ? parseJSONOrThrow(loggingJSON()) : buildLoggingPatch();
    if (!isJSONObject(body)) throw new Error('Logging JSON must be an object.');
    return { body, signature: JSON.stringify(body) };
  };

  const buildCodespacesDraft = () => {
    let body: any = null;
    if (codespacesView() === 'json') {
      body = parseJSONOrThrow(codespacesJSON());
      if (!isJSONObject(body)) throw new Error('Codespaces JSON must be an object.');
    } else {
      if (!useDefaultCodePorts()) {
        const min = codePortMin();
        const max = codePortMax();
        if (min === '' || max === '') throw new Error('Please provide both port min and port max.');
        const n = normalizePortRange(Number(min), Number(max));
        if (n.use_default) throw new Error('Invalid port range.');
      }
      body = buildCodespacesPatch();
    }
    return { body, signature: JSON.stringify(body) };
  };

  const buildPolicyDraft = () => {
    let body: any = null;
    if (policyView() === 'json') {
      const v = parseJSONOrThrow(policyJSON());
      if (!isJSONObject(v)) throw new Error('Permission policy JSON must be an object.');
      body = { permission_policy: v };
    } else {
      const v = buildPolicyValue();
      body = { permission_policy: v };
    }
    return { body, signature: JSON.stringify(body) };
  };

  const buildAIDraft = () => {
    let cfg: AIConfig | null = null;
    if (aiView() === 'json') {
      const v = parseJSONOrThrow(aiJSON());
      if (!isJSONObject(v)) throw new Error('Flower JSON must be an object.');
      cfg = v as AIConfig;
    } else {
      cfg = buildAIValue();
    }
    validateAIValue(cfg);
    const body = { ai: cfg };
    return { body, signature: JSON.stringify(body) };
  };

  const notifyAutoSaveSuccess = (
    label: string,
    unixMs: number,
    options?: { aiUpdate?: SettingsAIUpdateMeta | null; restartRequired?: boolean },
  ) => {
    if (options?.restartRequired) {
      notify.success('Auto-saved', autoSaveRestartRequiredMessage(label, unixMs));
      return;
    }
    const applyScope = String(options?.aiUpdate?.apply_scope ?? '').trim().toLowerCase();
    const activeRunCount = Number(options?.aiUpdate?.active_run_count ?? 0);
    if (applyScope === 'future_runs' && Number.isFinite(activeRunCount) && activeRunCount > 0) {
      const base = autoSaveMessage(label, unixMs);
      notify.success('Auto-saved', `${base} Changes apply to future runs.`);
      return;
    }
    notify.success('Auto-saved', autoSaveMessage(label, unixMs));
  };

  const notifyAutoSaveFailed = (label: string, err: unknown) => {
    const msg = formatUnknownError(err) || 'Request failed.';
    notify.error('Auto-save failed', `${label}: ${msg}`);
  };

  const saveRuntime = async () => {
    let draft: { body: any; signature: string };
    try {
      draft = buildRuntimeDraft();
      setRuntimeError(null);
    } catch (e) {
      setRuntimeError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    setRuntimeSaving(true);
    try {
      await saveSettings(draft.body);
      const now = Date.now();
      setRuntimeSavedAt(now);
      setRuntimeError(null);
      notifyAutoSaveSuccess('Runtime settings', now, { restartRequired: true });
      let unchanged = false;
      try {
        unchanged = buildRuntimeDraft().signature === draft.signature;
      } catch {
        unchanged = false;
      }
      setRuntimeDirty(!unchanged);
    } catch (e) {
      const msg = formatUnknownError(e) || 'Save failed.';
      setRuntimeError(msg);
      notifyAutoSaveFailed('Runtime settings', e);
    } finally {
      setRuntimeSaving(false);
    }
  };

  const saveLogging = async () => {
    let draft: { body: any; signature: string };
    try {
      draft = buildLoggingDraft();
      setLoggingError(null);
    } catch (e) {
      setLoggingError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    setLoggingSaving(true);
    try {
      await saveSettings(draft.body);
      const now = Date.now();
      setLoggingSavedAt(now);
      setLoggingError(null);
      notifyAutoSaveSuccess('Logging settings', now, { restartRequired: true });
      let unchanged = false;
      try {
        unchanged = buildLoggingDraft().signature === draft.signature;
      } catch {
        unchanged = false;
      }
      setLoggingDirty(!unchanged);
    } catch (e) {
      const msg = formatUnknownError(e) || 'Save failed.';
      setLoggingError(msg);
      notifyAutoSaveFailed('Logging settings', e);
    } finally {
      setLoggingSaving(false);
    }
  };

  const saveCodespaces = async () => {
    let draft: { body: any; signature: string };
    try {
      draft = buildCodespacesDraft();
      setCodespacesError(null);
    } catch (e) {
      setCodespacesError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    setCodespacesSaving(true);
    try {
      await saveSettings(draft.body);
      const now = Date.now();
      setCodespacesSavedAt(now);
      setCodespacesError(null);
      notifyAutoSaveSuccess('Codespaces settings', now, { restartRequired: true });
      let unchanged = false;
      try {
        unchanged = buildCodespacesDraft().signature === draft.signature;
      } catch {
        unchanged = false;
      }
      setCodespacesDirty(!unchanged);
    } catch (e) {
      const msg = formatUnknownError(e) || 'Save failed.';
      setCodespacesError(msg);
      notifyAutoSaveFailed('Codespaces settings', e);
    } finally {
      setCodespacesSaving(false);
    }
  };

  const savePolicy = async () => {
    let draft: { body: any; signature: string };
    try {
      draft = buildPolicyDraft();
      setPolicyError(null);
    } catch (e) {
      setPolicyError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    setPolicySaving(true);
    try {
      await saveSettings(draft.body);
      const now = Date.now();
      setPolicySavedAt(now);
      setPolicyError(null);
      notifyAutoSaveSuccess('Permission policy', now, { restartRequired: true });
      let unchanged = false;
      try {
        unchanged = buildPolicyDraft().signature === draft.signature;
      } catch {
        unchanged = false;
      }
      setPolicyDirty(!unchanged);
    } catch (e) {
      const msg = formatUnknownError(e) || 'Save failed.';
      setPolicyError(msg);
      notifyAutoSaveFailed('Permission policy', e);
    } finally {
      setPolicySaving(false);
    }
  };

  const saveAI = async () => {
    let draft: { body: { ai: AIConfig | null }; signature: string };
    try {
      draft = buildAIDraft();
      setAiError(null);
    } catch (e) {
      setAiError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    setAiSaving(true);
    try {
      const saved = await saveSettings(draft.body);
      const now = Date.now();
      setAiSavedAt(now);
      setAiError(null);
      notifyAutoSaveSuccess('Flower settings', now, { aiUpdate: saved.aiUpdate });
      let unchanged = false;
      try {
        unchanged = buildAIDraft().signature === draft.signature;
      } catch {
        unchanged = false;
      }
      setAiDirty(!unchanged);
    } catch (e) {
      const msg = formatUnknownError(e) || 'Save failed.';
      setAiError(msg);
      notifyAutoSaveFailed('Flower settings', e);
    } finally {
      setAiSaving(false);
    }
  };

  const saveAICurrentModelDirectly = async (nextModelID: string, prevModelID: string) => {
    const modelID = String(nextModelID ?? '').trim();
    if (!modelID) return;
    setAiSaving(true);
    setAiError(null);
    try {
      await fetchGatewayJSON<unknown>('/_redeven_proxy/api/ai/current_model', {
        method: 'PUT',
        body: JSON.stringify({ model_id: modelID }),
      });
      env.bumpSettingsSeq();
      const now = Date.now();
      setAiSavedAt(now);
      setAiError(null);
      setAiDirty(false);
      notifyAutoSaveSuccess('Flower settings', now);
    } catch (e) {
      const msg = formatUnknownError(e) || 'Save failed.';
      setAiCurrentModelID(prevModelID);
      setAiError(msg);
      setAiDirty(true);
      notifyAutoSaveFailed('Flower settings', e);
    } finally {
      setAiSaving(false);
    }
  };

  const disableAI = async () => {
    setDisableAISaving(true);
    setAiError(null);
    try {
      await saveSettings({ ai: null });
      setAiSavedAt(Date.now());
      setAiDirty(false);
      setDisableAIOpen(false);
      notify.success('Disabled', 'Flower has been disabled.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg || 'Disable failed.');
      notify.error('Disable failed', msg || 'Request failed.');
    } finally {
      setDisableAISaving(false);
    }
  };

  let runtimeAutoSaveTimer: number | null = null;
  let loggingAutoSaveTimer: number | null = null;
  let codespacesAutoSaveTimer: number | null = null;
  let policyAutoSaveTimer: number | null = null;
  let aiAutoSaveTimer: number | null = null;

  const clearAutoSaveTimer = (timer: number | null): null => {
    if (timer != null) window.clearTimeout(timer);
    return null;
  };

  createEffect(() => {
    const dirty = runtimeDirty();
    const canAutoSave = canInteract() && !runtimeSaving();
    if (!dirty || !canAutoSave) {
      runtimeAutoSaveTimer = clearAutoSaveTimer(runtimeAutoSaveTimer);
      return;
    }
    try {
      buildRuntimeDraft();
      setRuntimeError(null);
    } catch (e) {
      runtimeAutoSaveTimer = clearAutoSaveTimer(runtimeAutoSaveTimer);
      setRuntimeError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    runtimeAutoSaveTimer = clearAutoSaveTimer(runtimeAutoSaveTimer);
    runtimeAutoSaveTimer = window.setTimeout(() => {
      runtimeAutoSaveTimer = null;
      if (!runtimeDirty() || runtimeSaving() || !canInteract()) return;
      void saveRuntime();
    }, AUTO_SAVE_DELAY_MS);
  });

  createEffect(() => {
    const dirty = loggingDirty();
    const canAutoSave = canInteract() && !loggingSaving();
    if (!dirty || !canAutoSave) {
      loggingAutoSaveTimer = clearAutoSaveTimer(loggingAutoSaveTimer);
      return;
    }
    try {
      buildLoggingDraft();
      setLoggingError(null);
    } catch (e) {
      loggingAutoSaveTimer = clearAutoSaveTimer(loggingAutoSaveTimer);
      setLoggingError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    loggingAutoSaveTimer = clearAutoSaveTimer(loggingAutoSaveTimer);
    loggingAutoSaveTimer = window.setTimeout(() => {
      loggingAutoSaveTimer = null;
      if (!loggingDirty() || loggingSaving() || !canInteract()) return;
      void saveLogging();
    }, AUTO_SAVE_DELAY_MS);
  });

  createEffect(() => {
    const dirty = codespacesDirty();
    const canAutoSave = canInteract() && !codespacesSaving();
    if (!dirty || !canAutoSave) {
      codespacesAutoSaveTimer = clearAutoSaveTimer(codespacesAutoSaveTimer);
      return;
    }
    try {
      buildCodespacesDraft();
      setCodespacesError(null);
    } catch (e) {
      codespacesAutoSaveTimer = clearAutoSaveTimer(codespacesAutoSaveTimer);
      setCodespacesError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    codespacesAutoSaveTimer = clearAutoSaveTimer(codespacesAutoSaveTimer);
    codespacesAutoSaveTimer = window.setTimeout(() => {
      codespacesAutoSaveTimer = null;
      if (!codespacesDirty() || codespacesSaving() || !canInteract()) return;
      void saveCodespaces();
    }, AUTO_SAVE_DELAY_MS);
  });

  createEffect(() => {
    const dirty = policyDirty();
    const canAutoSave = canInteract() && !policySaving();
    if (!dirty || !canAutoSave) {
      policyAutoSaveTimer = clearAutoSaveTimer(policyAutoSaveTimer);
      return;
    }
    try {
      buildPolicyDraft();
      setPolicyError(null);
    } catch (e) {
      policyAutoSaveTimer = clearAutoSaveTimer(policyAutoSaveTimer);
      setPolicyError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    policyAutoSaveTimer = clearAutoSaveTimer(policyAutoSaveTimer);
    policyAutoSaveTimer = window.setTimeout(() => {
      policyAutoSaveTimer = null;
      if (!policyDirty() || policySaving() || !canInteract()) return;
      void savePolicy();
    }, AUTO_SAVE_DELAY_MS);
  });

  createEffect(() => {
    const dirty = aiDirty();
    const canAutoSave = canInteract() && !aiSaving() && !disableAISaving();
    if (!dirty || !canAutoSave) {
      aiAutoSaveTimer = clearAutoSaveTimer(aiAutoSaveTimer);
      return;
    }
    try {
      buildAIDraft();
      setAiError(null);
    } catch (e) {
      aiAutoSaveTimer = clearAutoSaveTimer(aiAutoSaveTimer);
      setAiError(formatUnknownError(e) || 'Save failed.');
      return;
    }
    aiAutoSaveTimer = clearAutoSaveTimer(aiAutoSaveTimer);
    aiAutoSaveTimer = window.setTimeout(() => {
      aiAutoSaveTimer = null;
      if (!aiDirty() || aiSaving() || disableAISaving() || !canInteract()) return;
      void saveAI();
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => {
    runtimeAutoSaveTimer = clearAutoSaveTimer(runtimeAutoSaveTimer);
    loggingAutoSaveTimer = clearAutoSaveTimer(loggingAutoSaveTimer);
    codespacesAutoSaveTimer = clearAutoSaveTimer(codespacesAutoSaveTimer);
    policyAutoSaveTimer = clearAutoSaveTimer(policyAutoSaveTimer);
    aiAutoSaveTimer = clearAutoSaveTimer(aiAutoSaveTimer);
  });

  // When local max is tightened, clamp row-level caps to avoid confusing "true but ineffective" UI.
  createEffect(() => {
    const r = policyLocalRead();
    const w = policyLocalWrite();
    const x = policyLocalExecute();
    setPolicyByUser((prev) =>
      prev.map((it) => ({
        ...it,
        read: r ? it.read : false,
        write: w ? it.write : false,
        execute: x ? it.execute : false,
      })),
    );
    setPolicyByApp((prev) =>
      prev.map((it) => ({
        ...it,
        read: r ? it.read : false,
        write: w ? it.write : false,
        execute: x ? it.execute : false,
      })),
    );
  });

  const codespacesEffective = createMemo(() => {
    const s = settings();
    const min = Number(s?.codespaces?.code_server_port_min ?? 0);
    const max = Number(s?.codespaces?.code_server_port_max ?? 0);
    return normalizePortRange(min, max);
  });

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div class="relative h-full min-h-0 bg-background">
      <div class="h-full min-h-0 flex">
        <div class="hidden lg:block h-full">
          <Sidebar width={240} class="h-full">
            <SidebarContent>
              <SidebarSection title="Jump to">
                <SidebarItemList>
                  <For each={SETTINGS_NAV_ITEMS}>
                    {(it) => {
                      const Icon = it.icon;
                      return (
                        <SidebarItem
                          active={activeSection() === it.id}
                          icon={<Icon class="w-4 h-4" />}
                          onClick={() => scrollToSection(it.id)}
                        >
                          {it.label}
                        </SidebarItem>
                      );
                    }}
                  </For>
                </SidebarItemList>
              </SidebarSection>
            </SidebarContent>
          </Sidebar>
        </div>

        <div ref={(el) => (scrollEl = el)} class="flex-1 min-w-0 overflow-auto">
          <div class="max-w-4xl mx-auto p-4 space-y-8 sm:p-6 pb-16">
        {/* Page Header */}
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-foreground tracking-tight">Runtime Settings</h1>
            <p class="text-sm text-muted-foreground mt-1 leading-relaxed">
              Configure your Redeven runtime. Changes are auto-saved when valid. Restart-required settings only apply after a manual restart that you trigger.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refreshSettingsPage()} disabled={settings.loading} class="gap-1.5 self-start">
            <RefreshIcon class="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>
        </div>

        <div class="lg:hidden">
          <FieldLabel>Jump to</FieldLabel>
          <Select
            value={activeSection()}
            onChange={(v) => {
              if (!v) return;
              scrollToSection(v as EnvSettingsSection);
            }}
            options={SETTINGS_NAV_ITEMS.map((it) => ({ value: it.id, label: it.label }))}
            class="w-full"
          />
        </div>

        <Show when={settings.error}>
          <div class="flex items-start gap-2.5 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
            <div class="w-1 h-full min-h-4 rounded-full bg-destructive/60 flex-shrink-0" />
            <div class="text-sm text-destructive">{settings.error instanceof Error ? settings.error.message : String(settings.error)}</div>
          </div>
        </Show>

        {/* ── Overview (read-only) ── */}
        <SectionGroup title={SETTINGS_GROUP_META.overview.title} groupId={SETTINGS_GROUP_META.overview.id}>
          <div id={settingsSectionElementID('config')} data-settings-section="config" class="scroll-mt-6">
            <SettingsCard
              icon={FileCode}
              title="Config File"
              description="Location of the runtime configuration file."
              badge="Read-only"
              actions={<ViewToggle value={configView} onChange={(value) => setConfigView(value)} />}
            >
              <Show when={configView() === 'ui'} fallback={<JSONEditor value={configJSONText()} onChange={() => undefined} disabled rows={4} />}>
                <SettingsKeyValueTable
                  rows={[
                    {
                      label: 'Path',
                      value: configPath() || '(unknown)',
                      note: 'Runtime config file on local disk.',
                      mono: true,
                    },
                  ]}
                />
              </Show>
            </SettingsCard>
          </div>

          <div id={settingsSectionElementID('connection')} data-settings-section="connection" class="scroll-mt-6">
            <SettingsCard
              icon={Globe}
              title="Connection"
              description="Connection details managed by the control plane."
              badge="Read-only"
              actions={<ViewToggle value={connectionView} onChange={(value) => setConnectionView(value)} />}
            >
              <Show when={connectionView() === 'ui'} fallback={<JSONEditor value={connectionJSONText()} onChange={() => undefined} disabled rows={10} />}>
                <SettingsKeyValueTable
                  minWidthClass="min-w-[52rem]"
                  rows={[
                    {
                      label: 'Control Plane',
                      value: String(settings()?.connection?.controlplane_base_url ?? ''),
                      note: 'Base URL used for the control plane contract.',
                      mono: true,
                    },
                    {
                      label: 'Environment ID',
                      value: String(settings()?.connection?.environment_id ?? ''),
                      note: 'Public environment identifier.',
                      mono: true,
                    },
                    {
                      label: 'Runtime Instance ID',
                      value: String(settings()?.connection?.agent_instance_id ?? ''),
                      note: 'Current runtime instance identifier.',
                      mono: true,
                    },
                    {
                      label: 'Direct Channel',
                      value: String(settings()?.connection?.direct?.channel_id ?? ''),
                      note: 'Direct control channel id.',
                      mono: true,
                    },
                    {
                      label: 'Direct Suite',
                      value: String(settings()?.connection?.direct?.default_suite ?? ''),
                      note: 'Default cryptographic suite negotiated for direct sessions.',
                      mono: true,
                    },
                    {
                      label: 'E2EE PSK',
                      value: settings()?.connection?.direct?.e2ee_psk_set ? 'Configured' : 'Not set',
                      note: 'Derived status only. Plaintext secret is never shown.',
                    },
                    {
                      label: 'Direct WebSocket URL',
                      value: String(settings()?.connection?.direct?.ws_url ?? ''),
                      note: 'WebSocket endpoint for the direct control connection.',
                      mono: true,
                    },
                  ]}
                />
              </Show>
            </SettingsCard>
          </div>

          <div id={settingsSectionElementID('agent')} data-settings-section="agent" class="scroll-mt-6">
            <SettingsCard
              icon={Zap}
              title="Runtime Status"
              description="Version, health, update, and restart controls for this runtime."
              badge={agentCardBadge()}
              badgeVariant={agentCardBadgeVariant()}
              error={maintenanceError()}
              actions={
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    class="w-full sm:w-auto"
                    onClick={() => setRestartOpen(true)}
                    loading={isRestarting()}
                    disabled={!canStartRestart()}
                  >
                    Restart runtime
                  </Button>
                  <Show when={upgradeState().allowsUpgradeAction}>
                    <Button
                      size="sm"
                      variant="default"
                      class="w-full sm:w-auto"
                      onClick={() => setUpgradeOpen(true)}
                      loading={isUpgrading()}
                      disabled={!canStartUpgrade()}
                    >
                      {upgradeState().actionLabel}
                    </Button>
                  </Show>
                </>
              }
            >
              <SettingsTable minWidthClass="min-w-[44rem]">
                <SettingsTableHead>
                  <SettingsTableHeaderRow>
                    <SettingsTableHeaderCell class="w-48">Metric</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell class="w-72">Notes</SettingsTableHeaderCell>
                  </SettingsTableHeaderRow>
                </SettingsTableHead>
                <SettingsTableBody>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">Current version</SettingsTableCell>
                    <SettingsTableCell class="font-mono text-[11px]">{runtimeUpdate.version.currentVersion() || '—'}</SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">Version currently running on this endpoint.</SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">Latest version</SettingsTableCell>
                    <SettingsTableCell class="font-mono text-[11px]">
                      {latestVersion()?.latest_version ? String(latestVersion()!.latest_version) : latestVersionLoading() ? 'Loading...' : '—'}
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">Latest release metadata resolved by the updater.</SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">Status</SettingsTableCell>
                    <SettingsTableCell>
                      <SettingsPill tone={displayedStatus() === 'online' ? 'success' : displayedStatus() === 'offline' ? 'warning' : 'default'}>
                        {statusLabel()}
                      </SettingsPill>
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">Current status as observed by the maintenance controller.</SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">Service owner</SettingsTableCell>
                    <SettingsTableCell>{formatRuntimeServiceOwner(runtimeService())}</SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">Lifecycle owner for this persistent Runtime Service.</SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">Compatibility</SettingsTableCell>
                    <SettingsTableCell>
                      <SettingsPill tone={runtimeServiceCompatibilityTone(runtimeService())}>
                        {formatRuntimeServiceCompatibility(runtimeService())}
                      </SettingsPill>
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">
                      {runtimeService()?.compatibilityMessage || 'Desktop and Runtime Service compatibility state.'}
                    </SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">Active work</SettingsTableCell>
                    <SettingsTableCell>{activeWorkSummary()}</SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">Live work that may be interrupted by maintenance.</SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">Runtime protocol</SettingsTableCell>
                    <SettingsTableCell class="font-mono text-[11px]">{runtimeService()?.protocolVersion || '—'}</SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">Service identity protocol reported by the runtime.</SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">Desktop AI Broker</SettingsTableCell>
                    <SettingsTableCell>
                      <SettingsPill tone={desktopBrokerBindingTone(runtimeDesktopBrokerBinding()?.state)}>
                        {formatDesktopBrokerBindingState(runtimeDesktopBrokerBinding()?.state)}
                      </SettingsPill>
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">
                      {runtimeDesktopBrokerBinding()?.lastError || 'Runtime Service binding state for Desktop-provided Flower models.'}
                    </SettingsTableCell>
                  </SettingsTableRow>
                  <Show when={upgradeState().allowsUpgradeAction && upgradeState().policy !== 'desktop_release'}>
                    <SettingsTableRow>
                      <SettingsTableCell class="font-medium text-muted-foreground">Target version</SettingsTableCell>
                      <SettingsTableCell>
                        <Input
                          value={targetVersionInput()}
                          onInput={(event) => setTargetVersionInput(event.currentTarget.value)}
                          placeholder="v1.2.3"
                          size="sm"
                          class="w-full"
                          disabled={maintaining()}
                        />
                      </SettingsTableCell>
                      <SettingsTableCell class="text-[11px] text-muted-foreground">
                        Release tag used when the update action is triggered.
                      </SettingsTableCell>
                    </SettingsTableRow>
                  </Show>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">Manifest ETag</SettingsTableCell>
                    <SettingsTableCell class="font-mono text-[11px]">{latestVersion()?.manifest_etag ? String(latestVersion()!.manifest_etag) : '—'}</SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">Cache validator for the latest version manifest.</SettingsTableCell>
                  </SettingsTableRow>
                </SettingsTableBody>
              </SettingsTable>

              <div class="space-y-2">
                <Show when={targetUpgradeVersion() && !targetUpgradeVersionValid()}>
                  <div class="text-xs text-destructive">Use a valid release tag, for example: v1.2.3.</div>
                </Show>
                <Show when={upgradeState().message}>
                  <div class="text-xs text-muted-foreground">{upgradeState().message}</div>
                </Show>
                <Show when={upgradeState().policy === 'desktop_release' && upgradeState().releasePageURL}>
                  <div class="text-xs text-muted-foreground">Desktop can open the matching release page if the installed app needs to be updated first.</div>
                </Show>
                <Show when={latestVersionError()}>
                  <div class="text-xs text-destructive">Latest version metadata is unavailable: {latestVersionError()}</div>
                </Show>
                <Show when={latestVersion()?.stale}>
                  <div class="text-xs text-muted-foreground">Using stale version metadata from cache. Please retry refresh if possible.</div>
                </Show>
                <Show when={!canAdmin()}>
                  <div class="text-xs text-muted-foreground">Admin permission required.</div>
                </Show>
                <Show when={maintenanceStage()}>
                  <div class="text-xs text-muted-foreground">{maintenanceStage()}</div>
                </Show>
              </div>
            </SettingsCard>
          </div>
        </SectionGroup>

        {/* ── Runtime Configuration ── */}
        <SectionGroup title={SETTINGS_GROUP_META.runtime_configuration.title} groupId={SETTINGS_GROUP_META.runtime_configuration.id}>
          <div id={settingsSectionElementID('runtime')} data-settings-section="runtime" class="scroll-mt-6">
            <SettingsCard
              icon={Terminal}
              title="Shell & Workspace"
              description="Default shell and working directory for runtime-backed tools."
              badge="Manual restart required"
              badgeVariant="warning"
              error={runtimeError()}
              actions={
                <>
                  <ViewToggle value={runtimeView} disabled={!canInteract()} onChange={(value) => switchRuntimeView(value)} />
                  <AutoSaveIndicator
                    dirty={runtimeDirty()}
                    saving={runtimeSaving()}
                    error={runtimeError()}
                    savedAt={runtimeSavedAt()}
                    enabled={canInteract()}
                  />
                </>
              }
            >
              <Show
                when={runtimeView() === 'ui'}
                fallback={
                  <JSONEditor
                    value={runtimeJSON()}
                    onChange={(value) => {
                      setRuntimeJSON(value);
                      setRuntimeDirty(true);
                    }}
                    disabled={!canInteract()}
                    rows={5}
                  />
                }
              >
                <SettingsTable minWidthClass="min-w-[42rem]">
                  <SettingsTableHead>
                    <SettingsTableHeaderRow>
                      <SettingsTableHeaderCell class="w-48">Setting</SettingsTableHeaderCell>
                      <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
                      <SettingsTableHeaderCell class="w-72">Notes</SettingsTableHeaderCell>
                    </SettingsTableHeaderRow>
                  </SettingsTableHead>
                  <SettingsTableBody>
                    <SettingsTableRow>
                      <SettingsTableCell class="font-medium text-muted-foreground">agent_home_dir</SettingsTableCell>
                      <SettingsTableCell>
                        <Input
                          value={agentHomeDir()}
                          onInput={(event) => {
                            setAgentHomeDir(event.currentTarget.value);
                            setRuntimeDirty(true);
                          }}
                          placeholder="/home/user"
                          size="sm"
                          class="w-full"
                          disabled={!canInteract()}
                        />
                      </SettingsTableCell>
                      <SettingsTableCell class="text-[11px] text-muted-foreground">Defaults to the user home directory if left empty.</SettingsTableCell>
                    </SettingsTableRow>
                    <SettingsTableRow>
                      <SettingsTableCell class="font-medium text-muted-foreground">shell</SettingsTableCell>
                      <SettingsTableCell>
                        <Input
                          value={shell()}
                          onInput={(event) => {
                            setShell(event.currentTarget.value);
                            setRuntimeDirty(true);
                          }}
                          placeholder="/bin/bash"
                          size="sm"
                          class="w-full"
                          disabled={!canInteract()}
                        />
                      </SettingsTableCell>
                      <SettingsTableCell class="text-[11px] text-muted-foreground">Defaults to `$SHELL` if left empty.</SettingsTableCell>
                    </SettingsTableRow>
                  </SettingsTableBody>
                </SettingsTable>
              </Show>
            </SettingsCard>
          </div>

          <div id={settingsSectionElementID('logging')} data-settings-section="logging" class="scroll-mt-6">
            <SettingsCard
              icon={Database}
              title="Logging"
              description="Log format and verbosity for backend runtime logs."
              badge="Log changes require restart"
              badgeVariant="warning"
              error={loggingError()}
              actions={
                <>
                  <ViewToggle value={loggingView} disabled={!canInteract()} onChange={(value) => switchLoggingView(value)} />
                  <AutoSaveIndicator
                    dirty={loggingDirty()}
                    saving={loggingSaving()}
                    error={loggingError()}
                    savedAt={loggingSavedAt()}
                    enabled={canInteract()}
                  />
                </>
              }
            >
              <Show
                when={loggingView() === 'ui'}
                fallback={
                  <JSONEditor
                    value={loggingJSON()}
                    onChange={(value) => {
                      setLoggingJSON(value);
                      setLoggingDirty(true);
                    }}
                    disabled={!canInteract()}
                    rows={5}
                  />
                }
              >
                <div class="space-y-4">
                  <SettingsTable minWidthClass="min-w-[44rem]">
                    <SettingsTableHead>
                      <SettingsTableHeaderRow>
                        <SettingsTableHeaderCell class="w-48">Setting</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-72">Notes</SettingsTableHeaderCell>
                      </SettingsTableHeaderRow>
                    </SettingsTableHead>
                    <SettingsTableBody>
                      <SettingsTableRow>
                        <SettingsTableCell class="font-medium text-muted-foreground">log_format</SettingsTableCell>
                        <SettingsTableCell>
                          <Select
                            value={logFormat()}
                            onChange={(value) => {
                              setLogFormat(value);
                              setLoggingDirty(true);
                            }}
                            disabled={!canInteract()}
                            options={[
                              { value: '', label: 'Default (json)' },
                              { value: 'json', label: 'json' },
                              { value: 'text', label: 'text' },
                            ]}
                            class="w-full"
                          />
                        </SettingsTableCell>
                        <SettingsTableCell class="text-[11px] text-muted-foreground">Choose the log serialization format.</SettingsTableCell>
                      </SettingsTableRow>
                      <SettingsTableRow>
                        <SettingsTableCell class="font-medium text-muted-foreground">log_level</SettingsTableCell>
                        <SettingsTableCell>
                          <Select
                            value={logLevel()}
                            onChange={(value) => {
                              setLogLevel(value);
                              setLoggingDirty(true);
                            }}
                            disabled={!canInteract()}
                            options={[
                              { value: '', label: 'Default (info)' },
                              { value: 'debug', label: 'debug' },
                              { value: 'info', label: 'info' },
                              { value: 'warn', label: 'warn' },
                              { value: 'error', label: 'error' },
                            ]}
                            class="w-full"
                          />
                        </SettingsTableCell>
                        <SettingsTableCell class="text-[11px] text-muted-foreground">Controls runtime log verbosity only. Debug Console is a separate frontend diagnostics surface.</SettingsTableCell>
                      </SettingsTableRow>
                    </SettingsTableBody>
                  </SettingsTable>
                </div>
              </Show>
            </SettingsCard>
          </div>

        </SectionGroup>

        {/* ── Codespaces & Tooling ── */}
        <SectionGroup title={SETTINGS_GROUP_META.codespaces_tooling.title} groupId={SETTINGS_GROUP_META.codespaces_tooling.id}>
          <div id={settingsSectionElementID('codespaces')} data-settings-section="codespaces" class="scroll-mt-6">
            <div class="space-y-4">
              <CodeRuntimeSettingsCard
                status={codeRuntimeStatus()}
                loading={codeRuntimeStatus.loading}
                error={codeRuntimeStatusError()}
                canInteract={canInteract()}
                canManage={canManageCodeRuntime()}
                actionLoading={codeRuntimeActionLoading()}
                cancelLoading={codeRuntimeCancelLoading()}
                selectionLoadingVersion={codeRuntimeSelectionLoadingVersion()}
                removeVersionLoading={codeRuntimeRemoveVersionLoading()}
                onRefresh={() => void refreshCodeRuntimeStatus()}
                onInstall={() => installManagedCodeRuntime()}
                onSelectVersion={(version) => selectManagedCodeRuntimeVersion(version)}
                onRemoveVersion={(version) => removeManagedCodeRuntimeVersion(version)}
                onCancel={() => cancelManagedCodeRuntimeOperation()}
              />

              <SettingsCard
                icon={Code}
                title="Codespaces Ports"
                description="Configure the port range used for Codespaces instances."
                error={codespacesError()}
                actions={
                  <>
                    <ViewToggle value={codespacesView} disabled={!canInteract()} onChange={(value) => switchCodespacesView(value)} />
                    <AutoSaveIndicator
                      dirty={codespacesDirty()}
                      saving={codespacesSaving()}
                      error={codespacesError()}
                      savedAt={codespacesSavedAt()}
                      enabled={canInteract()}
                    />
                  </>
                }
              >
                <Show
                  when={codespacesView() === 'ui'}
                  fallback={
                    <JSONEditor
                      value={codespacesJSON()}
                      onChange={(value) => {
                        setCodespacesJSON(value);
                        setCodespacesDirty(true);
                      }}
                      disabled={!canInteract()}
                      rows={5}
                    />
                  }
                >
                  <SettingsTable minWidthClass="min-w-[48rem]">
                    <SettingsTableHead>
                      <SettingsTableHeaderRow>
                        <SettingsTableHeaderCell class="w-48">Setting</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-72">Notes</SettingsTableHeaderCell>
                      </SettingsTableHeaderRow>
                    </SettingsTableHead>
                    <SettingsTableBody>
                      <SettingsTableRow>
                        <SettingsTableCell class="font-medium text-muted-foreground">Port policy</SettingsTableCell>
                        <SettingsTableCell>
                          <div class="flex items-center gap-3">
                            <Checkbox
                              checked={useDefaultCodePorts()}
                              onChange={(value) => {
                                setUseDefaultCodePorts(value);
                                setCodespacesDirty(true);
                              }}
                              disabled={!canInteract()}
                              label="Use default port range"
                              size="sm"
                            />
                            <SettingsPill tone={useDefaultCodePorts() ? 'success' : 'default'}>
                              {useDefaultCodePorts() ? 'Default' : 'Custom'}
                            </SettingsPill>
                          </div>
                        </SettingsTableCell>
                        <SettingsTableCell class="text-[11px] text-muted-foreground">
                          Default range: <span class="font-mono">{DEFAULT_CODE_SERVER_PORT_MIN}</span> - <span class="font-mono">{DEFAULT_CODE_SERVER_PORT_MAX}</span>
                        </SettingsTableCell>
                      </SettingsTableRow>
                      <SettingsTableRow>
                        <SettingsTableCell class="font-medium text-muted-foreground">Effective range</SettingsTableCell>
                        <SettingsTableCell class="font-mono text-[11px]">
                          {codespacesEffective().effective_min} - {codespacesEffective().effective_max}
                        </SettingsTableCell>
                        <SettingsTableCell class="text-[11px] text-muted-foreground">Computed range after validation and fallback logic.</SettingsTableCell>
                      </SettingsTableRow>
                      <SettingsTableRow>
                        <SettingsTableCell class="font-medium text-muted-foreground">code_server_port_min</SettingsTableCell>
                        <SettingsTableCell>
                          <Input
                            value={codePortMin() === '' ? '' : String(codePortMin())}
                            onInput={(event) => {
                              const value = event.currentTarget.value.trim();
                              setCodePortMin(value ? Number(value) : '');
                              setCodespacesDirty(true);
                            }}
                            placeholder="20000"
                            size="sm"
                            class="w-full"
                            disabled={!canInteract() || useDefaultCodePorts()}
                          />
                        </SettingsTableCell>
                        <SettingsTableCell class="text-[11px] text-muted-foreground">Start of the custom code-server port range.</SettingsTableCell>
                      </SettingsTableRow>
                      <SettingsTableRow>
                        <SettingsTableCell class="font-medium text-muted-foreground">code_server_port_max</SettingsTableCell>
                        <SettingsTableCell>
                          <Input
                            value={codePortMax() === '' ? '' : String(codePortMax())}
                            onInput={(event) => {
                              const value = event.currentTarget.value.trim();
                              setCodePortMax(value ? Number(value) : '');
                              setCodespacesDirty(true);
                            }}
                            placeholder="21000"
                            size="sm"
                            class="w-full"
                            disabled={!canInteract() || useDefaultCodePorts()}
                          />
                        </SettingsTableCell>
                        <SettingsTableCell class="text-[11px] text-muted-foreground">End of the custom code-server port range.</SettingsTableCell>
                      </SettingsTableRow>
                    </SettingsTableBody>
                  </SettingsTable>
                </Show>
              </SettingsCard>
            </div>
          </div>
        </SectionGroup>

        {/* ── Security ── */}
        <SectionGroup title={SETTINGS_GROUP_META.security.title} groupId={SETTINGS_GROUP_META.security.id}>
          <div id={settingsSectionElementID('permission_policy')} data-settings-section="permission_policy" class="scroll-mt-6">
            <SettingsCard
              icon={Shield}
              title="Permission Policy"
              description="Control read, write, and execute permissions. Saved changes apply after a manual restart."
              badge="Manual restart required"
              badgeVariant="warning"
              error={policyError()}
              actions={
                <>
                  <ViewToggle value={policyView} disabled={!canInteract()} onChange={(value) => switchPolicyView(value)} />
                  <AutoSaveIndicator
                    dirty={policyDirty()}
                    saving={policySaving()}
                    error={policyError()}
                    savedAt={policySavedAt()}
                    enabled={canInteract()}
                  />
                </>
              }
            >
              <Show
                when={policyView() === 'ui'}
                fallback={
                  <JSONEditor
                    value={policyJSON()}
                    onChange={(value) => {
                      setPolicyJSON(value);
                      setPolicyDirty(true);
                    }}
                    disabled={!canInteract()}
                    rows={12}
                  />
                }
              >
                <div class="space-y-6">
                  <div class="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5">
                    <span class="text-xs text-muted-foreground">schema_version</span>
                    <CodeBadge>1</CodeBadge>
                  </div>

                  <div class="space-y-3">
                    <SubSectionHeader title="local_max" description="Global permission ceiling for this runtime. User and app rules are clamped to these limits." />
                    <PermissionMatrixTable
                      read={policyLocalRead()}
                      write={policyLocalWrite()}
                      execute={policyLocalExecute()}
                      canInteract={canInteract()}
                      onChange={(key, value) => {
                        if (key === 'read') setPolicyLocalRead(value);
                        else if (key === 'write') setPolicyLocalWrite(value);
                        else setPolicyLocalExecute(value);
                        setPolicyDirty(true);
                      }}
                    />
                  </div>

                  <div class="space-y-3">
                    <SubSectionHeader
                      title="by_user"
                      description="Per-user permission overrides."
                      actions={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPolicyByUser((prev) => [...prev, { key: '', read: policyLocalRead(), write: policyLocalWrite(), execute: policyLocalExecute() }]);
                            setPolicyDirty(true);
                          }}
                          disabled={!canInteract()}
                        >
                          Add Rule
                        </Button>
                      }
                    />
                    <PermissionRuleTable
                      rows={policyByUser()}
                      emptyMessage="No user-specific overrides."
                      keyHeader="User"
                      keyPlaceholder="user_public_id"
                      canInteract={canInteract()}
                      readEnabled={policyLocalRead()}
                      writeEnabled={policyLocalWrite()}
                      executeEnabled={policyLocalExecute()}
                      onChangeKey={(index, value) => {
                        setPolicyByUser((prev) => prev.map((item, rowIndex) => (rowIndex === index ? { ...item, key: value } : item)));
                        setPolicyDirty(true);
                      }}
                      onChangePerm={(index, key, value) => {
                        setPolicyByUser((prev) => prev.map((item, rowIndex) => (rowIndex === index ? { ...item, [key]: value } : item)));
                        setPolicyDirty(true);
                      }}
                      onRemove={(index) => {
                        setPolicyByUser((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
                        setPolicyDirty(true);
                      }}
                    />
                  </div>

                  <div class="space-y-3">
                    <SubSectionHeader
                      title="by_app"
                      description="Per-application permission overrides."
                      actions={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPolicyByApp((prev) => [...prev, { key: '', read: policyLocalRead(), write: policyLocalWrite(), execute: policyLocalExecute() }]);
                            setPolicyDirty(true);
                          }}
                          disabled={!canInteract()}
                        >
                          Add Rule
                        </Button>
                      }
                    />
                    <PermissionRuleTable
                      rows={policyByApp()}
                      emptyMessage="No app-specific overrides."
                      keyHeader="App"
                      keyPlaceholder="floe_app identifier"
                      canInteract={canInteract()}
                      readEnabled={policyLocalRead()}
                      writeEnabled={policyLocalWrite()}
                      executeEnabled={policyLocalExecute()}
                      onChangeKey={(index, value) => {
                        setPolicyByApp((prev) => prev.map((item, rowIndex) => (rowIndex === index ? { ...item, key: value } : item)));
                        setPolicyDirty(true);
                      }}
                      onChangePerm={(index, key, value) => {
                        setPolicyByApp((prev) => prev.map((item, rowIndex) => (rowIndex === index ? { ...item, [key]: value } : item)));
                        setPolicyDirty(true);
                      }}
                      onRemove={(index) => {
                        setPolicyByApp((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
                        setPolicyDirty(true);
                      }}
                    />
                  </div>
                </div>
              </Show>
            </SettingsCard>
          </div>

        </SectionGroup>

        {/* ── AI & Extensions ── */}
        <SectionGroup title={SETTINGS_GROUP_META.ai_extensions.title} groupId={SETTINGS_GROUP_META.ai_extensions.id}>
          <div id={settingsSectionElementID('ai')} data-settings-section="ai" class="scroll-mt-6">
            <SettingsCard
              icon={FlowerIcon}
              title="Flower"
              description="Configure Flower providers, models, execution safeguards, and local AI secrets. Changes are auto-saved when the form is valid."
              badge={flowerBadge()}
              badgeVariant={flowerBadgeVariant()}
              error={aiError()}
              actions={
                <>
                  <ViewToggle value={aiView} disabled={!canInteract()} onChange={(value) => switchAIView(value)} />
                  <AutoSaveIndicator
                    dirty={aiDirty()}
                    saving={aiSaving()}
                    error={aiError()}
                    savedAt={aiSavedAt()}
                    enabled={canInteract()}
                  />
                  <Show when={aiEnabled()}>
                    <Button size="sm" variant="destructive" onClick={() => setDisableAIOpen(true)} disabled={!canInteract() || aiSaving()}>
                      Disable Flower
                    </Button>
                  </Show>
                </>
              }
            >
              <Show when={!aiEnabled() && !settings.loading && !settings.error}>
                <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
                  <Zap class="h-5 w-5 text-muted-foreground" />
                  <div class="text-sm text-muted-foreground">
                    {formatDesktopBrokerNotice(desktopBrokerBindingState(), desktopBrokerStatus())}
                  </div>
                </div>
              </Show>

              <Show
                when={aiView() === 'ui'}
                fallback={
                  <JSONEditor
                    value={aiJSON()}
                    onChange={(value) => {
                      setAiJSON(value);
                      setAiDirty(true);
                    }}
                    disabled={!canInteract()}
                    rows={14}
                  />
                }
              >
                <div class="space-y-6">
                  <SettingsTable minWidthClass="min-w-[60rem]">
                    <SettingsTableHead>
                      <SettingsTableHeaderRow>
                        <SettingsTableHeaderCell class="w-52">Setting</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-80">Notes</SettingsTableHeaderCell>
                      </SettingsTableHeaderRow>
                    </SettingsTableHead>
                    <SettingsTableBody>
                      <SettingsTableRow>
                        <SettingsTableCell class="font-medium text-muted-foreground">Require user approval</SettingsTableCell>
                        <SettingsTableCell>
                          <Checkbox
                            checked={aiRequireUserApproval()}
                            onChange={(value) => {
                              setAiRequireUserApproval(value);
                              setAiDirty(true);
                            }}
                            disabled={!canInteract()}
                            label="Require user approval for mutating tools"
                            size="sm"
                          />
                        </SettingsTableCell>
                        <SettingsTableCell class="text-[11px] text-muted-foreground">
                          Plan mode remains strict readonly even when this toggle is off.
                        </SettingsTableCell>
                      </SettingsTableRow>
                      <SettingsTableRow>
                        <SettingsTableCell class="font-medium text-muted-foreground">Block dangerous commands</SettingsTableCell>
                        <SettingsTableCell>
                          <Checkbox
                            checked={aiBlockDangerousCommands()}
                            onChange={(value) => {
                              setAiBlockDangerousCommands(value);
                              setAiDirty(true);
                            }}
                            disabled={!canInteract()}
                            label="Block dangerous terminal commands"
                            size="sm"
                          />
                        </SettingsTableCell>
                        <SettingsTableCell class="text-[11px] text-muted-foreground">
                          Recommended safeguard for direct tool execution in act mode.
                        </SettingsTableCell>
                      </SettingsTableRow>
                      <SettingsTableRow>
                        <SettingsTableCell class="font-medium text-muted-foreground">Current model</SettingsTableCell>
                        <SettingsTableCell>
                          <Select
                            value={aiCurrentModelID()}
                            options={aiModelOptions().map((item) => ({ value: item.id, label: item.label }))}
                            onChange={(value) => {
                              const nextModelID = normalizeAICurrentModelID(String(value ?? '').trim(), aiProviders());
                              if (!nextModelID) return;
                              const prevModelID = normalizeAICurrentModelID(aiCurrentModelID(), aiProviders());
                              if (nextModelID === prevModelID) return;
                              setAiCurrentModelID(nextModelID);
                              const canDirectSave = aiView() === 'ui' && !aiDirty() && !aiSaving() && !disableAISaving();
                              if (canDirectSave) {
                                void saveAICurrentModelDirectly(nextModelID, prevModelID || '');
                                return;
                              }
                              setAiDirty(true);
                            }}
                            placeholder="Select current model..."
                            class="w-full"
                            disabled={!canInteract() || aiModelOptions().length === 0 || aiSaving() || disableAISaving()}
                          />
                        </SettingsTableCell>
                        <SettingsTableCell class="text-[11px] text-muted-foreground">Default model for new chats. Individual threads may still select a different model.</SettingsTableCell>
                      </SettingsTableRow>
                    </SettingsTableBody>
                  </SettingsTable>

                  <Show when={!aiBlockDangerousCommands()}>
                    <div class="flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning/10 p-3">
                      <Shield class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <div class="text-xs font-medium text-foreground">
                        Dangerous command blocking is disabled. The runtime may execute high-risk commands directly.
                      </div>
                    </div>
                  </Show>

                  <div class="space-y-3">
                    <SubSectionHeader
                      title="Providers"
                      description="Provider registry exposed to Flower Chat."
                      actions={
                        <Button size="sm" variant="outline" onClick={() => addAIProviderAndOpenDialog()} disabled={!canInteract()}>
                          Add Provider
                        </Button>
                      }
                    />

                    <SettingsTable minWidthClass="min-w-[72rem]">
                      <SettingsTableHead sticky>
                      <SettingsTableHeaderRow>
                        <SettingsTableHeaderCell class="w-48">Name</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-48">Provider ID</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-32">Type</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell>Base URL</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-28">API Key</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-48">Web Search</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-56">Models</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-32">Actions</SettingsTableHeaderCell>
                      </SettingsTableHeaderRow>
                      </SettingsTableHead>
                      <SettingsTableBody>
                        <For each={aiProviders()}>
                          {(provider, index) => {
                            const providerID = () => String(provider.id ?? '').trim();
                            const displayName = () => String(provider.name ?? '').trim() || providerID() || `Provider ${index() + 1}`;
                            const modelNames = () =>
                              (Array.isArray(provider.models) ? provider.models : [])
                                .map((model) => String(model.model_name ?? '').trim())
                                .filter(Boolean);
                            return (
                              <SettingsTableRow>
                                <SettingsTableCell>
                                  <div class="space-y-1">
                                    <div class="text-sm font-semibold text-foreground">{displayName()}</div>
                                    <Show when={aiCurrentModelID().startsWith(`${providerID()}/`)}>
                                      <SettingsPill tone="success">Current provider</SettingsPill>
                                    </Show>
                                  </div>
                                </SettingsTableCell>
                                <SettingsTableCell class="font-mono text-[11px] break-all">{providerID() || '—'}</SettingsTableCell>
                                <SettingsTableCell>
                                  <SettingsPill>{provider.type}</SettingsPill>
                                </SettingsTableCell>
                                <SettingsTableCell class="font-mono text-[11px] break-all">{String(provider.base_url ?? '').trim() || '—'}</SettingsTableCell>
                                <SettingsTableCell>
                                  <SettingsPill tone={aiProviderKeySet()?.[providerID()] ? 'success' : 'default'}>
                                    {aiProviderKeySet()?.[providerID()] ? 'Key set' : 'Key not set'}
                                  </SettingsPill>
                                </SettingsTableCell>
                                <SettingsTableCell>
                                  <SettingsPill
                                    tone={
                                      providerBuiltInWebSearchLabel(provider.type) ||
                                      (provider.type === 'openai_compatible' && normalizeAIProviderWebSearchMode(provider.web_search?.mode) !== 'disabled')
                                        ? 'success'
                                        : 'default'
                                    }
                                  >
                                    {providerWebSearchSummary(provider)}
                                  </SettingsPill>
                                </SettingsTableCell>
                                <SettingsTableCell>
                                  <div class="space-y-1 text-[11px] text-muted-foreground">
                                    <div>{provider.models?.length ?? 0} model(s)</div>
                                    <div class="break-all font-mono">
                                      {modelNames().slice(0, 2).join(', ') || '—'}
                                      <Show when={modelNames().length > 2}>
                                        <span>{` +${modelNames().length - 2} more`}</span>
                                      </Show>
                                    </div>
                                  </div>
                                </SettingsTableCell>
                                <SettingsTableCell>
                                  <div class="flex items-center gap-2">
                                    <Button size="sm" variant="outline" onClick={() => openAIProviderDialog(index())} disabled={!canInteract()}>
                                      Edit
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      class="text-muted-foreground hover:text-destructive"
                                      onClick={() => {
                                        setAiProviders((prev) => {
                                          const normalizedProviders = normalizeAIProviders(prev.filter((_, rowIndex) => rowIndex !== index()));
                                          setAiCurrentModelID(normalizeAICurrentModelID(aiCurrentModelID(), normalizedProviders));
                                          return normalizedProviders;
                                        });
                                        setAiDirty(true);
                                      }}
                                      disabled={!canInteract() || aiProviders().length <= 1}
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                </SettingsTableCell>
                              </SettingsTableRow>
                            );
                          }}
                        </For>
                      </SettingsTableBody>
                    </SettingsTable>
                  </div>
                </div>
              </Show>
            </SettingsCard>
          </div>

          <div id={settingsSectionElementID('skills')} data-settings-section="skills" class="scroll-mt-6">
            <SettingsCard
              icon={Layers}
              title="Skills"
              description="Manage Flower skills: install from GitHub, browse skill files, toggle enable state, and maintain local skills."
              badge={skillsReloading() || skillsLoading() ? 'Loading' : `${skillsCatalog()?.skills?.length ?? 0} skills`}
              error={skillsError()}
              actions={
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void refreshSkillsCatalog(true)}
                    loading={skillsReloading()}
                    disabled={!canInteract()}
                  >
                    Reload
                  </Button>
                  <Button size="sm" variant="default" onClick={() => openInstallDialog()} disabled={!canInteract() || !canAdmin()}>
                    Install from GitHub
                  </Button>
                  <Button size="sm" variant="default" onClick={() => setSkillCreateOpen(true)} disabled={!canInteract() || !canAdmin()}>
                    Create Skill
                  </Button>
                </>
              }
            >
              <div class="space-y-4">
                <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div class="md:col-span-2">
                    <FieldLabel>Search</FieldLabel>
                    <Input
                      value={skillQuery()}
                      onInput={(event) => setSkillQuery(event.currentTarget.value)}
                      placeholder="Search by name, description, or path"
                      size="sm"
                      class="w-full"
                      disabled={!canInteract()}
                    />
                  </div>
                  <div>
                    <FieldLabel>Scope</FieldLabel>
                    <Select
                      value={skillScopeFilter()}
                      onChange={(value) => setSkillScopeFilter(value as 'all' | 'user' | 'user_agents')}
                      disabled={!canInteract()}
                      options={[
                        { value: 'all', label: 'All scopes' },
                        { value: 'user', label: 'User (.redeven)' },
                        { value: 'user_agents', label: 'User (.agents)' },
                      ]}
                      class="w-full"
                    />
                  </div>
                </div>

                <SkillsCatalogTable
                  skills={filteredSkills()}
                  sources={skillSources()}
                  loading={skillsLoading()}
                  canInteract={canInteract()}
                  canAdmin={canAdmin()}
                  toggleSaving={skillToggleSaving()}
                  reinstalling={skillReinstalling()}
                  onToggle={(entry, enabled) => {
                    void toggleSkill(entry, enabled);
                  }}
                  onBrowse={openSkillBrowse}
                  onReinstall={(entry) => {
                    void reinstallSkill(entry);
                  }}
                  onDelete={askDeleteSkill}
                />

                <Show when={(skillsCatalog()?.conflicts?.length ?? 0) > 0}>
                  <div class="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3">
                    <div class="text-xs font-semibold text-warning">Conflicts detected: {skillsCatalog()?.conflicts?.length ?? 0}</div>
                    <For each={(skillsCatalog()?.conflicts ?? []).slice(0, 5)}>
                      {(item) => <div class="break-all text-[11px] text-warning">{item.name}: {item.path}</div>}
                    </For>
                  </div>
                </Show>

                <Show when={(skillsCatalog()?.errors?.length ?? 0) > 0}>
                  <div class="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                    <div class="text-xs font-semibold text-destructive">Catalog errors: {skillsCatalog()?.errors?.length ?? 0}</div>
                    <For each={(skillsCatalog()?.errors ?? []).slice(0, 5)}>
                      {(item) => <div class="break-all text-[11px] text-destructive">{item.path}: {item.message}</div>}
                    </For>
                  </div>
                </Show>
              </div>
            </SettingsCard>
          </div>

          <div id={settingsSectionElementID('codex')} data-settings-section="codex" class="scroll-mt-6">
            <SettingsCard
              icon={CodexIcon}
              title="Codex"
              description="Host-managed Codex diagnostics. Redeven reads the host `codex` binary status here but does not persist Codex runtime settings."
              badge={codexStatus()?.available ? 'Host detected' : 'Needs host install'}
              badgeVariant={codexStatus()?.available ? 'success' : 'default'}
              error={codexStatusError()}
              actions={
                <Button size="sm" variant="outline" onClick={() => void refreshCodexHostStatus()} disabled={codexStatus.loading}>
                  <RefreshIcon class="mr-2 h-4 w-4" />
                  {codexStatus.loading ? 'Refreshing...' : 'Refresh'}
                </Button>
              }
            >
              <div class="space-y-6">
                <div class="flex flex-wrap gap-2">
                  <SettingsPill tone={codexStatus()?.available ? 'success' : 'default'}>
                    {codexStatus()?.available ? 'Host binary detected' : 'Install Codex on host'}
                  </SettingsPill>
                  <SettingsPill tone={codexStatus()?.ready ? 'success' : 'default'}>
                    {codexStatus()?.ready ? 'Bridge connected' : 'Bridge starts on demand'}
                  </SettingsPill>
                </div>

                <Show when={!codexStatus()?.available}>
                  <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
                    <Code class="h-5 w-5 text-muted-foreground" />
                    <div class="text-sm text-muted-foreground">
                      Redeven is waiting for the host <span class="font-mono">codex</span> binary. Install it on the host and expose it on <span class="font-mono">PATH</span>; this page remains diagnostics-only and does not store Codex runtime settings.
                    </div>
                  </div>
                </Show>

                <SettingsKeyValueTable rows={codexStatusRows()} minWidthClass="min-w-[52rem]" />

                <div class="rounded-lg border border-border bg-muted/20 p-4">
                  <div class="text-sm font-semibold text-foreground">Notes</div>
                  <div class="mt-2 space-y-1 text-xs leading-6 text-muted-foreground">
                    <div>Codex keeps its own runtime defaults on the host; Redeven does not mirror them into <span class="font-mono">config.json</span>.</div>
                    <div>The dedicated Codex activity entry and gateway namespace stay isolated from Flower, so both surfaces can evolve independently.</div>
                  </div>
                </div>
              </div>
            </SettingsCard>
          </div>
        </SectionGroup>

        {/* ── Diagnostics ── */}
        <SectionGroup title={SETTINGS_GROUP_META.diagnostics.title} groupId={SETTINGS_GROUP_META.diagnostics.id}>
          <div id={settingsSectionElementID('debug_console')} data-settings-section="debug_console" class="scroll-mt-6">
            <SettingsCard
              icon={RefreshIcon}
              title="Debug Console"
              description="Frontend-only diagnostics controls for the floating request and UI-performance console."
              actions={<SettingsPill tone="success">Local UI state</SettingsPill>}
            >
              <EnvDebugConsoleSettingsPanel
                enabled={debugConsoleEnabled()}
                canInteract={canInteract()}
                onEnabledChange={(value) => env.setDebugConsoleEnabled(value)}
              />
            </SettingsCard>
          </div>
        </SectionGroup>
          </div>
        </div>
      </div>

      <AIProviderDialog
        open={aiProviderDialogOpen()}
        onOpenChange={(open) => {
          if (open) {
            setAiProviderDialogOpen(true);
            return;
          }
          closeAIProviderDialog();
        }}
        title={aiProviderDialogTitle()}
        provider={aiProviderDialogProvider()}
        canInteract={canInteract()}
        canAdmin={canAdmin()}
        aiSaving={aiSaving()}
        disableAISaving={disableAISaving()}
        keySet={!!aiProviderKeySet()?.[String(aiProviderDialogProvider()?.id ?? '').trim()]}
        keyDraft={aiProviderKeyDraft()?.[String(aiProviderDialogProvider()?.id ?? '').trim()] ?? ''}
        keySaving={!!aiProviderKeySaving()?.[String(aiProviderDialogProvider()?.id ?? '').trim()]}
        webSearchKeySet={!!webSearchKeySet()?.[String(aiProviderDialogProvider()?.id ?? '').trim()]}
        webSearchKeyDraft={webSearchKeyDraft()?.[String(aiProviderDialogProvider()?.id ?? '').trim()] ?? ''}
        webSearchKeySaving={!!webSearchKeySaving()?.[String(aiProviderDialogProvider()?.id ?? '').trim()]}
        presetModel={aiProviderPresetModel()}
        recommendedModels={aiProviderDialogRecommendedModels()}
        recommendedModelOptions={aiProviderDialogRecommendedModelOptions()}
        onConfirm={() => confirmAIProviderDialog()}
        onChangeName={(value) => {
          updateAIProviderDialogDraft((current) => ({ ...current, name: value }));
        }}
        onChangeType={(nextType) => {
          const nextPreset = providerPresetForType(nextType);
          const nextPresetModels = recommendedModelsForProviderType(nextType).map((model) => ({
            model_name: model.model_name,
            context_window: normalizePositiveInteger(model.context_window),
            max_output_tokens: normalizePositiveInteger(model.max_output_tokens),
            effective_context_window_percent: normalizeEffectiveContextPercent(model.effective_context_window_percent),
          }));
          updateAIProviderDialogDraft((current) => ({
            ...current,
            name:
              !String(current.name ?? '').trim() || String(current.name ?? '').trim() === providerPresetForType(current.type).name
                ? nextPreset.name
                : current.name,
            type: nextType,
            base_url: defaultBaseURLForProviderType(nextType),
            web_search: normalizeAIProviderWebSearchForType(nextType, nextPreset.web_search),
            models:
              nextPresetModels.length > 0
                ? nextPresetModels
                : [{ model_name: '', context_window: defaultContextWindowForProviderType(nextType) }],
          }));
          setAiProviderPresetModel(String(nextPreset.models[0]?.model_name ?? ''));
        }}
        onChangeBaseURL={(value) => {
          updateAIProviderDialogDraft((current) => ({ ...current, base_url: value }));
        }}
        onChangeKeyDraft={(value) => {
          const id = String(aiProviderDialogProvider()?.id ?? '').trim();
          if (!id) return;
          setAiProviderKeyDraft((prev) => ({ ...prev, [id]: value }));
        }}
        onSaveKey={() => saveAIProviderKey(String(aiProviderDialogProvider()?.id ?? '').trim())}
        onClearKey={() => clearAIProviderKey(String(aiProviderDialogProvider()?.id ?? '').trim())}
        onChangeWebSearchMode={(mode) => {
          updateAIProviderDialogDraft((current) => ({
            ...current,
            web_search: normalizeAIProviderWebSearchForType(current.type, mode),
          }));
          const id = String(aiProviderDialogProvider()?.id ?? '').trim();
          if (mode === 'brave' && id) void refreshWebSearchKeyStatus([id]);
        }}
        onChangeWebSearchKeyDraft={(value) => {
          const id = String(aiProviderDialogProvider()?.id ?? '').trim();
          if (!id) return;
          setWebSearchKeyDraft((prev) => ({ ...prev, [id]: value }));
        }}
        onSaveWebSearchKey={() => saveWebSearchKey(String(aiProviderDialogProvider()?.id ?? '').trim())}
        onClearWebSearchKey={() => clearWebSearchKey(String(aiProviderDialogProvider()?.id ?? '').trim())}
        onSetPresetModel={(value) => setAiProviderPresetModel(value)}
        onApplyAllPresets={() => applyRecommendedModelsToDraft()}
        onAddSelectedPreset={() => addRecommendedModelToDraft(aiProviderPresetModel())}
        onAddModel={() => {
          updateAIProviderDialogDraft((current) => ({
            ...current,
            models: [
              ...(Array.isArray(current.models) ? current.models : []),
              { model_name: '', context_window: defaultContextWindowForProviderType(current.type) },
            ],
          }));
        }}
        onChangeModelName={(index, value) => {
          updateAIProviderDialogDraft((current) => ({
            ...current,
            models: (Array.isArray(current.models) ? current.models : []).map((model, modelIndex) =>
              modelIndex === index ? { ...model, model_name: value } : model,
            ),
          }));
        }}
        onChangeModelNumber={(index, key, rawValue) => {
          updateAIProviderDialogModelField(index, key, rawValue);
        }}
        onRemoveModel={(index) => {
          updateAIProviderDialogDraft((current) => {
            const nextModels = (Array.isArray(current.models) ? current.models : []).filter((_, modelIndex) => modelIndex !== index);
            return {
              ...current,
              models: nextModels.length > 0 ? nextModels : [{ model_name: '', context_window: defaultContextWindowForProviderType(current.type) }],
            };
          });
        }}
      />

      {/* Update Runtime Confirmation Dialog */}
      <ConfirmDialog
        open={upgradeOpen()}
        onOpenChange={(open) => setUpgradeOpen(open)}
        title={upgradeState().policy === 'desktop_release' ? 'Update Redeven Desktop?' : 'Update Runtime Service?'}
        confirmText={upgradeState().policy === 'desktop_release' ? 'Continue' : 'Update'}
        loading={isUpgrading()}
        onConfirm={() => void startUpgrade()}
      >
        <div class="space-y-3">
          <Show
            when={upgradeState().policy === 'desktop_release'}
            fallback={(
              <>
                <p class="text-sm">This Runtime Service is persistent and may have live work.</p>
                <p class="text-xs text-muted-foreground">Active work: {activeWorkSummary()}.</p>
                <p class="text-xs text-muted-foreground">You will reconnect automatically after the runtime comes back online.</p>
                <p class="text-xs text-muted-foreground">If the secure session needs to be verified again, this page will ask for the access password without a manual refresh.</p>
                <p class="text-xs text-muted-foreground">
                  Target version: <span class="font-mono">{targetUpgradeVersion() || '—'}</span>
                </p>
                <Show when={targetUpgradeVersion() && !targetUpgradeVersionValid()}>
                  <p class="text-xs text-destructive">Target version is invalid. Please use a release tag like v1.2.3.</p>
                </Show>
              </>
            )}
          >
            <p class="text-sm">This Runtime Service is managed by Redeven Desktop.</p>
            <p class="text-xs text-muted-foreground">Active work: {activeWorkSummary()}.</p>
            <p class="text-xs text-muted-foreground">Desktop will explain whether this update only rebinds this managed runtime or requires installing a newer desktop release first.</p>
            <p class="text-xs text-muted-foreground">If Desktop cannot complete the update directly, it will open the matching release page for this host.</p>
          </Show>
        </div>
      </ConfirmDialog>

      {/* Restart Runtime Confirmation Dialog */}
      <ConfirmDialog
        open={restartOpen()}
        onOpenChange={(open) => setRestartOpen(open)}
        title="Restart Runtime Service?"
        confirmText="Restart"
        loading={isRestarting()}
        onConfirm={() => void startRestart()}
      >
        <div class="space-y-3">
          <p class="text-sm">This Runtime Service is persistent and may have live work.</p>
          <p class="text-xs text-muted-foreground">Active work: {activeWorkSummary()}.</p>
          <p class="text-xs text-muted-foreground">You will reconnect automatically after the runtime comes back online.</p>
          <p class="text-xs text-muted-foreground">If the secure session needs to be verified again, this page will ask for the access password without a manual refresh.</p>
        </div>
      </ConfirmDialog>

      <Dialog
        open={skillInstallOpen()}
        onOpenChange={(open) => {
          setSkillInstallOpen(open);
          if (!open) {
            setSkillInstallResolved([]);
          }
        }}
        title="Install skills from GitHub"
        footer={
          <div class="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setSkillInstallOpen(false)} disabled={skillInstallSaving() || skillInstallValidating()}>
              Cancel
            </Button>
            <Button size="sm" variant="outline" onClick={() => void validateSkillInstall()} loading={skillInstallValidating()} disabled={!canInteract() || !canAdmin() || skillInstallSaving()}>
              Validate
            </Button>
            <Button size="sm" variant="default" onClick={() => void installSkillsFromGitHub()} loading={skillInstallSaving()} disabled={!canInteract() || !canAdmin()}>
              Install
            </Button>
          </div>
        }
      >
        <div class="space-y-4">
          <div>
            <FieldLabel>Scope</FieldLabel>
            <Select
              value={skillInstallScope()}
              onChange={(v) => setSkillInstallScope(v as 'user' | 'user_agents')}
              options={[
                { value: 'user', label: 'User (.redeven)' },
                { value: 'user_agents', label: 'User (.agents)' },
              ]}
              class="w-full"
            />
          </div>

          <div>
            <FieldLabel hint="preferred">GitHub URL</FieldLabel>
            <Input
              value={skillInstallURL()}
              onInput={(e) => setSkillInstallURL(e.currentTarget.value)}
              placeholder="https://github.com/openai/skills/tree/main/skills/.curated/skill-installer"
              size="sm"
              class="w-full"
            />
            <p class="text-[11px] text-muted-foreground mt-1">Use URL directly, or leave empty and fill repo/ref/paths.</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <FieldLabel>repo</FieldLabel>
              <Input value={skillInstallRepo()} onInput={(e) => setSkillInstallRepo(e.currentTarget.value)} placeholder="openai/skills" size="sm" class="w-full font-mono text-xs" />
            </div>
            <div>
              <FieldLabel>ref</FieldLabel>
              <Input value={skillInstallRef()} onInput={(e) => setSkillInstallRef(e.currentTarget.value)} placeholder="main" size="sm" class="w-full font-mono text-xs" />
            </div>
            <div class="md:col-span-2">
              <FieldLabel hint="comma or newline separated">paths</FieldLabel>
              <textarea
                class="w-full font-mono text-xs border border-border rounded-lg px-3 py-2.5 bg-muted/30 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                style={{ 'min-height': '5rem' }}
                value={skillInstallPaths()}
                onInput={(e) => setSkillInstallPaths(e.currentTarget.value)}
                spellcheck={false}
              />
            </div>
          </div>

          <Checkbox
            checked={skillInstallOverwrite()}
            onChange={(v) => setSkillInstallOverwrite(v)}
            label="Overwrite existing skills if target already exists"
            size="sm"
            disabled={!canInteract() || !canAdmin()}
          />

          <div class="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs font-semibold text-foreground">Curated catalog (openai/skills)</div>
              <Button size="sm" variant="ghost" onClick={() => void refreshGitHubCatalog(true)} loading={skillGitHubCatalogLoading()} disabled={!canInteract()}>
                Refresh
              </Button>
            </div>
            <Show when={!skillGitHubCatalogLoading() && (skillGitHubCatalog()?.skills?.length ?? 0) > 0} fallback={<div class="text-[11px] text-muted-foreground">Catalog unavailable. You can still install by URL/repo.</div>}>
              <div class="max-h-44 overflow-auto space-y-2 pr-1">
                <For each={skillGitHubCatalog()?.skills ?? []}>
                  {(item) => (
                    <div class="rounded border border-border bg-background p-2 flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="text-xs font-semibold text-foreground break-all">{item.name}</div>
                        <div class="text-[11px] text-muted-foreground break-all">{item.repo_path}</div>
                        <div class="text-[11px] text-muted-foreground">{item.description}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSkillInstallURL('');
                          setSkillInstallRepo('openai/skills');
                          setSkillInstallRef('main');
                          setSkillInstallPaths(item.repo_path);
                        }}
                        disabled={!canInteract()}
                      >
                        Use
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <Show when={skillInstallResolved().length > 0}>
            <div class="rounded-lg border border-success/40 bg-success/10 p-3 space-y-1">
              <div class="text-xs font-semibold text-success">Resolved skills: {skillInstallResolved().length}</div>
              <For each={skillInstallResolved()}>
                {(item) => (
                  <div class="text-[11px] text-foreground break-all">
                    {item.name} → {item.target_skill_path}
                    <Show when={item.already_exists}>
                      <span class="text-warning ml-1">(already exists)</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Dialog>

      <Dialog
        open={skillBrowseOpen()}
        onOpenChange={(open) => {
          setSkillBrowseOpen(open);
          if (!open) {
            setSkillBrowseTarget(null);
            setSkillBrowseTree(null);
            setSkillBrowseFile(null);
            setSkillBrowseDir('.');
          }
        }}
        title={`Browse skill files${skillBrowseTarget() ? `: ${skillBrowseTarget()?.name}` : ''}`}
        footer={
          <div class="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setSkillBrowseOpen(false)}>
              Close
            </Button>
          </div>
        }
      >
        <div class="space-y-3">
          <div class="text-[11px] text-muted-foreground break-all">
            {skillBrowseTarget()?.path}
            <Show when={skillBrowseTreeLoading() || skillBrowseFileLoading()}>
              <span class="ml-2">Loading...</span>
            </Show>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="rounded-lg border border-border bg-muted/10 p-2 space-y-2 max-h-96 overflow-auto">
              <div class="flex items-center justify-between gap-2">
                <div class="text-xs font-semibold text-foreground break-all">Directory: {skillBrowseDir()}</div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const current = String(skillBrowseDir() ?? '.').trim();
                    const parts = current === '.' ? [] : current.split('/').filter(Boolean);
                    if (parts.length === 0) {
                      const target = skillBrowseTarget();
                      if (target) void loadSkillBrowseTree(target, '.');
                      return;
                    }
                    parts.pop();
                    const next = parts.length > 0 ? parts.join('/') : '.';
                    const target = skillBrowseTarget();
                    if (target) void loadSkillBrowseTree(target, next);
                  }}
                  disabled={!canInteract()}
                >
                  Up
                </Button>
              </div>
              <Show when={skillBrowseTree()}>
                <div class="space-y-1">
                  <For each={skillBrowseTree()?.entries ?? []}>
                    {(entry) => (
                      <button
                        type="button"
                        class="w-full text-left rounded border border-border bg-background px-2 py-1.5 hover:bg-muted/40"
                        onClick={() => {
                          const target = skillBrowseTarget();
                          if (!target) return;
                          if (entry.is_dir) {
                            void loadSkillBrowseTree(target, entry.path);
                          } else {
                            void openSkillBrowseFile(target, entry.path);
                          }
                        }}
                      >
                        <div class="text-xs font-medium text-foreground break-all">
                          {entry.is_dir ? '[DIR] ' : '[FILE] '}
                          {entry.name}
                        </div>
                        <Show when={!entry.is_dir}>
                          <div class="text-[10px] text-muted-foreground">{entry.size} bytes</div>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="rounded-lg border border-border bg-muted/10 p-2 space-y-2 max-h-96 overflow-auto">
              <div class="text-xs font-semibold text-foreground break-all">File preview: {skillBrowseFile()?.file || '-'}</div>
              <Show when={skillBrowseFile()} fallback={<div class="text-[11px] text-muted-foreground">Select a file from the left panel.</div>}>
                <Show when={skillBrowseFile()?.truncated}>
                  <div class="text-[11px] text-warning">Large file truncated to 1MB.</div>
                </Show>
                <pre class="text-[11px] leading-relaxed whitespace-pre-wrap break-words bg-background border border-border rounded p-2">{skillBrowseFile()?.content}</pre>
              </Show>
            </div>
          </div>
        </div>
      </Dialog>

      {/* Create Skill Dialog */}
      <ConfirmDialog
        open={skillCreateOpen()}
        onOpenChange={(open) => setSkillCreateOpen(open)}
        title="Create skill"
        confirmText="Create"
        loading={skillCreateSaving()}
        onConfirm={() => void createSkill()}
      >
        <div class="space-y-3">
          <div>
            <FieldLabel>Scope</FieldLabel>
            <Select
              value={skillCreateScope()}
              onChange={(v) => setSkillCreateScope(v as 'user' | 'user_agents')}
              options={[
                { value: 'user', label: 'User (.redeven)' },
                { value: 'user_agents', label: 'User (.agents)' },
              ]}
              class="w-full"
            />
          </div>
          <div>
            <FieldLabel>Name</FieldLabel>
            <Input value={skillCreateName()} onInput={(e) => setSkillCreateName(e.currentTarget.value)} placeholder="incident-response" size="sm" class="w-full" />
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <Input
              value={skillCreateDescription()}
              onInput={(e) => setSkillCreateDescription(e.currentTarget.value)}
              placeholder="Brief description"
              size="sm"
              class="w-full"
            />
          </div>
          <div>
            <FieldLabel hint="optional">Initial body</FieldLabel>
            <textarea
              class="w-full font-mono text-xs border border-border rounded-lg px-3 py-2.5 bg-muted/30 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              style={{ 'min-height': '7rem' }}
              value={skillCreateBody()}
              onInput={(e) => setSkillCreateBody(e.currentTarget.value)}
              spellcheck={false}
            />
          </div>
        </div>
      </ConfirmDialog>

      {/* Delete Skill Confirmation Dialog */}
      <ConfirmDialog
        open={skillDeleteOpen()}
        onOpenChange={(open) => {
          setSkillDeleteOpen(open);
          if (!open) setSkillDeleteTarget(null);
        }}
        title="Delete skill"
        confirmText="Delete"
        variant="destructive"
        loading={skillDeleteSaving()}
        onConfirm={() => void deleteSkill()}
      >
        <div class="space-y-3">
          <p class="text-sm">Delete this skill permanently?</p>
          <p class="text-xs text-muted-foreground">{skillDeleteTarget()?.name} — {skillDeleteTarget()?.path}</p>
        </div>
      </ConfirmDialog>

      {/* Disable Flower Confirmation Dialog */}
      <ConfirmDialog
        open={disableAIOpen()}
        onOpenChange={(open) => setDisableAIOpen(open)}
        title="Disable Flower"
        confirmText="Disable"
        variant="destructive"
        loading={disableAISaving()}
        onConfirm={() => void disableAI()}
      >
        <div class="space-y-3">
          <p class="text-sm">Are you sure you want to disable Flower?</p>
          <p class="text-xs text-muted-foreground">
            This will remove the <CodeBadge>ai</CodeBadge> section from the runtime config file.
          </p>
        </div>
      </ConfirmDialog>

      {/* Loading Overlays */}
      <RedevenLoadingCurtain
        visible={loadingCurtain().visible}
        surface={loadingCurtain().surface}
        eyebrow={loadingCurtain().eyebrow}
        message={loadingCurtain().message}
      />
    </div>
  );
}
