import { For, Index, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import {
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
import { Sidebar, SidebarContent, SidebarItem, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Card, Checkbox, ConfirmDialog, Input, Select } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import { fetchGatewayJSON } from '../services/gatewayApi';
import { getAgentLatestVersion, getEnvironment } from '../services/controlplaneApi';
import { FlowerIcon } from '../icons/FlowerIcon';
import { useRedevenRpc } from '../protocol/redeven_v1/hooks';
import { useEnvContext, type EnvSettingsSection } from './EnvContext';

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
type AIProviderModel = Readonly<{ model_name: string; is_default?: boolean }>;
type AIProvider = Readonly<{ id: string; name?: string; type: AIProviderType; base_url?: string; models: AIProviderModel[] }>;
type AIExecutionPolicy = Readonly<{
  require_user_approval?: boolean;
  enforce_plan_mode_guard?: boolean;
  block_dangerous_commands?: boolean;
}>;
type AIConfig = Readonly<{
  providers: AIProvider[];
  mode?: 'act' | 'plan';
  web_search_provider?: 'prefer_openai' | 'brave' | 'disabled';
  tool_recovery_enabled?: boolean;
  tool_recovery_max_steps?: number;
  tool_recovery_allow_path_rewrite?: boolean;
  tool_recovery_allow_probe_tools?: boolean;
  tool_recovery_fail_on_repeated_signature?: boolean;
  execution_policy?: AIExecutionPolicy;
}>;
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
type AIProviderModelRow = { model_name: string; is_default: boolean };
type AIProviderRow = { id: string; name: string; type: AIProviderType; base_url: string; models: AIProviderModelRow[] };
type AIPreservedUIFields = {
  mode?: 'act' | 'plan';
  tool_recovery_enabled?: boolean;
  tool_recovery_max_steps?: number;
  tool_recovery_allow_path_rewrite?: boolean;
  tool_recovery_allow_probe_tools?: boolean;
  tool_recovery_fail_on_repeated_signature?: boolean;
};

// ============================================================================
// Constants & Helpers
// ============================================================================

const DEFAULT_CODE_SERVER_PORT_MIN = 20000;
const DEFAULT_CODE_SERVER_PORT_MAX = 21000;
const RELEASE_VERSION_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

type SettingsNavItem = Readonly<{
  id: EnvSettingsSection;
  label: string;
  icon: (props: { class?: string }) => JSX.Element;
}>;

const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { id: 'config', label: 'Config File', icon: FileCode },
  { id: 'connection', label: 'Connection', icon: Globe },
  { id: 'agent', label: 'Agent', icon: Zap },
  { id: 'runtime', label: 'Runtime', icon: Terminal },
  { id: 'logging', label: 'Logging', icon: Database },
  { id: 'codespaces', label: 'Codespaces', icon: Code },
  { id: 'permission_policy', label: 'Permission Policy', icon: Shield },
  { id: 'ai', label: 'Flower', icon: FlowerIcon },
];

function settingsSectionElementID(section: EnvSettingsSection): string {
  return `redeven-settings-${section}`;
}

function isReleaseVersion(raw: string): boolean {
  const v = String(raw ?? '').trim();
  if (!v) return false;
  return RELEASE_VERSION_RE.test(v);
}

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) return String(err.message || '').trim();
  if (typeof err === 'string') return String(err).trim();
  return '';
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

function modelID(providerID: string, modelName: string): string {
  const pid = String(providerID ?? '').trim();
  const mn = String(modelName ?? '').trim();
  if (!pid || !mn) return '';
  return `${pid}/${mn}`;
}

function defaultPermissionPolicy(): PermissionPolicy {
  return { schema_version: 1, local_max: { read: true, write: false, execute: true } };
}

