import { For, Index, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type JSX } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import {
  Bot,
  ChevronRight,
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
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Card, Checkbox, ConfirmDialog, Input, Select } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import { fetchGatewayJSON } from '../services/gatewayApi';
import { getAgentLatestVersion, getEnvironment } from '../services/controlplaneApi';
import { useRedevenRpc } from '../protocol/redeven_v1/hooks';
import { useEnvContext } from './EnvContext';

// ============================================================================
// Types
// ============================================================================

type ViewMode = 'ui' | 'json';
type MaintenanceKind = 'upgrade' | 'restart';

type PermissionSet = Readonly<{ read: boolean; write: boolean; execute: boolean }>;
type PermissionPolicy = Readonly<{
  schema_version: number;
  local_max: PermissionSet;
  by_user?: Record<string, PermissionSet>;
  by_app?: Record<string, PermissionSet>;
}>;

type AIProviderType = 'openai' | 'anthropic' | 'openai_compatible';
type AIProvider = Readonly<{ id: string; name?: string; type: AIProviderType; base_url?: string }>;
type AIModelRef = Readonly<{ provider_id: string; model_name: string }>;
type AIModel = Readonly<{ provider_id: string; model_name: string; label?: string }>;
type AIConfig = Readonly<{ default_model: AIModelRef; models?: AIModel[]; providers: AIProvider[] }>;
type AISecretsView = Readonly<{ provider_api_key_set: Record<string, boolean> }>;

type SettingsResponse = Readonly<{
  config_path: string;
  connection: Readonly<{
    controlplane_base_url: string;
    environment_id: string;
    agent_instance_id: string;
    direct: Readonly<{
      ws_url: string;
      channel_id: string;
      channel_init_expire_at_unix_s: number;
      default_suite: number;
      e2ee_psk_set: boolean;
    }>;
  }>;
  runtime: Readonly<{ root_dir: string; shell: string }>;
  logging: Readonly<{ log_format: string; log_level: string }>;
  codespaces: Readonly<{ code_server_port_min: number; code_server_port_max: number }>;
  permission_policy: PermissionPolicy | null;
  ai: AIConfig | null;
  ai_secrets?: AISecretsView | null;
}>;

type PermissionRow = { key: string; read: boolean; write: boolean; execute: boolean };
type AIProviderRow = { id: string; name: string; type: AIProviderType; base_url: string };
type AIModelRow = { provider_id: string; model_name: string; label: string };

// ============================================================================
// Constants & Helpers
// ============================================================================

const DEFAULT_CODE_SERVER_PORT_MIN = 20000;
const DEFAULT_CODE_SERVER_PORT_MAX = 21000;
const AI_API_KEY_ENV = 'REDEVEN_API_KEY';

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

function modelID(ref: { provider_id: string; model_name: string }): string {
  const pid = String(ref?.provider_id ?? '').trim();
  const mn = String(ref?.model_name ?? '').trim();
  if (!pid || !mn) return '';
  return `${pid}/${mn}`;
}

function defaultPermissionPolicy(): PermissionPolicy {
  return { schema_version: 1, local_max: { read: true, write: false, execute: true } };
}

function defaultAIConfig(): AIConfig {
  return {
    default_model: { provider_id: 'openai', model_name: 'gpt-5-mini' },
    models: [],
    providers: [{ id: 'openai', name: 'OpenAI', type: 'openai', base_url: 'https://api.openai.com/v1' }],
  };
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

function normalizePortRange(min: number, max: number): { is_default: boolean; effective_min: number; effective_max: number } {
  let m = Number(min);
  let M = Number(max);
  if (!Number.isFinite(m)) m = 0;
  if (!Number.isFinite(M)) M = 0;

  if (m <= 0 || M <= 0 || M > 65535 || m >= M) {
    return { is_default: true, effective_min: DEFAULT_CODE_SERVER_PORT_MIN, effective_max: DEFAULT_CODE_SERVER_PORT_MAX };
  }
  if (m < 1024) m = 1024;
  if (M < 1024) M = 1024;
  if (m >= M) {
    return { is_default: true, effective_min: DEFAULT_CODE_SERVER_PORT_MIN, effective_max: DEFAULT_CODE_SERVER_PORT_MAX };
  }
  return { is_default: false, effective_min: m, effective_max: M };
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

// ============================================================================
// Reusable UI Components
// ============================================================================

function ViewToggle(props: { value: () => ViewMode; disabled?: boolean; onChange: (v: ViewMode) => void }) {
  const btnClass = (active: boolean) => {
    const base = 'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150';
    if (active) return `${base} bg-background text-foreground shadow-sm border border-border`;
    return `${base} text-muted-foreground hover:text-foreground hover:bg-muted/50`;
  };
  const disabledClass = () => (props.disabled ? 'opacity-50 pointer-events-none' : '');

  return (
    <div class={`inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-muted/40 ${disabledClass()}`}>
      <button type="button" class={btnClass(props.value() === 'ui')} onClick={() => props.onChange('ui')}>
        UI
      </button>
      <button type="button" class={btnClass(props.value() === 'json')} onClick={() => props.onChange('json')}>
        JSON
      </button>
    </div>
  );
}

interface SettingsCardProps {
  icon: (props: { class?: string }) => JSX.Element;
  title: string;
  description: string;
  badge?: string;
  badgeVariant?: 'default' | 'warning' | 'success';
  actions?: JSX.Element;
  error?: string | null;
  children: JSX.Element;
}

function SettingsCard(props: SettingsCardProps) {
  const badgeColors = {
    default: 'bg-muted text-muted-foreground',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  };

  return (
    <Card class="overflow-hidden">
      <div class="border-b border-border bg-muted/20 px-5 py-4">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <props.icon class="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-semibold text-foreground">{props.title}</h3>
                <Show when={props.badge}>
                  <span class={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badgeColors[props.badgeVariant ?? 'default']}`}>
                    {props.badge}
                  </span>
                </Show>
              </div>
              <p class="text-xs text-muted-foreground mt-0.5">{props.description}</p>
            </div>
          </div>
          <Show when={props.actions}>
            <div class="flex items-center gap-2 flex-shrink-0">{props.actions}</div>
          </Show>
        </div>
      </div>

      <div class="p-5 space-y-4">
        <Show when={props.error}>
          <div class="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div class="text-xs text-destructive break-words">{props.error}</div>
          </div>
        </Show>
        {props.children}
      </div>
    </Card>
  );
}

interface FieldLabelProps {
  children: string;
  hint?: string;
}

function FieldLabel(props: FieldLabelProps) {
  return (
    <div class="mb-1.5">
      <label class="text-xs font-medium text-foreground">{props.children}</label>
      <Show when={props.hint}>
        <span class="ml-1.5 text-xs text-muted-foreground">({props.hint})</span>
      </Show>
    </div>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function InfoRow(props: InfoRowProps) {
  return (
    <div class="py-2 first:pt-0 last:pb-0">
      <div class="text-xs text-muted-foreground mb-0.5">{props.label}</div>
      <div class={`text-sm break-all ${props.mono ? 'font-mono text-xs' : ''}`}>{props.value || '—'}</div>
    </div>
  );
}

function CodeBadge(props: { children: string }) {
  return <code class="px-1.5 py-0.5 text-xs font-mono bg-muted rounded">{props.children}</code>;
}



function JSONEditor(props: { value: string; onChange: (v: string) => void; disabled?: boolean; rows?: number }) {
  return (
    <textarea
      class="w-full font-mono text-xs border border-border rounded-lg px-3 py-2.5 bg-muted/30 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:bg-muted/50"
      style={{ 'min-height': `${(props.rows ?? 6) * 1.5}rem` }}
      value={props.value}
      onInput={(e) => props.onChange(e.currentTarget.value)}
      spellcheck={false}
      disabled={props.disabled}
    />
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function EnvSettingsPage() {
  const env = useEnvContext();
  const protocol = useProtocol();
  const notify = useNotification();
  const rpc = useRedevenRpc();

  const key = createMemo<number | null>(() => (protocol.status() === 'connected' ? env.settingsSeq() : null));

  const [settings, { refetch }] = createResource<SettingsResponse | null, number | null>(
    () => key(),
    async (k) => (k == null ? null : await fetchGatewayJSON<SettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' })),
  );

  const canInteract = createMemo(() => protocol.status() === 'connected' && !settings.loading && !settings.error);

  // ============================================================================
  // Agent maintenance actions (E2EE, data plane)
  // ============================================================================

  const canAdmin = createMemo(() => !!env.env()?.permissions?.can_admin || !!env.env()?.permissions?.is_owner);
  const controlplaneStatus = createMemo(() => (env.env()?.status ? String(env.env()!.status) : ''));

  const [agentPingSeq, setAgentPingSeq] = createSignal(0);
  const [agentPing] = createResource(
    () => (protocol.status() === 'connected' ? agentPingSeq() : null),
    async (k) => (k == null ? null : await rpc.sys.ping()),
  );

  const [latestVersion] = createResource(
    () => env.env_id().trim() || null,
    async (id) => (id ? await getAgentLatestVersion(id) : null),
  );

  const [upgradeOpen, setUpgradeOpen] = createSignal(false);
  const [restartOpen, setRestartOpen] = createSignal(false);

  const [maintenanceKind, setMaintenanceKind] = createSignal<MaintenanceKind | null>(null);
  const maintaining = createMemo(() => maintenanceKind() !== null);
  const isUpgrading = createMemo(() => maintenanceKind() === 'upgrade');
  const isRestarting = createMemo(() => maintenanceKind() === 'restart');

  const [maintenanceError, setMaintenanceError] = createSignal<string | null>(null);
  const [maintenancePolledStatus, setMaintenancePolledStatus] = createSignal<string | null>(null);

  const displayedStatus = createMemo(() => {
    const st = maintaining() && maintenancePolledStatus() ? String(maintenancePolledStatus()) : controlplaneStatus();
    return st || 'unknown';
  });

  const statusLabel = createMemo(() => {
    const st = displayedStatus();
    if (st === 'online') return 'Online';
    if (st === 'offline') return 'Offline';
    if (!st || st === 'unknown') return 'Unknown';
    return `${st.slice(0, 1).toUpperCase()}${st.slice(1)}`;
  });

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
    if (protocol.status() !== 'connected') return false;
    if (!canAdmin()) return false;
    return controlplaneStatus() === 'online';
  });

  const canStartRestart = createMemo(() => {
    if (maintaining()) return false;
    if (protocol.status() !== 'connected') return false;
    if (!canAdmin()) return false;
    return controlplaneStatus() === 'online';
  });

  const maintenanceStage = createMemo(() => {
    const kind = maintenanceKind();
    if (!kind) return null;
    if (protocol.status() === 'connected') {
      if (kind === 'upgrade') return 'Downloading and installing update...';
      return 'Restarting agent...';
    }
    const st = maintenancePolledStatus();
    if (st && st !== 'online') return 'Agent restarting...';
    if (st === 'online') return 'Reconnecting...';
    return 'Waiting for agent...';
  });

  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  let maintenanceAbort = false;
  onCleanup(() => {
    maintenanceAbort = true;
  });

  const startMaintenance = async (kind: MaintenanceKind) => {
    if (maintaining()) return;
    setMaintenanceError(null);
    setMaintenancePolledStatus(null);

    const envId = env.env_id().trim();
    if (!envId) {
      const msg = 'Missing env context. Please reopen from the Redeven Portal.';
      setMaintenanceError(msg);
      notify.error(kind === 'upgrade' ? 'Update failed' : 'Restart failed', msg);
      return;
    }

    if (!canAdmin()) {
      const msg = 'Admin permission required.';
      setMaintenanceError(msg);
      notify.error(kind === 'upgrade' ? 'Update failed' : 'Restart failed', msg);
      return;
    }

    setMaintenanceKind(kind);

    const beforeVersion = kind === 'upgrade' && agentPing()?.version ? String(agentPing()!.version) : '';

    let started = false;
    try {
      const resp = kind === 'upgrade' ? await rpc.sys.upgrade({}) : await rpc.sys.restart();
      if (!resp?.ok) {
        const msg = resp?.message ? String(resp.message) : kind === 'upgrade' ? 'Upgrade rejected.' : 'Restart rejected.';
        setMaintenanceError(msg);
        notify.error(kind === 'upgrade' ? 'Update failed' : 'Restart failed', msg);
        setMaintenanceKind(null);
        return;
      }
      started = true;
      notify.success(
        kind === 'upgrade' ? 'Update started' : 'Restart started',
        resp?.message ? String(resp.message) : 'The agent will restart shortly.',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // If the call fails due to a disconnect, assume the upgrade has started.
      if (protocol.status() !== 'connected') {
        started = true;
        notify.info(kind === 'upgrade' ? 'Update started' : 'Restart started', 'Waiting for agent restart...');
      } else {
        setMaintenanceError(msg || 'Request failed.');
        notify.error(kind === 'upgrade' ? 'Update failed' : 'Restart failed', msg || 'Request failed.');
        setMaintenanceKind(null);
        return;
      }
    } finally {
      setUpgradeOpen(false);
      setRestartOpen(false);
    }

    if (!started) {
      setMaintenanceKind(null);
      return;
    }

    const startedAt = Date.now();
    const timeoutMs = kind === 'upgrade' ? 10 * 60 * 1000 : 5 * 60 * 1000;
    const pollIntervalMs = 1500;
    let sawDisconnect = false;

    for (;;) {
      if (maintenanceAbort) return;

      if (Date.now() - startedAt > timeoutMs) {
        const msg = 'Timed out waiting for the agent to restart.';
        setMaintenanceError(msg);
        notify.error(kind === 'upgrade' ? 'Update timed out' : 'Restart timed out', msg);
        setMaintenanceKind(null);
        return;
      }

      if (protocol.status() !== 'connected') {
        sawDisconnect = true;
      }

      try {
        const detail = await getEnvironment(envId);
        const st = detail?.status ? String(detail.status) : null;
        if (st) setMaintenancePolledStatus(st);
      } catch {
        // Ignore transient control plane failures; keep polling.
      }

      if (sawDisconnect && maintenancePolledStatus() === 'online') {
        try {
          await env.connect();
        } catch {
          // Ignore and continue polling.
        }
      }

      if (sawDisconnect && protocol.status() === 'connected') {
        try {
          const p = await rpc.sys.ping();
          const v = p?.version ? String(p.version) : '';
          setAgentPingSeq((n) => n + 1);

          setMaintenanceKind(null);

          if (kind === 'upgrade' && beforeVersion && v && v !== beforeVersion) notify.success('Updated', `Agent updated to ${v}.`);
          else notify.success('Reconnected', 'Agent is back online.');
          return;
        } catch {
          // Still reconnecting; keep polling.
        }
      }

      await sleep(pollIntervalMs);
    }
  };

  const startUpgrade = async () => startMaintenance('upgrade');
  const startRestart = async () => startMaintenance('restart');

  const connectOverlayMessage = createMemo(() => (maintaining() ? 'Agent restarting...' : 'Connecting to agent...'));

  // View mode signals
  const [configView, setConfigView] = createSignal<ViewMode>('ui');
  const [connectionView, setConnectionView] = createSignal<ViewMode>('ui');
  const [runtimeView, setRuntimeView] = createSignal<ViewMode>('ui');
  const [loggingView, setLoggingView] = createSignal<ViewMode>('ui');
  const [codespacesView, setCodespacesView] = createSignal<ViewMode>('ui');
  const [policyView, setPolicyView] = createSignal<ViewMode>('ui');
  const [aiView, setAiView] = createSignal<ViewMode>('ui');

  // Dirty flags
  const [runtimeDirty, setRuntimeDirty] = createSignal(false);
  const [loggingDirty, setLoggingDirty] = createSignal(false);
  const [codespacesDirty, setCodespacesDirty] = createSignal(false);
  const [policyDirty, setPolicyDirty] = createSignal(false);
  const [aiDirty, setAiDirty] = createSignal(false);

  // Runtime fields
  const [rootDir, setRootDir] = createSignal('');
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
  const [aiDefaultProviderID, setAiDefaultProviderID] = createSignal('openai');
  const [aiDefaultModelName, setAiDefaultModelName] = createSignal('gpt-5-mini');
  const [aiProviders, setAiProviders] = createSignal<AIProviderRow[]>([
    { id: 'openai', name: 'OpenAI', type: 'openai', base_url: 'https://api.openai.com/v1' },
  ]);
  const [aiUseModelList, setAiUseModelList] = createSignal(false);
  const [aiModels, setAiModels] = createSignal<AIModelRow[]>([]);

  // AI provider keys (stored locally in secrets.json; never returned in plaintext).
  const [aiProviderKeySet, setAiProviderKeySet] = createSignal<Record<string, boolean>>({});
  const [aiProviderKeyDraft, setAiProviderKeyDraft] = createSignal<Record<string, string>>({});
  const [aiProviderKeySaving, setAiProviderKeySaving] = createSignal<Record<string, boolean>>({});

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
  const [disableAIOpen, setDisableAIOpen] = createSignal(false);
  const [disableAISaving, setDisableAISaving] = createSignal(false);

  // Error states
  const [runtimeError, setRuntimeError] = createSignal<string | null>(null);
  const [loggingError, setLoggingError] = createSignal<string | null>(null);
  const [codespacesError, setCodespacesError] = createSignal<string | null>(null);
  const [policyError, setPolicyError] = createSignal<string | null>(null);
  const [aiError, setAiError] = createSignal<string | null>(null);

  const aiEnabled = createMemo(() => !!settings()?.ai);

  const configPath = () => String(settings()?.config_path ?? '').trim();

  const configJSONText = createMemo(() => JSON.stringify({ config_path: configPath() || '' }, null, 2));
  const connectionJSONText = createMemo(() => JSON.stringify(settings()?.connection ?? null, null, 2));

  const buildRuntimePatch = () => ({ root_dir: String(rootDir() ?? ''), shell: String(shell() ?? '') });
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

    const mkRow = (r: PermissionRow): PermissionSet => ({
      read: localMax.read ? !!r.read : false,
      write: localMax.write ? !!r.write : false,
      execute: localMax.execute ? !!r.execute : false,
    });

    const byUserRows = policyByUser();
    const byAppRows = policyByApp();

    const by_user: Record<string, PermissionSet> = {};
    for (const r of byUserRows) {
      const k = String(r.key ?? '').trim();
      if (!k) continue;
      if (by_user[k]) throw new Error(`Duplicate by_user key: ${k}`);
      by_user[k] = mkRow(r);
    }

    const by_app: Record<string, PermissionSet> = {};
    for (const r of byAppRows) {
      const k = String(r.key ?? '').trim();
      if (!k) continue;
      if (by_app[k]) throw new Error(`Duplicate by_app key: ${k}`);
      by_app[k] = mkRow(r);
    }

    const out: any = { schema_version: 1, local_max: localMax };
    if (Object.keys(by_user).length > 0) out.by_user = by_user;
    if (Object.keys(by_app).length > 0) out.by_app = by_app;
    return out as PermissionPolicy;
  };

  const buildAIValue = (): AIConfig => {
    const defaultModel: AIModelRef = {
      provider_id: String(aiDefaultProviderID() ?? '').trim(),
      model_name: String(aiDefaultModelName() ?? '').trim(),
    };

    const providers = aiProviders().map((p) => {
      const out: any = {
        id: String(p.id ?? '').trim(),
        type: p.type,
      };
      const name = String(p.name ?? '').trim();
      if (name) out.name = name;
      const baseURL = String(p.base_url ?? '').trim();
      if (baseURL) out.base_url = baseURL;
      return out as AIProvider;
    });

    const models: AIModel[] = aiUseModelList()
      ? aiModels().map((m) => {
          const out: any = {
            provider_id: String(m.provider_id ?? '').trim(),
            model_name: String(m.model_name ?? '').trim(),
          };
          const label = String(m.label ?? '').trim();
          if (label) out.label = label;
          return out as AIModel;
        })
      : [];

    return { default_model: defaultModel, providers, models };
  };

  const validateAIValue = (cfg: AIConfig) => {
    const dm = cfg.default_model as any;
    const defaultProviderID = String(dm?.provider_id ?? '').trim();
    const defaultModelName = String(dm?.model_name ?? '').trim();
    if (!defaultProviderID || !defaultModelName) throw new Error('Missing default_model.');
    if (defaultProviderID.includes('/') || defaultModelName.includes('/')) throw new Error('default_model must not contain "/".');

    const providers = Array.isArray(cfg.providers) ? cfg.providers : [];
    if (providers.length === 0) throw new Error('Missing providers.');

    const providerIDs = new Set<string>();
    for (const p of providers) {
      const id = String((p as any).id ?? '').trim();
      const name = String((p as any).name ?? '').trim();
      const typ = String((p as any).type ?? '').trim();
      const baseURL = String((p as any).base_url ?? '').trim();

      if (!id) throw new Error('Provider id is required.');
      if (providerIDs.has(id)) throw new Error(`Duplicate provider id: ${id}`);
      providerIDs.add(id);
      if (name && name.length > 80) throw new Error(`Provider "${id}" name is too long.`);

      if (typ !== 'openai' && typ !== 'anthropic' && typ !== 'openai_compatible') {
        throw new Error(`Invalid provider type: ${typ || '(empty)'}`);
      }
      if (typ === 'openai_compatible' && !baseURL) throw new Error(`Provider "${id}" requires base_url.`);
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
    }

    if (!providerIDs.has(defaultProviderID)) throw new Error(`default_model references unknown provider "${defaultProviderID}".`);

    const models = Array.isArray(cfg.models) ? cfg.models : [];
    if (models.length > 0) {
      const modelIDs = new Set<string>();
      for (const m of models) {
        const pid = String((m as any).provider_id ?? '').trim();
        const mn = String((m as any).model_name ?? '').trim();
        if (!pid || !mn) throw new Error('Model provider_id and model_name are required.');
        if (pid.includes('/') || mn.includes('/')) throw new Error('Model provider_id/model_name must not contain "/".');
        const id = `${pid}/${mn}`;
        if (modelIDs.has(id)) throw new Error(`Duplicate model: ${id}`);
        modelIDs.add(id);
        if (!providerIDs.has(pid)) throw new Error(`Model "${id}" references unknown provider "${pid}".`);
      }
      const defaultID = `${defaultProviderID}/${defaultModelName}`;
      if (!modelIDs.has(defaultID)) throw new Error('default_model must be listed in models when models is set.');
    }
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
    } catch (e) {
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

  // Reset local state when settings are loaded (but do not overwrite user edits).
  createEffect(() => {
    const s = settings();
    if (!s) return;

    if (!runtimeDirty()) {
      const r = s.runtime;
      setRootDir(String(r?.root_dir ?? ''));
      setShell(String(r?.shell ?? ''));
      setRuntimeJSON(JSON.stringify({ root_dir: String(r?.root_dir ?? ''), shell: String(r?.shell ?? '') }, null, 2));
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

      setUseDefaultCodePorts(n.is_default);
      setCodePortMin(n.is_default ? '' : n.effective_min);
      setCodePortMax(n.is_default ? '' : n.effective_max);
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
      setAiDefaultProviderID(String(a.default_model?.provider_id ?? ''));
      setAiDefaultModelName(String(a.default_model?.model_name ?? ''));
      setAiProviders(
        (a.providers ?? []).map((p) => ({
          id: String(p.id ?? ''),
          name: String(p.name ?? ''),
          type: p.type,
          base_url: String(p.base_url ?? ''),
        })),
      );

      const models = Array.isArray(a.models) ? a.models : [];
      setAiUseModelList(models.length > 0);
      setAiModels(
        models.map((m) => ({
          provider_id: String(m.provider_id ?? ''),
          model_name: String(m.model_name ?? ''),
          label: String(m.label ?? ''),
        })),
      );

      setAiJSON(JSON.stringify(a, null, 2));

      const keySet = s.ai_secrets?.provider_api_key_set;
      if (keySet && typeof keySet === 'object') setAiProviderKeySet(keySet);
      void refreshAIProviderKeyStatus((a.providers ?? []).map((p) => String(p.id ?? '')));
    }
  });

  // Focus/scroll to the requested section when opened via "Open Settings" from other pages.
  createEffect(() => {
    const seq = env.settingsFocusSeq();
    const section = env.settingsFocusSection();
    if (!seq || !section) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`redeven-settings-${section}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const saveSettings = async (body: any) => {
    await fetchGatewayJSON<SettingsResponse>('/_redeven_proxy/api/settings', { method: 'PUT', body: JSON.stringify(body) });
    env.bumpSettingsSeq();
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
      if (typeof (v as any).root_dir !== 'string' || typeof (v as any).shell !== 'string') {
        throw new Error('Runtime JSON must include "root_dir" and "shell" as strings.');
      }
      setRootDir(String((v as any).root_dir ?? ''));
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
      setUseDefaultCodePorts(n.is_default);
      setCodePortMin(n.is_default ? '' : n.effective_min);
      setCodePortMax(n.is_default ? '' : n.effective_max);
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
      if (!isJSONObject(v)) throw new Error('AI JSON must be an object.');

      const dmRaw = (v as any).default_model;
      const providersRaw = (v as any).providers;
      const modelsRaw = (v as any).models;

      if (!isJSONObject(dmRaw)) throw new Error('AI JSON is missing default_model.');
      if (!Array.isArray(providersRaw)) throw new Error('AI JSON is missing providers[].');

      setAiDefaultProviderID(String((dmRaw as any).provider_id ?? ''));
      setAiDefaultModelName(String((dmRaw as any).model_name ?? ''));
      setAiProviders(
        providersRaw.map((p) => ({
          id: String(p?.id ?? ''),
          name: String(p?.name ?? ''),
          type: String(p?.type ?? '') as AIProviderType,
          base_url: String(p?.base_url ?? ''),
        })),
      );
      void refreshAIProviderKeyStatus(providersRaw.map((p) => String(p?.id ?? '')));

      const models = Array.isArray(modelsRaw) ? modelsRaw : [];
      setAiUseModelList(models.length > 0);
      setAiModels(
        models.map((m) => ({
          provider_id: String(m?.provider_id ?? ''),
          model_name: String(m?.model_name ?? ''),
          label: String(m?.label ?? ''),
        })),
      );
      setAiView('ui');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    }
  };

  // Save handlers
  const saveRuntime = async () => {
    setRuntimeError(null);
    setRuntimeSaving(true);
    try {
      const body = runtimeView() === 'json' ? parseJSONOrThrow(runtimeJSON()) : buildRuntimePatch();
      if (!isJSONObject(body)) throw new Error('Runtime JSON must be an object.');
      await saveSettings(body);
      setRuntimeDirty(false);
      notify.success('Saved', 'Runtime settings saved. Restart required.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRuntimeError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setRuntimeSaving(false);
    }
  };

  const resetRuntime = () => {
    setRuntimeError(null);
    setRootDir('');
    setShell('');
    setRuntimeDirty(true);
    if (runtimeView() === 'json') setRuntimeJSON(JSON.stringify({ root_dir: '', shell: '' }, null, 2));
  };

  const saveLogging = async () => {
    setLoggingError(null);
    setLoggingSaving(true);
    try {
      const body = loggingView() === 'json' ? parseJSONOrThrow(loggingJSON()) : buildLoggingPatch();
      if (!isJSONObject(body)) throw new Error('Logging JSON must be an object.');
      await saveSettings(body);
      setLoggingDirty(false);
      notify.success('Saved', 'Logging settings saved. Restart required.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoggingError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setLoggingSaving(false);
    }
  };

  const resetLogging = () => {
    setLoggingError(null);
    setLogFormat('');
    setLogLevel('');
    setLoggingDirty(true);
    if (loggingView() === 'json') setLoggingJSON(JSON.stringify({ log_format: '', log_level: '' }, null, 2));
  };

  const saveCodespaces = async () => {
    setCodespacesError(null);
    setCodespacesSaving(true);
    try {
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
          if (n.is_default) throw new Error('Invalid port range.');
        }
        body = buildCodespacesPatch();
      }

      await saveSettings(body);
      setCodespacesDirty(false);
      notify.success('Saved', 'Codespaces settings saved. Restart required.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCodespacesError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setCodespacesSaving(false);
    }
  };

  const resetCodespaces = () => {
    setCodespacesError(null);
    setUseDefaultCodePorts(true);
    setCodePortMin('');
    setCodePortMax('');
    setCodespacesDirty(true);
    if (codespacesView() === 'json') {
      setCodespacesJSON(JSON.stringify({ code_server_port_min: 0, code_server_port_max: 0 }, null, 2));
    }
  };

  const savePolicy = async () => {
    setPolicyError(null);
    setPolicySaving(true);
    try {
      let body: any = null;
      if (policyView() === 'json') {
        const v = parseJSONOrThrow(policyJSON());
        if (!isJSONObject(v)) throw new Error('Permission policy JSON must be an object.');
        body = { permission_policy: v };
      } else {
        const v = buildPolicyValue();
        body = { permission_policy: v };
      }

      await saveSettings(body);
      setPolicyDirty(false);
      notify.success('Saved', 'Permission policy saved. Restart required.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPolicyError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setPolicySaving(false);
    }
  };

  const resetPolicy = () => {
    setPolicyError(null);
    const d = defaultPermissionPolicy();
    setPolicyLocalRead(d.local_max.read);
    setPolicyLocalWrite(d.local_max.write);
    setPolicyLocalExecute(d.local_max.execute);
    setPolicyByUser([]);
    setPolicyByApp([]);
    setPolicyDirty(true);
    if (policyView() === 'json') setPolicyJSON(JSON.stringify(d, null, 2));
  };

  const saveAI = async () => {
    setAiError(null);
    setAiSaving(true);
    try {
      let cfg: AIConfig | null = null;
      if (aiView() === 'json') {
        const v = parseJSONOrThrow(aiJSON());
        if (!isJSONObject(v)) throw new Error('AI JSON must be an object.');
        cfg = v as AIConfig;
      } else {
        cfg = buildAIValue();
      }
      validateAIValue(cfg);
      await saveSettings({ ai: cfg });
      setAiDirty(false);
      notify.success('Saved', aiEnabled() ? 'AI settings updated.' : 'AI has been enabled.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setAiSaving(false);
    }
  };

  const disableAI = async () => {
    setDisableAISaving(true);
    setAiError(null);
    try {
      await saveSettings({ ai: null });
      setAiDirty(false);
      setDisableAIOpen(false);
      notify.success('Disabled', 'AI has been disabled.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg || 'Disable failed.');
      notify.error('Disable failed', msg || 'Request failed.');
    } finally {
      setDisableAISaving(false);
    }
  };

  const resetAI = () => {
    setAiError(null);
    const d = defaultAIConfig();
    setAiDefaultProviderID(String(d.default_model?.provider_id ?? ''));
    setAiDefaultModelName(String(d.default_model?.model_name ?? ''));
    setAiProviders(d.providers.map((p) => ({ id: p.id, name: String(p.name ?? ''), type: p.type, base_url: String(p.base_url ?? '') })));
    setAiUseModelList(false);
    setAiModels([]);
    setAiDirty(true);
    void refreshAIProviderKeyStatus(d.providers.map((p) => String(p.id ?? '')));
    if (aiView() === 'json') setAiJSON(JSON.stringify(d, null, 2));
  };

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
    <div class="h-full min-h-0 overflow-auto bg-background">
      <div class="max-w-4xl mx-auto p-6 space-y-6">
        {/* Page Header */}
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-xl font-semibold text-foreground tracking-tight">Settings</h1>
            <p class="text-sm text-muted-foreground mt-1">
              Configure your agent. AI changes apply immediately; other changes require a restart.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={settings.loading} class="gap-1.5">
            <RefreshIcon class="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>
        </div>

        <Show when={settings.error}>
          <div class="flex items-start gap-2 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
            <div class="text-sm text-destructive">{settings.error instanceof Error ? settings.error.message : String(settings.error)}</div>
          </div>
        </Show>

        {/* Config File Card */}
        <SettingsCard
          icon={FileCode}
          title="Config File"
          description="Location of the agent configuration file."
          badge="Read-only"
          actions={<ViewToggle value={configView} onChange={(v) => setConfigView(v)} />}
        >
          <Show when={configView() === 'ui'} fallback={<JSONEditor value={configJSONText()} onChange={() => {}} disabled rows={4} />}>
            <InfoRow label="Path" value={configPath() || '(unknown)'} mono />
          </Show>
        </SettingsCard>

        {/* Connection Card */}
        <SettingsCard
          icon={Globe}
          title="Connection"
          description="Connection details managed by the control plane."
          badge="Read-only"
          actions={<ViewToggle value={connectionView} onChange={(v) => setConnectionView(v)} />}
        >
          <Show when={connectionView() === 'ui'} fallback={<JSONEditor value={connectionJSONText()} onChange={() => {}} disabled rows={10} />}>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 divide-y md:divide-y-0 divide-border">
              <InfoRow label="Control Plane" value={String(settings()?.connection?.controlplane_base_url ?? '')} mono />
              <InfoRow label="Environment ID" value={String(settings()?.connection?.environment_id ?? '')} mono />
              <InfoRow label="Agent Instance ID" value={String(settings()?.connection?.agent_instance_id ?? '')} mono />
              <InfoRow label="Direct Channel" value={String(settings()?.connection?.direct?.channel_id ?? '')} mono />
              <InfoRow label="Direct Suite" value={String(settings()?.connection?.direct?.default_suite ?? '')} mono />
              <InfoRow label="E2EE PSK" value={settings()?.connection?.direct?.e2ee_psk_set ? 'Configured' : 'Not set'} />
              <div class="md:col-span-2">
                <InfoRow label="Direct WebSocket URL" value={String(settings()?.connection?.direct?.ws_url ?? '')} mono />
              </div>
            </div>
          </Show>
        </SettingsCard>

        {/* Agent Card */}
        <SettingsCard
          icon={Zap}
          title="Agent"
          description="Version and maintenance actions."
          badge={agentCardBadge()}
          badgeVariant={agentCardBadgeVariant()}
          error={maintenanceError()}
          actions={
            <div class="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setRestartOpen(true)} loading={isRestarting()} disabled={!canStartRestart()}>
                Restart agent
              </Button>
              <Button size="sm" variant="default" onClick={() => setUpgradeOpen(true)} loading={isUpgrading()} disabled={!canStartUpgrade()}>
                Update agent
              </Button>
            </div>
          }
        >
          <div class="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 divide-y md:divide-y-0 divide-border">
            <InfoRow label="Current" value={agentPing()?.version ? String(agentPing()!.version) : '—'} mono />
            <InfoRow label="Latest" value={latestVersion()?.latest_version ? String(latestVersion()!.latest_version) : '—'} mono />
            <InfoRow label="Status" value={displayedStatus()} />
          </div>

          <Show when={!canAdmin()}>
            <div class="text-xs text-muted-foreground">Admin permission required.</div>
          </Show>

          <Show when={maintenanceStage()}>
            <div class="text-xs text-muted-foreground">{maintenanceStage()}</div>
          </Show>
        </SettingsCard>

        {/* Runtime Card */}
        <SettingsCard
          icon={Terminal}
          title="Runtime"
          description="Shell and working directory configuration."
          badge="Restart required"
          badgeVariant="warning"
          error={runtimeError()}
          actions={
            <>
              <ViewToggle value={runtimeView} disabled={!canInteract()} onChange={(v) => switchRuntimeView(v)} />
              <Button size="sm" variant="outline" onClick={() => resetRuntime()} disabled={!canInteract()}>
                Reset
              </Button>
              <Button size="sm" variant="default" onClick={() => void saveRuntime()} loading={runtimeSaving()} disabled={!canInteract()}>
                Save
              </Button>
            </>
          }
        >
          <Show
            when={runtimeView() === 'ui'}
            fallback={
              <JSONEditor
                value={runtimeJSON()}
                onChange={(v) => {
                  setRuntimeJSON(v);
                  setRuntimeDirty(true);
                }}
                disabled={!canInteract()}
                rows={5}
              />
            }
          >
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel hint="default: user home">root_dir</FieldLabel>
                <Input
                  value={rootDir()}
                  onInput={(e) => {
                    setRootDir(e.currentTarget.value);
                    setRuntimeDirty(true);
                  }}
                  placeholder="/home/user"
                  size="sm"
                  class="w-full"
                  disabled={!canInteract()}
                />
              </div>
              <div>
                <FieldLabel hint="default: $SHELL">shell</FieldLabel>
                <Input
                  value={shell()}
                  onInput={(e) => {
                    setShell(e.currentTarget.value);
                    setRuntimeDirty(true);
                  }}
                  placeholder="/bin/bash"
                  size="sm"
                  class="w-full"
                  disabled={!canInteract()}
                />
              </div>
            </div>
          </Show>
        </SettingsCard>

        {/* Logging Card */}
        <SettingsCard
          icon={Database}
          title="Logging"
          description="Log format and verbosity level."
          badge="Restart required"
          badgeVariant="warning"
          error={loggingError()}
          actions={
            <>
              <ViewToggle value={loggingView} disabled={!canInteract()} onChange={(v) => switchLoggingView(v)} />
              <Button size="sm" variant="outline" onClick={() => resetLogging()} disabled={!canInteract()}>
                Reset
              </Button>
              <Button size="sm" variant="default" onClick={() => void saveLogging()} loading={loggingSaving()} disabled={!canInteract()}>
                Save
              </Button>
            </>
          }
        >
          <Show
            when={loggingView() === 'ui'}
            fallback={
              <JSONEditor
                value={loggingJSON()}
                onChange={(v) => {
                  setLoggingJSON(v);
                  setLoggingDirty(true);
                }}
                disabled={!canInteract()}
                rows={5}
              />
            }
          >
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel>log_format</FieldLabel>
                <Select
                  value={logFormat()}
                  onChange={(v) => {
                    setLogFormat(v);
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
              </div>
              <div>
                <FieldLabel>log_level</FieldLabel>
                <Select
                  value={logLevel()}
                  onChange={(v) => {
                    setLogLevel(v);
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
              </div>
            </div>
          </Show>
        </SettingsCard>

        {/* Codespaces Card */}
        <SettingsCard
          icon={Code}
          title="Codespaces"
          description="Port range for code-server instances."
          badge="Restart required"
          badgeVariant="warning"
          error={codespacesError()}
          actions={
            <>
              <ViewToggle value={codespacesView} disabled={!canInteract()} onChange={(v) => switchCodespacesView(v)} />
              <Button size="sm" variant="outline" onClick={() => resetCodespaces()} disabled={!canInteract()}>
                Reset
              </Button>
              <Button size="sm" variant="default" onClick={() => void saveCodespaces()} loading={codespacesSaving()} disabled={!canInteract()}>
                Save
              </Button>
            </>
          }
        >
          <Show
            when={codespacesView() === 'ui'}
            fallback={
              <JSONEditor
                value={codespacesJSON()}
                onChange={(v) => {
                  setCodespacesJSON(v);
                  setCodespacesDirty(true);
                }}
                disabled={!canInteract()}
                rows={5}
              />
            }
          >
            <div class="space-y-4">
              <div class="flex items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border">
                <div class="flex-1">
                  <div class="text-xs text-muted-foreground">Effective port range</div>
                  <div class="text-sm font-mono mt-0.5">
                    {codespacesEffective().effective_min} – {codespacesEffective().effective_max}
                  </div>
                </div>
                <div class="text-xs text-muted-foreground">
                  Default: <CodeBadge>{String(DEFAULT_CODE_SERVER_PORT_MIN)}</CodeBadge> –{' '}
                  <CodeBadge>{String(DEFAULT_CODE_SERVER_PORT_MAX)}</CodeBadge>
                </div>
              </div>

              <Checkbox
                checked={useDefaultCodePorts()}
                onChange={(v) => {
                  setUseDefaultCodePorts(v);
                  setCodespacesDirty(true);
                }}
                disabled={!canInteract()}
                label="Use default port range"
                size="sm"
              />

              <Show when={!useDefaultCodePorts()}>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>code_server_port_min</FieldLabel>
                    <Input
                      value={codePortMin() === '' ? '' : String(codePortMin())}
                      onInput={(e) => {
                        const v = e.currentTarget.value.trim();
                        setCodePortMin(v ? Number(v) : '');
                        setCodespacesDirty(true);
                      }}
                      placeholder="20000"
                      size="sm"
                      class="w-full"
                      disabled={!canInteract()}
                    />
                  </div>
                  <div>
                    <FieldLabel>code_server_port_max</FieldLabel>
                    <Input
                      value={codePortMax() === '' ? '' : String(codePortMax())}
                      onInput={(e) => {
                        const v = e.currentTarget.value.trim();
                        setCodePortMax(v ? Number(v) : '');
                        setCodespacesDirty(true);
                      }}
                      placeholder="21000"
                      size="sm"
                      class="w-full"
                      disabled={!canInteract()}
                    />
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </SettingsCard>

        {/* Permission Policy Card */}
        <SettingsCard
          icon={Shield}
          title="Permission Policy"
          description="Control read, write, and execute permissions."
          badge="Restart required"
          badgeVariant="warning"
          error={policyError()}
          actions={
            <>
              <ViewToggle value={policyView} disabled={!canInteract()} onChange={(v) => switchPolicyView(v)} />
              <Button size="sm" variant="outline" onClick={() => resetPolicy()} disabled={!canInteract()}>
                Reset
              </Button>
              <Button size="sm" variant="default" onClick={() => void savePolicy()} loading={policySaving()} disabled={!canInteract()}>
                Save
              </Button>
            </>
          }
        >
          <Show
            when={policyView() === 'ui'}
            fallback={
              <JSONEditor
                value={policyJSON()}
                onChange={(v) => {
                  setPolicyJSON(v);
                  setPolicyDirty(true);
                }}
                disabled={!canInteract()}
                rows={12}
              />
            }
          >
            <div class="space-y-6">
              {/* Schema version */}
              <div class="text-xs text-muted-foreground">
                schema_version: <CodeBadge>1</CodeBadge>
              </div>

              {/* Local max */}
              <div class="space-y-3">
                <div class="text-sm font-medium text-foreground">local_max</div>
                <div class="flex flex-wrap gap-6">
                  <Checkbox
                    checked={policyLocalRead()}
                    onChange={(v) => {
                      setPolicyLocalRead(v);
                      setPolicyDirty(true);
                    }}
                    disabled={!canInteract()}
                    label="read"
                    size="sm"
                  />
                  <Checkbox
                    checked={policyLocalWrite()}
                    onChange={(v) => {
                      setPolicyLocalWrite(v);
                      setPolicyDirty(true);
                    }}
                    disabled={!canInteract()}
                    label="write"
                    size="sm"
                  />
                  <Checkbox
                    checked={policyLocalExecute()}
                    onChange={(v) => {
                      setPolicyLocalExecute(v);
                      setPolicyDirty(true);
                    }}
                    disabled={!canInteract()}
                    label="execute"
                    size="sm"
                  />
                </div>
                <p class="text-xs text-muted-foreground">User and app rules are AND-ed with local_max.</p>
              </div>

              {/* by_user */}
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <div class="text-sm font-medium text-foreground">by_user</div>
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
                </div>

                <Show when={policyByUser().length > 0} fallback={<p class="text-xs text-muted-foreground">No user-specific overrides.</p>}>
                  <div class="space-y-3">
                    <For each={policyByUser()}>
                      {(row, idx) => (
                        <div class="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
                          <div class="flex items-start justify-between gap-3">
                            <div class="flex-1">
                              <FieldLabel>user_public_id</FieldLabel>
                              <Input
                                value={row.key}
                                onInput={(e) => {
                                  const v = e.currentTarget.value;
                                  setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, key: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                placeholder="user_xxx"
                                size="sm"
                                class="w-full"
                                disabled={!canInteract()}
                              />
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setPolicyByUser((prev) => prev.filter((_, i) => i !== idx()));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract()}
                            >
                              Remove
                            </Button>
                          </div>
                          <div class="flex flex-wrap gap-6">
                            <Checkbox
                              checked={row.read}
                              onChange={(v) => {
                                setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, read: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalRead()}
                              label="read"
                              size="sm"
                            />
                            <Checkbox
                              checked={row.write}
                              onChange={(v) => {
                                setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, write: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalWrite()}
                              label="write"
                              size="sm"
                            />
                            <Checkbox
                              checked={row.execute}
                              onChange={(v) => {
                                setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, execute: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalExecute()}
                              label="execute"
                              size="sm"
                            />
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              {/* by_app */}
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <div class="text-sm font-medium text-foreground">by_app</div>
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
                </div>

                <Show when={policyByApp().length > 0} fallback={<p class="text-xs text-muted-foreground">No app-specific overrides.</p>}>
                  <div class="space-y-3">
                    <For each={policyByApp()}>
                      {(row, idx) => (
                        <div class="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
                          <div class="flex items-start justify-between gap-3">
                            <div class="flex-1">
                              <FieldLabel>floe_app</FieldLabel>
                              <Input
                                value={row.key}
                                onInput={(e) => {
                                  const v = e.currentTarget.value;
                                  setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, key: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                placeholder="redeven.env"
                                size="sm"
                                class="w-full"
                                disabled={!canInteract()}
                              />
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setPolicyByApp((prev) => prev.filter((_, i) => i !== idx()));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract()}
                            >
                              Remove
                            </Button>
                          </div>
                          <div class="flex flex-wrap gap-6">
                            <Checkbox
                              checked={row.read}
                              onChange={(v) => {
                                setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, read: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalRead()}
                              label="read"
                              size="sm"
                            />
                            <Checkbox
                              checked={row.write}
                              onChange={(v) => {
                                setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, write: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalWrite()}
                              label="write"
                              size="sm"
                            />
                            <Checkbox
                              checked={row.execute}
                              onChange={(v) => {
                                setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, execute: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalExecute()}
                              label="execute"
                              size="sm"
                            />
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </SettingsCard>

        {/* AI Card */}
        <div id="redeven-settings-ai">
          <SettingsCard
            icon={Bot}
            title="AI"
            description="Configure AI providers and models. API keys are stored locally and never sent to the control-plane."
            badge={aiEnabled() ? 'Enabled' : 'Disabled'}
            badgeVariant={aiEnabled() ? 'success' : 'default'}
            error={aiError()}
            actions={
              <>
                <ViewToggle value={aiView} disabled={!canInteract()} onChange={(v) => switchAIView(v)} />
                <Button size="sm" variant="outline" onClick={() => resetAI()} disabled={!canInteract() || aiSaving()}>
                  Reset
                </Button>
                <Show when={aiEnabled()}>
                  <Button size="sm" variant="destructive" onClick={() => setDisableAIOpen(true)} disabled={!canInteract() || aiSaving()}>
                    Disable
                  </Button>
                </Show>
                <Button size="sm" variant="default" onClick={() => void saveAI()} loading={aiSaving()} disabled={!canInteract()}>
                  {aiEnabled() ? 'Save' : 'Enable AI'}
                </Button>
              </>
            }
          >
            <Show when={!aiEnabled() && !settings.loading && !settings.error}>
              <div class="flex items-center gap-3 p-4 rounded-lg bg-muted/30 border border-border">
                <Zap class="w-5 h-5 text-muted-foreground" />
                <div class="text-sm text-muted-foreground">
                  AI is currently disabled. Configure the settings below and click <strong>Enable AI</strong> to activate.
                </div>
              </div>
            </Show>

            <Show
              when={aiView() === 'ui'}
              fallback={
                <JSONEditor
                  value={aiJSON()}
                  onChange={(v) => {
                    setAiJSON(v);
                    setAiDirty(true);
                  }}
                  disabled={!canInteract()}
                  rows={14}
                />
              }
            >
              <div class="space-y-6">
                {/* Default model */}
                <div class="space-y-2">
                  <FieldLabel>default_model</FieldLabel>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
                    <div>
                      <FieldLabel hint="required">provider_id</FieldLabel>
                      <Select
                        value={String(aiDefaultProviderID() ?? '').trim()}
                        onChange={(v) => {
                          setAiDefaultProviderID(String(v ?? '').trim());
                          setAiDirty(true);
                        }}
                        disabled={!canInteract()}
                        options={aiProviders()
                          .map((p) => {
                            const id = String(p.id ?? '').trim();
                            const name = String(p.name ?? '').trim();
                            if (!id) return null;
                            return { value: id, label: name || id };
                          })
                          .filter((x) => !!x) as any}
                        class="w-full"
                      />
                    </div>
                    <div>
                      <FieldLabel hint="required">model_name</FieldLabel>
                      <Input
                        value={String(aiDefaultModelName() ?? '')}
                        onInput={(e) => {
                          setAiDefaultModelName(e.currentTarget.value);
                          setAiDirty(true);
                        }}
                        placeholder="gpt-5-mini"
                        size="sm"
                        class="w-full"
                        disabled={!canInteract()}
                      />
                    </div>
                  </div>
                  <div class="text-xs text-muted-foreground">
                    Wire id: <span class="font-mono">{modelID({ provider_id: aiDefaultProviderID(), model_name: aiDefaultModelName() })}</span>
                  </div>
                </div>

                {/* Providers */}
                <div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <div class="text-sm font-medium text-foreground">Providers</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const id = newProviderID();
                        setAiProviders((prev) => [
                          ...prev,
                          { id, name: '', type: 'openai', base_url: 'https://api.openai.com/v1' },
                        ]);
                        if (!String(aiDefaultProviderID() ?? '').trim()) {
                          setAiDefaultProviderID(id);
                        }
                        setAiDirty(true);
                      }}
                      disabled={!canInteract()}
                    >
                      Add Provider
                    </Button>
	                  </div>

	                  <div class="space-y-3">
	                    <Index each={aiProviders()}>
	                      {(p, idx) => (
	                        <div class="p-4 rounded-lg border border-border bg-muted/20 space-y-4">
	                          <div class="flex items-center justify-between">
	                            <div class="flex items-center gap-2">
	                              <Layers class="w-4 h-4 text-muted-foreground" />
		                              <span class="text-sm font-medium">Provider {idx + 1}</span>
	                            </div>
	                            <Button
	                              size="sm"
	                              variant="ghost"
	                              class="text-muted-foreground hover:text-destructive"
	                              onClick={() => {
	                                const removedID = String(p().id ?? '').trim();
	                                setAiProviders((prev) => {
		                                  const next = prev.filter((_, i) => i !== idx);
	                                  if (removedID && String(aiDefaultProviderID() ?? '').trim() === removedID) {
	                                    const nextID = String(next?.[0]?.id ?? '').trim();
	                                    setAiDefaultProviderID(nextID);
	                                  }
	                                  return next;
	                                });
	                                if (removedID) {
	                                  setAiModels((prev) => prev.filter((m) => String(m.provider_id ?? '').trim() !== removedID));
	                                }
	                                setAiDirty(true);
	                              }}
	                              disabled={!canInteract()}
	                            >
	                              Remove
	                            </Button>
	                          </div>

	                          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
	                            <div>
	                              <FieldLabel hint="optional">name</FieldLabel>
	                              <Input
	                                value={p().name}
	                                onInput={(e) => {
	                                  const v = e.currentTarget.value;
		                                  setAiProviders((prev) => prev.map((it, i) => (i === idx ? { ...it, name: v } : it)));
	                                  setAiDirty(true);
	                                }}
	                                placeholder="OpenAI"
	                                size="sm"
	                                class="w-full"
	                                disabled={!canInteract()}
	                              />
	                            </div>
	                            <div>
	                              <FieldLabel>type</FieldLabel>
	                              <Select
	                                value={p().type}
	                                onChange={(v) => {
		                                  setAiProviders((prev) => prev.map((it, i) => (i === idx ? { ...it, type: v as AIProviderType } : it)));
	                                  setAiDirty(true);
	                                }}
	                                disabled={!canInteract()}
	                                options={[
	                                  { value: 'openai', label: 'openai' },
	                                  { value: 'anthropic', label: 'anthropic' },
	                                  { value: 'openai_compatible', label: 'openai_compatible' },
	                                ]}
	                                class="w-full"
	                              />
	                            </div>
	                            <div class="md:col-span-2">
	                              <FieldLabel hint="read-only">provider_id</FieldLabel>
	                              <Input value={String(p().id ?? '')} size="sm" class="w-full font-mono" disabled />
	                            </div>
	                            <div class="md:col-span-2">
	                              <FieldLabel hint={p().type === 'openai_compatible' ? 'required' : 'optional'}>base_url</FieldLabel>
	                              <Input
	                                value={p().base_url}
	                                onInput={(e) => {
	                                  const v = e.currentTarget.value;
		                                  setAiProviders((prev) => prev.map((it, i) => (i === idx ? { ...it, base_url: v } : it)));
	                                  setAiDirty(true);
	                                }}
	                                placeholder={p().type === 'openai_compatible' ? 'https://api.example.com/v1' : 'https://api.openai.com/v1'}
	                                size="sm"
	                                class="w-full"
	                                disabled={!canInteract()}
	                              />
	                            </div>

	                            <div class="md:col-span-2 space-y-2">
	                              <FieldLabel hint="stored locally, never shown again">api_key</FieldLabel>
	                              <div class="flex flex-col sm:flex-row sm:items-center gap-2">
	                                <div
	                                  class={
	                                    'text-xs px-2 py-1 rounded-md border ' +
	                                    (aiProviderKeySet()?.[String(p().id ?? '').trim()]
	                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
	                                      : 'bg-muted/40 border-border text-muted-foreground')
	                                  }
	                                >
	                                  {aiProviderKeySet()?.[String(p().id ?? '').trim()] ? 'Key set' : 'Key not set'}
	                                </div>
	                                <Input
	                                  type="password"
	                                  value={aiProviderKeyDraft()?.[String(p().id ?? '').trim()] ?? ''}
	                                  onInput={(e) => {
	                                    const id = String(p().id ?? '').trim();
	                                    const v = e.currentTarget.value;
	                                    if (!id) return;
	                                    setAiProviderKeyDraft((prev) => ({ ...prev, [id]: v }));
	                                  }}
	                                  placeholder="Paste API key"
	                                  size="sm"
	                                  class="w-full"
	                                  disabled={!canInteract() || !canAdmin() || !String(p().id ?? '').trim()}
	                                />
	                                <Button
	                                  size="sm"
	                                  variant="outline"
	                                  onClick={() => saveAIProviderKey(String(p().id ?? '').trim())}
	                                  loading={!!aiProviderKeySaving()?.[String(p().id ?? '').trim()]}
	                                  disabled={!canInteract() || !canAdmin() || !String(p().id ?? '').trim()}
	                                >
	                                  Save key
	                                </Button>
	                                <Button
	                                  size="sm"
	                                  variant="ghost"
	                                  class="text-muted-foreground hover:text-destructive"
	                                  onClick={() => clearAIProviderKey(String(p().id ?? '').trim())}
	                                  disabled={!canInteract() || !canAdmin() || !String(p().id ?? '').trim()}
	                                >
	                                  Clear
	                                </Button>
	                              </div>
	                              <p class="text-xs text-muted-foreground">
	                                Keys are saved in a separate local secrets file and are never written to config.json. They are injected into the sidecar as{' '}
	                                <span class="font-mono">{AI_API_KEY_ENV}</span>.
	                              </p>
	                            </div>
	                          </div>
	                        </div>
	                      )}
	                    </Index>
	                  </div>
	                </div>

                {/* Models allow-list */}
                <div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <div>
                      <div class="text-sm font-medium text-foreground">Models Allow-list</div>
                      <p class="text-xs text-muted-foreground mt-0.5">When disabled, only default_model will be exposed.</p>
                    </div>
                    <Checkbox
                      checked={aiUseModelList()}
                      onChange={(v) => {
                        setAiUseModelList(v);
                        setAiDirty(true);
                        if (v) {
                          // Convenience: include default_model as the first allow-list entry.
                          setAiModels((prev) => {
                            if (prev.length > 0) return prev;
                            const pid = String(aiDefaultProviderID() ?? '').trim() || String(aiProviders()?.[0]?.id ?? '').trim();
                            const mn = String(aiDefaultModelName() ?? '').trim();
                            if (!pid || !mn) return prev;
                            return [{ provider_id: pid, model_name: mn, label: '' }];
                          });
                        }
                      }}
                      disabled={!canInteract()}
                      label="Enable allow-list"
                      size="sm"
                    />
                  </div>

                  <Show when={aiUseModelList()}>
                    <div class="space-y-3">
                      <div class="flex items-center justify-between">
                        <p class="text-xs text-muted-foreground">Models are defined by provider_id + model_name (wire id: &lt;provider_id&gt;/&lt;model_name&gt;).</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const pid = String(aiDefaultProviderID() ?? '').trim() || String(aiProviders()?.[0]?.id ?? '').trim();
                            setAiModels((prev) => [...prev, { provider_id: pid, model_name: '', label: '' }]);
                            setAiDirty(true);
                          }}
                          disabled={!canInteract()}
                        >
                          Add Model
                        </Button>
                      </div>

	                      <Show when={aiModels().length > 0} fallback={<p class="text-xs text-muted-foreground">No models configured.</p>}>
	                        <div class="space-y-3">
	                          <Index each={aiModels()}>
	                            {(m, idx) => (
	                              <div class="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
	                                <div class="flex items-center justify-between">
		                                  <span class="text-sm font-medium">Model {idx + 1}</span>
	                                  <Button
	                                    size="sm"
	                                    variant="ghost"
	                                    class="text-muted-foreground hover:text-destructive"
	                                    onClick={() => {
		                                      setAiModels((prev) => prev.filter((_, i) => i !== idx));
	                                      setAiDirty(true);
	                                    }}
	                                    disabled={!canInteract()}
	                                  >
	                                    Remove
	                                  </Button>
	                                </div>
	                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
	                                  <div>
	                                    <FieldLabel hint="required">provider_id</FieldLabel>
	                                    <Select
	                                      value={String(m().provider_id ?? '').trim()}
	                                      onChange={(v) => {
	                                        const pid = String(v ?? '').trim();
		                                        setAiModels((prev) => prev.map((it, i) => (i === idx ? { ...it, provider_id: pid } : it)));
	                                        setAiDirty(true);
	                                      }}
	                                      disabled={!canInteract()}
	                                      options={aiProviders()
	                                        .map((p) => {
	                                          const id = String(p.id ?? '').trim();
	                                          const name = String(p.name ?? '').trim();
	                                          if (!id) return null;
	                                          return { value: id, label: name || id };
	                                        })
	                                        .filter((x) => !!x) as any}
	                                      class="w-full"
	                                    />
	                                  </div>
	                                  <div>
	                                    <FieldLabel hint="required">model_name</FieldLabel>
	                                    <Input
	                                      value={m().model_name}
	                                      onInput={(e) => {
	                                        const v = e.currentTarget.value;
		                                        setAiModels((prev) => prev.map((it, i) => (i === idx ? { ...it, model_name: v } : it)));
	                                        setAiDirty(true);
	                                      }}
	                                      placeholder="gpt-5-mini"
	                                      size="sm"
	                                      class="w-full"
	                                      disabled={!canInteract()}
	                                    />
	                                  </div>
	                                  <div class="md:col-span-2">
	                                    <FieldLabel hint="optional">label</FieldLabel>
	                                    <Input
	                                      value={m().label}
	                                      onInput={(e) => {
	                                        const v = e.currentTarget.value;
		                                        setAiModels((prev) => prev.map((it, i) => (i === idx ? { ...it, label: v } : it)));
	                                        setAiDirty(true);
	                                      }}
	                                      placeholder="GPT-5 Mini"
	                                      size="sm"
	                                      class="w-full"
	                                      disabled={!canInteract()}
	                                    />
	                                    <div class="text-xs text-muted-foreground mt-1">
	                                      Wire id:{' '}
	                                      <span class="font-mono">{modelID({ provider_id: m().provider_id, model_name: m().model_name })}</span>
	                                    </div>
	                                  </div>
	                                </div>
	                              </div>
	                            )}
	                          </Index>
	                        </div>
	                      </Show>
	                    </div>
	                  </Show>
	                </div>
              </div>
            </Show>
          </SettingsCard>
        </div>
      </div>

      {/* Update Agent Confirmation Dialog */}
      <ConfirmDialog
        open={upgradeOpen()}
        onOpenChange={(open) => setUpgradeOpen(open)}
        title="Update agent"
        confirmText="Update"
        loading={isUpgrading()}
        onConfirm={() => void startUpgrade()}
      >
        <div class="space-y-3">
          <p class="text-sm">This will restart the agent and terminate all running activities. Continue?</p>
          <p class="text-xs text-muted-foreground">You will reconnect automatically after the agent comes back online.</p>
        </div>
      </ConfirmDialog>

      {/* Restart Agent Confirmation Dialog */}
      <ConfirmDialog
        open={restartOpen()}
        onOpenChange={(open) => setRestartOpen(open)}
        title="Restart agent"
        confirmText="Restart"
        loading={isRestarting()}
        onConfirm={() => void startRestart()}
      >
        <div class="space-y-3">
          <p class="text-sm">This will restart the agent and terminate all running activities. Continue?</p>
          <p class="text-xs text-muted-foreground">You will reconnect automatically after the agent comes back online.</p>
        </div>
      </ConfirmDialog>

      {/* Disable AI Confirmation Dialog */}
      <ConfirmDialog
        open={disableAIOpen()}
        onOpenChange={(open) => setDisableAIOpen(open)}
        title="Disable AI"
        confirmText="Disable"
        variant="destructive"
        loading={disableAISaving()}
        onConfirm={() => void disableAI()}
      >
        <div class="space-y-3">
          <p class="text-sm">Are you sure you want to disable AI?</p>
          <p class="text-xs text-muted-foreground">
            This will remove the <CodeBadge>ai</CodeBadge> section from the agent config file.
          </p>
        </div>
      </ConfirmDialog>

      {/* Loading Overlays */}
      <LoadingOverlay visible={protocol.status() !== 'connected'} message={connectOverlayMessage()} />
      <LoadingOverlay visible={settings.loading && protocol.status() === 'connected'} message="Loading settings..." />
    </div>
  );
}