function defaultAIConfig(): AIConfig {
  return {
    web_search_provider: 'prefer_openai',
    execution_policy: {
      require_user_approval: false,
      enforce_plan_mode_guard: false,
      block_dangerous_commands: false,
    },
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        base_url: 'https://api.openai.com/v1',
        models: [{ model_name: 'gpt-5-mini', is_default: true }],
      },
    ],
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
    warning: 'bg-warning/10 text-warning border border-warning/50',
    success: 'bg-success/10 text-success border border-success/50',
  };

  return (
    <Card class="overflow-hidden shadow-sm">
      <div class="border-b border-border bg-muted/20 px-4 py-3.5 sm:px-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="flex min-w-0 items-start gap-3">
            <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center ring-1 ring-primary/15">
              <props.icon class="w-4 h-4 text-primary" />
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-semibold text-foreground tracking-tight">{props.title}</h3>
                <Show when={props.badge}>
                  <span class={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badgeColors[props.badgeVariant ?? 'default']}`}>
                    {props.badge}
                  </span>
                </Show>
              </div>
              <p class="mt-0.5 text-xs text-muted-foreground break-words leading-relaxed">{props.description}</p>
            </div>
          </div>
          <Show when={props.actions}>
            <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-shrink-0 sm:justify-end">{props.actions}</div>
          </Show>
        </div>
      </div>

      <div class="p-4 space-y-4 sm:p-5">
        <Show when={props.error}>
          <div class="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div class="w-1 h-full min-h-4 rounded-full bg-destructive/60 flex-shrink-0" />
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
    <div class="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2.5 border-b border-border/60 last:border-b-0">
      <div class="text-xs font-medium text-muted-foreground sm:w-40 sm:flex-shrink-0 sm:text-right">{props.label}</div>
      <div class={`text-sm break-all min-w-0 ${props.mono ? 'font-mono text-xs leading-relaxed' : ''}`}>{props.value || '—'}</div>
    </div>
  );
}

function CodeBadge(props: { children: string }) {
  return <code class="px-1.5 py-0.5 text-xs font-mono bg-muted rounded">{props.children}</code>;
}

function SectionGroup(props: { title: string; children: JSX.Element }) {
  return (
    <div class="space-y-4">
      <div class="flex items-center gap-3 pt-2">
        <h2 class="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">{props.title}</h2>
        <div class="flex-1 h-px bg-border/50" />
      </div>
      {props.children}
    </div>
  );
}

function SubSectionHeader(props: { title: string; description?: string; actions?: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div class="text-sm font-semibold text-foreground">{props.title}</div>
        <Show when={props.description}>
          <p class="text-xs text-muted-foreground mt-0.5">{props.description}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="flex-shrink-0">{props.actions}</div>
      </Show>
    </div>
  );
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

  const [targetVersionInput, setTargetVersionInput] = createSignal('');
  const preferredUpgradeVersion = createMemo(() => {
    const v = latestVersion();
    if (!v) return '';
    const preferred = v.recommended_version ? String(v.recommended_version).trim() : '';
    if (preferred) return preferred;
    return v.latest_version ? String(v.latest_version).trim() : '';
  });
  const targetUpgradeVersion = createMemo(() => String(targetVersionInput() ?? '').trim());
  const targetUpgradeVersionValid = createMemo(() => isReleaseVersion(targetUpgradeVersion()));
  const latestVersionError = createMemo(() => formatUnknownError(latestVersion.error));

  createEffect(() => {
    const preferred = preferredUpgradeVersion();
    if (!preferred) return;
    if (String(targetVersionInput() ?? '').trim()) return;
    setTargetVersionInput(preferred);
  });

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
    if (latestVersion.loading) return false;
    if (latestVersionError()) return false;
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

    const requestedVersion = kind === 'upgrade' ? targetUpgradeVersion() : '';
    if (kind === 'upgrade') {
      if (latestVersion.loading) {
        const msg = 'Latest version metadata is still loading.';
        setMaintenanceError(msg);
        notify.error('Update failed', msg);
        return;
      }
      if (latestVersionError()) {
        const msg = 'Latest version metadata is unavailable. Please retry after refresh.';
        setMaintenanceError(msg);
        notify.error('Update failed', msg);
        return;
      }
      if (!isReleaseVersion(requestedVersion)) {
        const msg = 'Target version must be a valid release tag (for example: v1.2.3).';
        setMaintenanceError(msg);
        notify.error('Update failed', msg);
        return;
      }
    }

    setMaintenanceKind(kind);

    const beforeVersion = kind === 'upgrade' && agentPing()?.version ? String(agentPing()!.version) : '';

    let started = false;
    try {
      const resp =
        kind === 'upgrade'
          ? await rpc.sys.upgrade({ targetVersion: requestedVersion })
          : await rpc.sys.restart();
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
        kind === 'upgrade'
          ? `Target version: ${requestedVersion}`
          : resp?.message
            ? String(resp.message)
            : 'The agent will restart shortly.',
      );
    } catch (e) {
      const msg = formatUnknownError(e);
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
  const [aiProviders, setAiProviders] = createSignal<AIProviderRow[]>([
    {
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      base_url: 'https://api.openai.com/v1',
      models: [{ model_name: 'gpt-5-mini', is_default: true }],
    },
  ]);
  const [aiPreservedFields, setAiPreservedFields] = createSignal<AIPreservedUIFields>({});
  const [aiRequireUserApproval, setAiRequireUserApproval] = createSignal(false);
  const [aiEnforcePlanModeGuard, setAiEnforcePlanModeGuard] = createSignal(false);
  const [aiBlockDangerousCommands, setAiBlockDangerousCommands] = createSignal(false);
  const [aiWebSearchProvider, setAiWebSearchProvider] = createSignal<'prefer_openai' | 'brave' | 'disabled'>('prefer_openai');

  // AI provider keys (stored locally in secrets.json; never returned in plaintext).
  const [aiProviderKeySet, setAiProviderKeySet] = createSignal<Record<string, boolean>>({});
  const [aiProviderKeyDraft, setAiProviderKeyDraft] = createSignal<Record<string, string>>({});
  const [aiProviderKeySaving, setAiProviderKeySaving] = createSignal<Record<string, boolean>>({});

  // Web search provider keys (stored locally in secrets.json; never returned in plaintext).
  const [webSearchKeySet, setWebSearchKeySet] = createSignal<Record<string, boolean>>({});
  const [webSearchKeyDraft, setWebSearchKeyDraft] = createSignal<Record<string, string>>({});
  const [webSearchKeySaving, setWebSearchKeySaving] = createSignal<Record<string, boolean>>({});

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
      out.models = (p.models ?? []).map((m) => {
        const mm: any = { model_name: String(m.model_name ?? '').trim() };
        if (m.is_default) mm.is_default = true;
        return mm as AIProviderModel;
      });

      return out as AIProvider;
    });

    const preserved = aiPreservedFields();
    const out: any = { providers, web_search_provider: aiWebSearchProvider() };
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
    out.execution_policy = {
      require_user_approval: !!aiRequireUserApproval(),
      enforce_plan_mode_guard: !!aiEnforcePlanModeGuard(),
      block_dangerous_commands: !!aiBlockDangerousCommands(),
    };
    return out as AIConfig;
  };

  const validateAIValue = (cfg: AIConfig) => {
    const mode = String((cfg as any).mode ?? '').trim();
    if (mode && mode !== 'act' && mode !== 'plan') throw new Error(`Invalid Flower mode: ${mode}`);
    const webSearchProvider = (cfg as any).web_search_provider;
    if (webSearchProvider !== undefined) {
      if (typeof webSearchProvider !== 'string') throw new Error('web_search_provider must be a string.');
      const normalized = String(webSearchProvider ?? '')
        .trim()
        .toLowerCase();
      if (normalized && normalized !== 'prefer_openai' && normalized !== 'brave' && normalized !== 'disabled') {
        throw new Error(`Invalid web_search_provider: ${webSearchProvider}`);
      }
    }
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
      if ((ep as any).enforce_plan_mode_guard !== undefined && typeof (ep as any).enforce_plan_mode_guard !== 'boolean') {
        throw new Error('execution_policy.enforce_plan_mode_guard must be a boolean.');
      }
      if ((ep as any).block_dangerous_commands !== undefined && typeof (ep as any).block_dangerous_commands !== 'boolean') {
        throw new Error('execution_policy.block_dangerous_commands must be a boolean.');
      }
    }

    const providers = Array.isArray((cfg as any).providers) ? (cfg as any).providers : [];
    if (providers.length === 0) throw new Error('Missing providers.');

    const providerIDs = new Set<string>();
    let defaultCount = 0;
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

      if (models.length === 0) throw new Error(`Provider "${id}" is missing models.`);

      const modelNames = new Set<string>();
      for (const m of models) {
        const mn = String((m as any).model_name ?? '').trim();
        const isDefault = !!(m as any).is_default;
        if ((m as any).label !== undefined) {
          throw new Error(`Provider "${id}" models[].label is not supported. Use model_name only.`);
        }
        if (!mn) throw new Error(`Provider "${id}" has a model with missing model_name.`);
        if (mn.includes('/')) throw new Error(`Provider "${id}" model_name must not contain "/".`);
        if (modelNames.has(mn)) throw new Error(`Provider "${id}" has duplicate model_name: ${mn}`);
        modelNames.add(mn);
        if (isDefault) defaultCount++;
      }
    }

    if (defaultCount === 0) throw new Error('Missing default model (providers[].models[].is_default).');
    if (defaultCount > 1) throw new Error('Multiple default models (providers[].models[].is_default).');
  };

  const normalizeAIProviders = (rows: AIProviderRow[]): AIProviderRow[] => {
    const list: AIProviderRow[] = (Array.isArray(rows) ? rows : []).map((p) => ({
      id: String((p as any).id ?? ''),
      name: String((p as any).name ?? ''),
      type: (p as any).type as AIProviderType,
      base_url: String((p as any).base_url ?? ''),
      models: (Array.isArray((p as any).models) ? ((p as any).models as any[]) : []).map((m) => ({
        model_name: String(m?.model_name ?? ''),
        is_default: !!m?.is_default,
      })),
    }));

    let defaultFound = false;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const models = Array.isArray(p.models) ? p.models : [];
      if (models.length === 0) {
        p.models = [{ model_name: '', is_default: false }];
        continue;
      }
      p.models = models.map((m) => {
        if (!m.is_default) return { ...m, is_default: false };
        if (defaultFound) return { ...m, is_default: false };
        defaultFound = true;
        return { ...m, is_default: true };
      });
    }

    if (!defaultFound && list.length > 0 && list[0].models.length > 0) {
      list[0] = { ...list[0], models: [{ ...list[0].models[0], is_default: true }, ...list[0].models.slice(1)] };
    }
    return list;
  };

  const readAIExecutionPolicy = (cfg: unknown) => {
    const raw = isJSONObject(cfg) ? (cfg as any).execution_policy : null;
    return {
      require_user_approval: !!(isJSONObject(raw) ? (raw as any).require_user_approval : false),
      enforce_plan_mode_guard: !!(isJSONObject(raw) ? (raw as any).enforce_plan_mode_guard : false),
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
    return out;
  };

  const normalizeWebSearchProvider = (raw: unknown): 'prefer_openai' | 'brave' | 'disabled' => {
    const v = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (v === 'prefer_openai' || v === 'brave' || v === 'disabled') {
      return v as 'prefer_openai' | 'brave' | 'disabled';
    }
    return 'prefer_openai';
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
    } catch (e) {
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

      if (apiKey) notify.success('Saved', `API key saved for web search provider "${id}".`);
      else notify.success('Cleared', `API key cleared for web search provider "${id}".`);
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
      notify.error('Missing API key', 'Please paste an API key first.');
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
      const executionPolicy = readAIExecutionPolicy(a);
      setAiRequireUserApproval(!!executionPolicy.require_user_approval);
      setAiEnforcePlanModeGuard(!!executionPolicy.enforce_plan_mode_guard);
      setAiBlockDangerousCommands(!!executionPolicy.block_dangerous_commands);
      setAiPreservedFields(readAIPreservedFields(a));
      setAiWebSearchProvider(normalizeWebSearchProvider((a as any).web_search_provider));
      const rows: AIProviderRow[] = (a.providers ?? []).map((p) => ({
        id: String(p.id ?? ''),
        name: String(p.name ?? ''),
        type: p.type,
        base_url: String(p.base_url ?? ''),
        models: (p.models ?? []).map((m) => ({
          model_name: String(m.model_name ?? ''),
          is_default: !!m.is_default,
        })),
      }));
      const fallback = defaultAIConfig();
      const fallbackRows: AIProviderRow[] = (fallback.providers ?? []).map((p) => ({
        id: String(p.id ?? ''),
        name: String(p.name ?? ''),
        type: p.type,
        base_url: String(p.base_url ?? ''),
        models: (p.models ?? []).map((m) => ({
          model_name: String(m.model_name ?? ''),
          is_default: !!m.is_default,
        })),
      }));
      setAiProviders(normalizeAIProviders(rows.length > 0 ? rows : fallbackRows));

      setAiJSON(JSON.stringify(a, null, 2));

      const keySet = s.ai_secrets?.provider_api_key_set;
      if (keySet && typeof keySet === 'object') setAiProviderKeySet(keySet);
      void refreshAIProviderKeyStatus((a.providers ?? []).map((p) => String(p.id ?? '')));
      void refreshWebSearchKeyStatus(['brave']);
    }
  });

  // Focus/scroll to the requested section when opened via "Open Settings" from other pages.
  createEffect(() => {
    const seq = env.settingsFocusSeq();
    const section = env.settingsFocusSection();
    if (!seq || !section) return;
    requestAnimationFrame(() => scrollToSection(section));
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
      if (!isJSONObject(v)) throw new Error('Flower JSON must be an object.');

      const providersRaw = (v as any).providers;
      if (!Array.isArray(providersRaw)) throw new Error('Flower JSON is missing providers[].');

      setAiProviders(
        normalizeAIProviders(
          providersRaw.map((p) => ({
          id: String(p?.id ?? ''),
          name: String(p?.name ?? ''),
          type: String(p?.type ?? '') as AIProviderType,
          base_url: String(p?.base_url ?? ''),
          models: Array.isArray(p?.models)
            ? (p.models as any[]).map((m) => ({
                model_name: String(m?.model_name ?? ''),
                is_default: !!m?.is_default,
              }))
            : [],
        })),
        ),
      );
      const executionPolicy = readAIExecutionPolicy(v);
      setAiRequireUserApproval(!!executionPolicy.require_user_approval);
      setAiEnforcePlanModeGuard(!!executionPolicy.enforce_plan_mode_guard);
      setAiBlockDangerousCommands(!!executionPolicy.block_dangerous_commands);
      setAiPreservedFields(readAIPreservedFields(v));
      setAiWebSearchProvider(normalizeWebSearchProvider((v as any).web_search_provider));
      void refreshAIProviderKeyStatus(providersRaw.map((p) => String(p?.id ?? '')));
      void refreshWebSearchKeyStatus(['brave']);
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
        if (!isJSONObject(v)) throw new Error('Flower JSON must be an object.');
        cfg = v as AIConfig;
      } else {
        cfg = buildAIValue();
      }
      validateAIValue(cfg);
      await saveSettings({ ai: cfg });
      setAiDirty(false);
      notify.success('Saved', aiEnabled() ? 'Flower settings updated.' : 'Flower has been enabled.');
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
      notify.success('Disabled', 'Flower has been disabled.');
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
    const executionPolicy = readAIExecutionPolicy(d);
    setAiRequireUserApproval(!!executionPolicy.require_user_approval);
    setAiEnforcePlanModeGuard(!!executionPolicy.enforce_plan_mode_guard);
    setAiBlockDangerousCommands(!!executionPolicy.block_dangerous_commands);
    setAiPreservedFields(readAIPreservedFields(d));
    setAiWebSearchProvider(normalizeWebSearchProvider((d as any).web_search_provider));
    const rows: AIProviderRow[] = (d.providers ?? []).map((p) => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      type: p.type,
      base_url: String(p.base_url ?? ''),
      models: (p.models ?? []).map((m) => ({
        model_name: String(m.model_name ?? ''),
        is_default: !!m.is_default,
      })),
    }));
    setAiProviders(normalizeAIProviders(rows));
    setAiDirty(true);
    void refreshAIProviderKeyStatus(d.providers.map((p) => String(p.id ?? '')));
    void refreshWebSearchKeyStatus(['brave']);
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
            <h1 class="text-xl font-semibold text-foreground tracking-tight">Settings</h1>
            <p class="text-sm text-muted-foreground mt-1 leading-relaxed">
              Configure your agent. Flower changes apply immediately; other changes require a restart.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={settings.loading} class="gap-1.5 self-start">
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

        {/* ── Information (read-only) ── */}
        <SectionGroup title="Information">
        <div id={settingsSectionElementID('config')} class="scroll-mt-6">
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
        </div>

        {/* Connection Card */}
        <div id={settingsSectionElementID('connection')} class="scroll-mt-6">
          <SettingsCard
            icon={Globe}
            title="Connection"
            description="Connection details managed by the control plane."
            badge="Read-only"
            actions={<ViewToggle value={connectionView} onChange={(v) => setConnectionView(v)} />}
          >
            <Show when={connectionView() === 'ui'} fallback={<JSONEditor value={connectionJSONText()} onChange={() => {}} disabled rows={10} />}>
              <div class="space-y-0">
                <InfoRow label="Control Plane" value={String(settings()?.connection?.controlplane_base_url ?? '')} mono />
                <InfoRow label="Environment ID" value={String(settings()?.connection?.environment_id ?? '')} mono />
                <InfoRow label="Agent Instance ID" value={String(settings()?.connection?.agent_instance_id ?? '')} mono />
                <InfoRow label="Direct Channel" value={String(settings()?.connection?.direct?.channel_id ?? '')} mono />
                <InfoRow label="Direct Suite" value={String(settings()?.connection?.direct?.default_suite ?? '')} mono />
                <InfoRow label="E2EE PSK" value={settings()?.connection?.direct?.e2ee_psk_set ? 'Configured' : 'Not set'} />
                <InfoRow label="Direct WebSocket URL" value={String(settings()?.connection?.direct?.ws_url ?? '')} mono />
              </div>
            </Show>
          </SettingsCard>
        </div>
        </SectionGroup>

        {/* ── Agent Management ── */}
        <SectionGroup title="Agent Management">

        {/* Agent Card */}
        <div id={settingsSectionElementID('agent')} class="scroll-mt-6">
          <SettingsCard
            icon={Zap}
            title="Agent"
            description="Version and maintenance actions."
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
                  Restart agent
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  class="w-full sm:w-auto"
                  onClick={() => setUpgradeOpen(true)}
                  loading={isUpgrading()}
                  disabled={!canStartUpgrade()}
                >
                  Update agent
                </Button>
              </>
            }
          >
          <div class="grid grid-cols-3 gap-3">
            <div class="p-3 rounded-lg bg-muted/30 border border-border">
              <div class="text-[11px] font-medium text-muted-foreground mb-1">Current</div>
              <div class="text-sm font-mono font-medium">{agentPing()?.version ? String(agentPing()!.version) : '—'}</div>
            </div>
            <div class="p-3 rounded-lg bg-muted/30 border border-border">
              <div class="text-[11px] font-medium text-muted-foreground mb-1">Latest</div>
              <div class="text-sm font-mono font-medium">{latestVersion()?.latest_version ? String(latestVersion()!.latest_version) : latestVersion.loading ? 'Loading...' : '—'}</div>
            </div>
            <div class="p-3 rounded-lg bg-muted/30 border border-border">
              <div class="text-[11px] font-medium text-muted-foreground mb-1">Status</div>
              <div class="flex items-center gap-1.5">
                <div class={`w-1.5 h-1.5 rounded-full ${displayedStatus() === 'online' ? 'bg-success' : displayedStatus() === 'offline' ? 'bg-warning' : 'bg-muted-foreground'}`} />
                <span class="text-sm font-medium">{statusLabel()}</span>
              </div>
            </div>
          </div>

          <div class="mt-3 space-y-2">
            <div>
              <FieldLabel>Target version</FieldLabel>
              <Input
                value={targetVersionInput()}
                onInput={(e) => setTargetVersionInput(e.currentTarget.value)}
                placeholder="v1.2.3"
                size="sm"
                class="w-full"
                disabled={maintaining() || latestVersion.loading}
              />
            </div>
            <Show when={targetUpgradeVersion() && !targetUpgradeVersionValid()}>
              <div class="text-xs text-destructive">Use a valid release tag, for example: v1.2.3.</div>
            </Show>
            <Show when={latestVersionError()}>
              <div class="text-xs text-destructive">Latest version metadata is unavailable: {latestVersionError()}</div>
            </Show>
            <Show when={latestVersion()?.stale}>
              <div class="text-xs text-muted-foreground">Using stale version metadata from cache. Please retry refresh if possible.</div>
            </Show>
            <Show when={latestVersion()?.manifest_etag}>
              <div class="text-[11px] text-muted-foreground">Manifest ETag: <span class="font-mono">{String(latestVersion()!.manifest_etag)}</span></div>
            </Show>
          </div>

          <Show when={!canAdmin()}>
            <div class="text-xs text-muted-foreground">Admin permission required.</div>
          </Show>

          <Show when={maintenanceStage()}>
            <div class="text-xs text-muted-foreground">{maintenanceStage()}</div>
          </Show>
          </SettingsCard>
        </div>
        </SectionGroup>

        {/* ── Configuration ── */}
        <SectionGroup title="Configuration">
        {/* Runtime Card */}
        <div id={settingsSectionElementID('runtime')} class="scroll-mt-6">
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
        </div>

        {/* Logging Card */}
        <div id={settingsSectionElementID('logging')} class="scroll-mt-6">
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
        </div>

        {/* Codespaces Card */}
        <div id={settingsSectionElementID('codespaces')} class="scroll-mt-6">
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
              <div class="flex flex-col items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:gap-4">
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
        </div>
        </SectionGroup>

        {/* ── Security & AI ── */}
        <SectionGroup title="Security & AI">
        {/* Permission Policy Card */}
        <div id={settingsSectionElementID('permission_policy')} class="scroll-mt-6">
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
              <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/40 border border-border">
                <span class="text-xs text-muted-foreground">schema_version</span>
                <CodeBadge>1</CodeBadge>
              </div>

              {/* Local max */}
              <div class="space-y-3">
                <SubSectionHeader title="local_max" description="Global permission ceiling for this agent. User and app rules are clamped to these limits." />
                <div class="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border">
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
                  <div class="w-px h-4 bg-border" />
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
                  <div class="w-px h-4 bg-border" />
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
              </div>

              {/* by_user */}
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

                <Show when={policyByUser().length > 0} fallback={<p class="text-xs text-muted-foreground italic">No user-specific overrides.</p>}>
                  <div class="space-y-2">
                    <For each={policyByUser()}>
                      {(row, idx) => (
                        <div class="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-border bg-muted/20">
                          <div class="flex-1 min-w-0">
                            <Input
                              value={row.key}
                              onInput={(e) => {
                                const v = e.currentTarget.value;
                                setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, key: v } : it)));
                                setPolicyDirty(true);
                              }}
                              placeholder="user_public_id"
                              size="sm"
                              class="w-full font-mono text-xs"
                              disabled={!canInteract()}
                            />
                          </div>
                          <div class="flex items-center gap-3">
                            <Checkbox
                              checked={row.read}
                              onChange={(v) => {
                                setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, read: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalRead()}
                              label="R"
                              size="sm"
                            />
                            <Checkbox
                              checked={row.write}
                              onChange={(v) => {
                                setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, write: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalWrite()}
                              label="W"
                              size="sm"
                            />
                            <Checkbox
                              checked={row.execute}
                              onChange={(v) => {
                                setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, execute: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalExecute()}
                              label="X"
                              size="sm"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              class="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                              onClick={() => {
                                setPolicyByUser((prev) => prev.filter((_, i) => i !== idx()));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract()}
                            >
                              &times;
                            </Button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              {/* by_app */}
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

                <Show when={policyByApp().length > 0} fallback={<p class="text-xs text-muted-foreground italic">No app-specific overrides.</p>}>
                  <div class="space-y-2">
                    <For each={policyByApp()}>
                      {(row, idx) => (
                        <div class="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-border bg-muted/20">
                          <div class="flex-1 min-w-0">
                            <Input
                              value={row.key}
                              onInput={(e) => {
                                const v = e.currentTarget.value;
                                setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, key: v } : it)));
                                setPolicyDirty(true);
                              }}
                              placeholder="floe_app identifier"
                              size="sm"
                              class="w-full font-mono text-xs"
                              disabled={!canInteract()}
                            />
                          </div>
                          <div class="flex items-center gap-3">
                            <Checkbox
                              checked={row.read}
                              onChange={(v) => {
                                setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, read: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalRead()}
                              label="R"
                              size="sm"
                            />
                            <Checkbox
                              checked={row.write}
                              onChange={(v) => {
                                setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, write: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalWrite()}
                              label="W"
                              size="sm"
                            />
                            <Checkbox
                              checked={row.execute}
                              onChange={(v) => {
                                setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, execute: v } : it)));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract() || !policyLocalExecute()}
                              label="X"
                              size="sm"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              class="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                              onClick={() => {
                                setPolicyByApp((prev) => prev.filter((_, i) => i !== idx()));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract()}
                            >
                              &times;
                            </Button>
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
        </div>

        {/* Flower Card */}
        <div id={settingsSectionElementID('ai')} class="scroll-mt-6">
          <SettingsCard
            icon={FlowerIcon}
            title="Flower"
            description="Configure Flower: providers, models, and API keys. Keys are stored locally and never sent to the control-plane. Model selection is stored per chat thread."
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
                    Disable Flower
                  </Button>
                </Show>
                <Button size="sm" variant="default" onClick={() => void saveAI()} loading={aiSaving()} disabled={!canInteract()}>
                  {aiEnabled() ? 'Save' : 'Enable Flower'}
                </Button>
              </>
            }
          >
            <Show when={!aiEnabled() && !settings.loading && !settings.error}>
              <div class="flex items-center gap-3 p-4 rounded-lg bg-muted/30 border border-border">
                <Zap class="w-5 h-5 text-muted-foreground" />
                <div class="text-sm text-muted-foreground">
                  Flower is currently disabled. Configure the settings below and click <strong>Enable Flower</strong> to activate.
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
              <div class="space-y-8">
                {/* Execution policy */}
                <div class="space-y-3">
                  <SubSectionHeader
                    title="Execution policy"
                    description="Runtime guardrails for approvals, plan-mode blocking, and dangerous commands."
                  />
                  <div class="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
                    <Checkbox
                      checked={aiRequireUserApproval()}
                      onChange={(v) => {
                        setAiRequireUserApproval(v);
                        setAiDirty(true);
                      }}
                      disabled={!canInteract()}
                      label="Require user approval for mutating tools"
                      size="sm"
                    />
                    <Checkbox
                      checked={aiEnforcePlanModeGuard()}
                      onChange={(v) => {
                        setAiEnforcePlanModeGuard(v);
                        setAiDirty(true);
                      }}
                      disabled={!canInteract()}
                      label="Enforce plan mode guard (block mutating tools in plan mode)"
                      size="sm"
                    />
                    <Checkbox
                      checked={aiBlockDangerousCommands()}
                      onChange={(v) => {
                        setAiBlockDangerousCommands(v);
                        setAiDirty(true);
                      }}
                      disabled={!canInteract()}
                      label="Block dangerous terminal commands"
                      size="sm"
                    />
                  </div>
                  <Show when={!aiBlockDangerousCommands()}>
                    <div class="flex items-start gap-2.5 p-3 rounded-lg border border-warning/50 bg-warning/10">
                      <Shield class="w-4 h-4 mt-0.5 text-warning shrink-0" />
                      <div class="text-xs font-medium text-foreground">
                        Dangerous command blocking is disabled. The agent may execute high-risk commands directly.
                      </div>
                    </div>
                  </Show>
                </div>

                {/* Web search */}
                <div class="space-y-3">
                  <SubSectionHeader
                    title="Web search"
                    description="Search backend for the runtime. Sources and citations are collected per request."
                  />
                  <div class="space-y-4 p-4 rounded-lg border border-border bg-muted/20">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <FieldLabel>provider</FieldLabel>
                        <Select
                          value={aiWebSearchProvider()}
                          onChange={(v) => {
                            setAiWebSearchProvider(normalizeWebSearchProvider(v));
                            setAiDirty(true);
                          }}
                          disabled={!canInteract()}
                          options={[
                            { value: 'prefer_openai', label: 'prefer_openai (recommended)' },
                            { value: 'brave', label: 'brave' },
                            { value: 'disabled', label: 'disabled' },
                          ]}
                          class="w-full"
                        />
                        <p class="text-xs text-muted-foreground mt-1">
                          prefer_openai prefers OpenAI built-in web search when using the official OpenAI base_url; otherwise it falls back to Brave.
                        </p>
                      </div>
                    </div>

                    <Show when={aiWebSearchProvider() === 'prefer_openai' || aiWebSearchProvider() === 'brave'}>
                      <div class="space-y-2">
                        <FieldLabel hint="stored locally, never shown again">brave_api_key</FieldLabel>
                        <div class="flex flex-col sm:flex-row sm:items-center gap-2">
                          <div
                            class={
                              'text-xs px-2 py-1 rounded-md border ' +
                              (webSearchKeySet()?.brave
                                ? 'bg-success/10 border-success/50 text-success'
                                : 'bg-muted/40 border-border text-muted-foreground')
                            }
                          >
                            {webSearchKeySet()?.brave ? 'Key set' : 'Key not set'}
                          </div>
                          <Input
                            type="password"
                            value={webSearchKeyDraft()?.brave ?? ''}
                            onInput={(e) => {
                              const v = e.currentTarget.value;
                              setWebSearchKeyDraft((prev) => ({ ...prev, brave: v }));
                            }}
                            placeholder="Paste Brave API key"
                            size="sm"
                            class="w-full"
                            disabled={!canInteract() || !canAdmin()}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveWebSearchKey('brave')}
                            loading={!!webSearchKeySaving()?.brave}
                            disabled={!canInteract() || !canAdmin()}
                          >
                            Save key
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            class="text-muted-foreground hover:text-destructive"
                            onClick={() => clearWebSearchKey('brave')}
                            disabled={!canInteract() || !canAdmin()}
                          >
                            Clear
                          </Button>
                        </div>
                        <p class="text-xs text-muted-foreground">
                          Keys are saved in a separate local secrets file and are never written to config.json. You may also set{' '}
                          <span class="font-mono">REDEVEN_BRAVE_API_KEY</span>. The same key is used by <span class="font-mono">redeven search</span>.
                        </p>
                      </div>
                    </Show>
                  </div>
                </div>

                {/* Providers */}
                <div class="space-y-3">
                  <SubSectionHeader
                    title="Providers"
                    description="Exactly one model across all providers must be default. Each chat thread stores its selected model."
                    actions={
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const id = newProviderID();
                          setAiProviders((prev) =>
                            normalizeAIProviders([
                              ...prev,
                              {
                                id,
                                name: '',
                                type: 'openai',
                                base_url: 'https://api.openai.com/v1',
                                models: [{ model_name: '', is_default: false }],
                              },
                            ]),
                          );
                          setAiDirty(true);
                        }}
                        disabled={!canInteract()}
                      >
                        Add Provider
                      </Button>
                    }
                  />

                  <div class="space-y-4">
                    <Index each={aiProviders()}>
                      {(p, idx) => (
                        <div class="rounded-lg border border-border overflow-hidden">
                          {/* Provider header */}
                          <div class="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border">
                            <div class="flex items-center gap-2">
                              <Layers class="w-3.5 h-3.5 text-muted-foreground" />
                              <span class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Provider {idx + 1}</span>
                              <Show when={p().name}>
                                <span class="text-xs text-foreground font-medium">&mdash; {p().name}</span>
                              </Show>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                              onClick={() => {
                                setAiProviders((prev) => normalizeAIProviders(prev.filter((_, i) => i !== idx)));
                                setAiDirty(true);
                              }}
                              disabled={!canInteract() || aiProviders().length <= 1}
                            >
                              Remove
                            </Button>
                          </div>

                          <div class="p-4 space-y-4">
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
	                                      ? 'bg-success/10 border-success/50 text-success'
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
		                                Keys are saved in a separate local secrets file and are never written to config.json. The Go AI runtime resolves them per run.
		                              </p>
		                            </div>

                                <div class="md:col-span-2 space-y-3">
                                  <SubSectionHeader
                                    title="Models"
                                    description="Shown in Flower Chat. Mark one model as default."
                                    actions={
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setAiProviders((prev) =>
                                            normalizeAIProviders(
                                              prev.map((it, i) => {
                                                if (i !== idx) return it;
                                                const models = Array.isArray(it.models) ? it.models : [];
                                                return { ...it, models: [...models, { model_name: '', is_default: false }] };
                                              }),
                                            ),
                                          );
                                          setAiDirty(true);
                                        }}
                                        disabled={!canInteract()}
                                      >
                                        Add Model
                                      </Button>
                                    }
                                  />

                                  <div class="space-y-2">
                                    <Index each={p().models}>
                                      {(m, midx) => (
                                        <div class="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-border bg-background">
                                          <div class="flex-1 min-w-0">
                                            <Input
                                              value={m().model_name}
                                              onInput={(e) => {
                                                const v = e.currentTarget.value;
                                                setAiProviders((prev) =>
                                                  prev.map((it, i) =>
                                                    i !== idx
                                                      ? it
                                                      : {
                                                          ...it,
                                                          models: (Array.isArray(it.models) ? it.models : []).map((mm, j) =>
                                                            j === midx ? { ...mm, model_name: v } : mm,
                                                          ),
                                                        },
                                                  ),
                                                );
                                                setAiDirty(true);
                                              }}
                                              placeholder="model_name"
                                              size="sm"
                                              class="w-full font-mono text-xs"
                                              disabled={!canInteract()}
                                            />
                                          </div>
                                          <div class="flex items-center gap-2 flex-shrink-0">
                                            <Show
                                              when={m().is_default}
                                              fallback={
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  class="h-6 px-2 text-[11px]"
                                                  onClick={() => {
                                                    setAiProviders((prev) =>
                                                      normalizeAIProviders(
                                                        prev.map((it, i) => ({
                                                          ...it,
                                                          models: (Array.isArray(it.models) ? it.models : []).map((mm, j) => ({
                                                            ...mm,
                                                            is_default: i === idx && j === midx,
                                                          })),
                                                        })),
                                                      ),
                                                    );
                                                    setAiDirty(true);
                                                  }}
                                                  disabled={!canInteract()}
                                                >
                                                  Set default
                                                </Button>
                                              }
                                            >
                                              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                                                Default
                                              </span>
                                            </Show>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              class="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                                              onClick={() => {
                                                setAiProviders((prev) =>
                                                  normalizeAIProviders(
                                                    prev.map((it, i) => {
                                                      if (i !== idx) return it;
                                                      const models = (Array.isArray(it.models) ? it.models : []).filter((_, j) => j !== midx);
                                                      return { ...it, models: models.length > 0 ? models : [{ model_name: '', is_default: false }] };
                                                    }),
                                                  ),
                                                );
                                                setAiDirty(true);
                                              }}
                                              disabled={!canInteract() || (p().models?.length ?? 0) <= 1}
                                            >
                                              &times;
                                            </Button>
                                          </div>
                                          <Show when={m().model_name}>
                                            <div class="text-[10px] text-muted-foreground font-mono sm:hidden">
                                              {modelID(p().id, m().model_name)}
                                            </div>
                                          </Show>
                                        </div>
                                      )}
                                    </Index>
                                  </div>
                                </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </Index>
                  </div>
                </div>

	              </div>
            </Show>
          </SettingsCard>
        </div>
        </SectionGroup>
          </div>
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
          <p class="text-xs text-muted-foreground">
            Target version: <span class="font-mono">{targetUpgradeVersion() || '—'}</span>
          </p>
          <Show when={targetUpgradeVersion() && !targetUpgradeVersionValid()}>
            <p class="text-xs text-destructive">Target version is invalid. Please use a release tag like v1.2.3.</p>
          </Show>
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
