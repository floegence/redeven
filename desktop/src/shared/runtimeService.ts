export type RuntimeServiceOwner = 'desktop' | 'external' | 'unknown';

export type RuntimeServiceCompatibility =
  | 'compatible'
  | 'update_available'
  | 'restart_recommended'
  | 'update_required'
  | 'desktop_update_required'
  | 'managed_elsewhere'
  | 'unknown';

export type RuntimeServiceOpenReadinessState = 'starting' | 'openable' | 'blocked';

export type RuntimeServiceOpenReadiness = Readonly<{
  state: RuntimeServiceOpenReadinessState;
  reason_code?: string;
  message?: string;
}>;

export type RuntimeServiceWorkload = Readonly<{
  terminal_count: number;
  session_count: number;
  task_count: number;
  port_forward_count: number;
}>;

export type RuntimeServiceCapability = Readonly<{
  supported: boolean;
  bind_method?: string;
  reason_code?: string;
  message?: string;
}>;

export type RuntimeServiceCapabilities = Readonly<{
  desktop_ai_broker: RuntimeServiceCapability;
  provider_link: RuntimeServiceCapability;
}>;

export type RuntimeServiceBindingState = 'unbound' | 'bound' | 'unsupported' | 'error' | 'expired';

export type RuntimeServiceBinding = Readonly<{
  state: RuntimeServiceBindingState;
  session_id?: string;
  ssh_runtime_key?: string;
  expires_at_unix_ms?: number;
  model_source?: string;
  model_count?: number;
  missing_key_provider_ids?: string[];
  last_error?: string;
}>;

export type RuntimeServiceBindings = Readonly<{
  desktop_ai_broker: RuntimeServiceBinding;
  provider_link: RuntimeServiceProviderLinkBinding;
}>;

export type RuntimeServiceProviderLinkState =
  | 'unbound'
  | 'linking'
  | 'linked'
  | 'disconnecting'
  | 'unsupported'
  | 'error';

export type RuntimeServiceProviderLinkBinding = Readonly<{
  state: RuntimeServiceProviderLinkState;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  local_environment_public_id?: string;
  binding_generation?: number;
  remote_enabled: boolean;
  last_connected_at_unix_ms?: number;
  last_disconnected_at_unix_ms?: number;
  last_error_code?: string;
  last_error_message?: string;
}>;

export type RuntimeServiceSnapshot = Readonly<{
  runtime_version?: string;
  runtime_commit?: string;
  runtime_build_time?: string;
  protocol_version?: string;
  compatibility_epoch?: number;
  service_owner: RuntimeServiceOwner;
  desktop_managed: boolean;
  effective_run_mode?: string;
  remote_enabled: boolean;
  compatibility: RuntimeServiceCompatibility;
  compatibility_message?: string;
  minimum_desktop_version?: string;
  minimum_runtime_version?: string;
  compatibility_review_id?: string;
  open_readiness?: RuntimeServiceOpenReadiness;
  active_workload: RuntimeServiceWorkload;
  capabilities?: RuntimeServiceCapabilities;
  bindings?: RuntimeServiceBindings;
}>;

export type RuntimeServiceIdentity = Readonly<{
  runtime_version?: string;
  runtime_commit?: string;
  runtime_build_time?: string;
}>;

export const RUNTIME_SERVICE_PROTOCOL_VERSION = 'redeven-runtime-v1';
export const RUNTIME_SERVICE_ENV_APP_SHELL_UNAVAILABLE_REASON = 'env_app_shell_unavailable';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.floor(n));
}

function normalizeOwner(value: unknown, desktopManaged: boolean): RuntimeServiceOwner {
  const owner = compact(value);
  if (owner === 'desktop' || owner === 'external' || owner === 'unknown') {
    return owner;
  }
  return desktopManaged ? 'desktop' : 'unknown';
}

function normalizeCompatibility(value: unknown): RuntimeServiceCompatibility {
  const compatibility = compact(value);
  switch (compatibility) {
    case 'compatible':
    case 'update_available':
    case 'restart_recommended':
    case 'update_required':
    case 'desktop_update_required':
    case 'managed_elsewhere':
    case 'unknown':
      return compatibility;
    default:
      return 'unknown';
  }
}

function openReadinessFromCompatibility(
  compatibility: RuntimeServiceCompatibility,
  compatibilityMessage: string | undefined,
): RuntimeServiceOpenReadiness {
  switch (compatibility) {
    case 'update_required':
      return {
        state: 'blocked',
        reason_code: 'runtime_update_required',
        message: compatibilityMessage || 'Update the runtime before opening this environment.',
      };
    case 'desktop_update_required':
      return {
        state: 'blocked',
        reason_code: 'desktop_update_required',
        message: compatibilityMessage || 'Update Desktop before opening this environment.',
      };
    case 'managed_elsewhere':
      return {
        state: 'blocked',
        reason_code: 'runtime_managed_elsewhere',
        message: compatibilityMessage || 'This runtime is managed by another Desktop instance.',
      };
    default:
      return { state: 'openable' };
  }
}

function missingOpenReadinessFromCompatibility(
  compatibility: RuntimeServiceCompatibility,
  compatibilityMessage: string | undefined,
): RuntimeServiceOpenReadiness {
  const inferred = openReadinessFromCompatibility(compatibility, compatibilityMessage);
  if (inferred.state === 'blocked') {
    return inferred;
  }
  return {
    state: 'blocked',
    reason_code: 'runtime_open_readiness_unavailable',
    message: 'This running runtime is older than this Desktop. Install the update, then restart the runtime when it is safe to interrupt active work.',
  };
}

export function envAppShellUnavailableOpenReadiness(): RuntimeServiceOpenReadiness {
  return {
    state: 'blocked',
    reason_code: RUNTIME_SERVICE_ENV_APP_SHELL_UNAVAILABLE_REASON,
    message: 'The Environment App shell is not available in this runtime build. Install the update, then restart the runtime when it is safe to interrupt active work.',
  };
}

function normalizeOpenReadiness(
  value: unknown,
  compatibility: RuntimeServiceCompatibility,
  compatibilityMessage: string | undefined,
): RuntimeServiceOpenReadiness {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const state = compact(record.state);
  if (state === 'openable') {
    return { state: 'openable' };
  }
  if (state === 'starting' || state === 'blocked') {
    return {
      state,
      reason_code: compact(record.reason_code) || (
        state === 'starting' ? 'runtime_service_starting' : 'runtime_service_blocked'
      ),
      message: compact(record.message) || undefined,
    };
  }
  return missingOpenReadinessFromCompatibility(compatibility, compatibilityMessage);
}

function normalizeCapability(value: unknown): RuntimeServiceCapability {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const supported = record.supported === true;
  const bindMethod = compact(record.bind_method);
  return {
    supported,
    bind_method: supported ? (bindMethod || 'runtime_control_v1') : undefined,
    reason_code: compact(record.reason_code) || undefined,
    message: compact(record.message) || undefined,
  };
}

function normalizeBinding(value: unknown, capability: RuntimeServiceCapability): RuntimeServiceBinding {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const state = compact(record.state) as RuntimeServiceBindingState;
  const missingKeyProviderIDs = Array.isArray(record.missing_key_provider_ids)
    ? Array.from(new Set(record.missing_key_provider_ids.map((item) => compact(item)).filter(Boolean))).sort()
    : [];
  const normalizedState: RuntimeServiceBindingState = capability.supported
    ? (state === 'bound' || state === 'error' || state === 'expired' || state === 'unbound' ? state : 'unbound')
    : 'unsupported';
  return {
    state: normalizedState,
    session_id: compact(record.session_id) || undefined,
    ssh_runtime_key: compact(record.ssh_runtime_key) || undefined,
    expires_at_unix_ms: normalizeCount(record.expires_at_unix_ms),
    model_source: compact(record.model_source) || undefined,
    model_count: normalizeCount(record.model_count),
    missing_key_provider_ids: missingKeyProviderIDs.length > 0 ? missingKeyProviderIDs : undefined,
    last_error: compact(record.last_error) || undefined,
  };
}

function normalizeProviderLinkBinding(
  value: unknown,
  capability: RuntimeServiceCapability,
): RuntimeServiceProviderLinkBinding {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawState = compact(record.state);
  const state: RuntimeServiceProviderLinkState = capability.supported
    ? (
        rawState === 'linked'
        || rawState === 'linking'
        || rawState === 'disconnecting'
        || rawState === 'error'
        || rawState === 'unbound'
          ? rawState
          : 'unbound'
      )
    : 'unsupported';
  return {
    state,
    provider_origin: compact(record.provider_origin) || undefined,
    provider_id: compact(record.provider_id) || undefined,
    env_public_id: compact(record.env_public_id) || undefined,
    local_environment_public_id: compact(record.local_environment_public_id) || undefined,
    binding_generation: normalizeCount(record.binding_generation) || undefined,
    remote_enabled: state === 'linked',
    last_connected_at_unix_ms: normalizeCount(record.last_connected_at_unix_ms) || undefined,
    last_disconnected_at_unix_ms: normalizeCount(record.last_disconnected_at_unix_ms) || undefined,
    last_error_code: compact(record.last_error_code) || undefined,
    last_error_message: compact(record.last_error_message) || undefined,
  };
}

export function normalizeRuntimeServiceSnapshot(
  value: unknown,
  fallback: Readonly<{
    desktopManaged?: boolean;
    effectiveRunMode?: string;
    remoteEnabled?: boolean;
  }> = {},
): RuntimeServiceSnapshot {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const workload = record.active_workload && typeof record.active_workload === 'object'
    ? record.active_workload as Record<string, unknown>
    : {};
  const capabilitiesRecord = record.capabilities && typeof record.capabilities === 'object'
    ? record.capabilities as Record<string, unknown>
    : {};
  const desktopAIBrokerCapability = normalizeCapability(capabilitiesRecord.desktop_ai_broker);
  const providerLinkCapability = normalizeCapability(capabilitiesRecord.provider_link);
  const bindingsRecord = record.bindings && typeof record.bindings === 'object'
    ? record.bindings as Record<string, unknown>
    : {};
  const desktopManaged = typeof record.desktop_managed === 'boolean'
    ? record.desktop_managed
    : fallback.desktopManaged === true;
  const compatibility = normalizeCompatibility(record.compatibility);
  const compatibilityMessage = compact(record.compatibility_message) || undefined;
  return {
    runtime_version: compact(record.runtime_version) || undefined,
    runtime_commit: compact(record.runtime_commit) || undefined,
    runtime_build_time: compact(record.runtime_build_time) || undefined,
    protocol_version: compact(record.protocol_version) || RUNTIME_SERVICE_PROTOCOL_VERSION,
    compatibility_epoch: normalizeCount(record.compatibility_epoch) || undefined,
    service_owner: normalizeOwner(record.service_owner, desktopManaged),
    desktop_managed: desktopManaged,
    effective_run_mode: compact(record.effective_run_mode) || compact(fallback.effectiveRunMode) || undefined,
    remote_enabled: typeof record.remote_enabled === 'boolean'
      ? record.remote_enabled
      : fallback.remoteEnabled === true,
    compatibility,
    compatibility_message: compatibilityMessage,
    minimum_desktop_version: compact(record.minimum_desktop_version) || undefined,
    minimum_runtime_version: compact(record.minimum_runtime_version) || undefined,
    compatibility_review_id: compact(record.compatibility_review_id) || undefined,
    open_readiness: normalizeOpenReadiness(record.open_readiness, compatibility, compatibilityMessage),
    active_workload: {
      terminal_count: normalizeCount(workload.terminal_count),
      session_count: normalizeCount(workload.session_count),
      task_count: normalizeCount(workload.task_count),
      port_forward_count: normalizeCount(workload.port_forward_count),
    },
    capabilities: {
      desktop_ai_broker: desktopAIBrokerCapability,
      provider_link: providerLinkCapability,
    },
    bindings: {
      desktop_ai_broker: normalizeBinding(bindingsRecord.desktop_ai_broker, desktopAIBrokerCapability),
      provider_link: normalizeProviderLinkBinding(bindingsRecord.provider_link, providerLinkCapability),
    },
  };
}

export function runtimeServiceIsOpenable(snapshot: RuntimeServiceSnapshot | null | undefined): boolean {
  if (!snapshot) {
    return false;
  }
  return snapshot.open_readiness?.state === 'openable';
}

export function runtimeServiceMatchesIdentity(
  snapshot: RuntimeServiceSnapshot | null | undefined,
  expected: RuntimeServiceIdentity | null | undefined,
): boolean {
  if (!expected) {
    return true;
  }
  const comparisons = [
    [snapshot?.runtime_version, expected.runtime_version],
    [snapshot?.runtime_commit, expected.runtime_commit],
    [snapshot?.runtime_build_time, expected.runtime_build_time],
  ] as const;
  return comparisons.every(([observed, wanted]) => {
    const cleanObserved = compact(observed);
    const cleanWanted = compact(wanted);
    return cleanWanted === '' || cleanObserved === cleanWanted;
  });
}

export function runtimeServiceNeedsRuntimeUpdate(snapshot: RuntimeServiceSnapshot | null | undefined): boolean {
  if (!snapshot) {
    return false;
  }
  const reasonCode = compact(snapshot.open_readiness?.reason_code);
  return snapshot.compatibility === 'update_required'
    || reasonCode === 'runtime_update_required'
    || reasonCode === 'runtime_open_readiness_unavailable'
    || reasonCode === RUNTIME_SERVICE_ENV_APP_SHELL_UNAVAILABLE_REASON;
}

export function runtimeServiceOpenReadinessLabel(snapshot: RuntimeServiceSnapshot | null | undefined): string {
  if (!snapshot) {
    return 'Runtime readiness is not available yet.';
  }
  const readiness = snapshot.open_readiness ?? missingOpenReadinessFromCompatibility(
    snapshot.compatibility,
    snapshot.compatibility_message,
  );
  if (readiness.state === 'openable') {
    return 'Runtime is ready to open.';
  }
  return compact(readiness.message) || (
    readiness.state === 'blocked'
      ? 'Runtime cannot open this environment yet.'
      : 'Runtime is preparing the environment app.'
  );
}

export function runtimeServiceHasActiveWork(snapshot: RuntimeServiceSnapshot | null | undefined): boolean {
  const workload = snapshot?.active_workload;
  if (!workload) {
    return false;
  }
  return workload.terminal_count > 0
    || workload.session_count > 0
    || workload.task_count > 0
    || workload.port_forward_count > 0;
}

export function runtimeServiceDesktopAIBrokerBindingState(snapshot: RuntimeServiceSnapshot | null | undefined): RuntimeServiceBindingState {
  const capability = snapshot?.capabilities?.desktop_ai_broker;
  if (!capability?.supported) {
    return 'unsupported';
  }
  return snapshot?.bindings?.desktop_ai_broker?.state || 'unbound';
}

export function runtimeServiceSupportsDesktopAIBrokerBinding(snapshot: RuntimeServiceSnapshot | null | undefined): boolean {
  return snapshot?.capabilities?.desktop_ai_broker?.supported === true
    && (snapshot.capabilities.desktop_ai_broker.bind_method || 'runtime_control_v1') === 'runtime_control_v1';
}

export function runtimeServiceProviderLinkBinding(
  snapshot: RuntimeServiceSnapshot | null | undefined,
): RuntimeServiceProviderLinkBinding {
  const capability = snapshot?.capabilities?.provider_link;
  return normalizeProviderLinkBinding(snapshot?.bindings?.provider_link, capability ?? { supported: false });
}

export function runtimeServiceSupportsProviderLink(snapshot: RuntimeServiceSnapshot | null | undefined): boolean {
  return snapshot?.capabilities?.provider_link?.supported === true
    && (snapshot.capabilities.provider_link.bind_method || 'runtime_control_v1') === 'runtime_control_v1';
}

export function runtimeServiceProviderLinkMatches(
  snapshot: RuntimeServiceSnapshot | null | undefined,
  expected: Readonly<{
    provider_origin?: string;
    provider_id?: string;
    env_public_id?: string;
  }> | null | undefined,
): boolean {
  const binding = runtimeServiceProviderLinkBinding(snapshot);
  return binding.state === 'linked'
    && compact(binding.provider_origin) === compact(expected?.provider_origin)
    && compact(binding.provider_id) === compact(expected?.provider_id)
    && compact(binding.env_public_id) === compact(expected?.env_public_id);
}

export function formatRuntimeServiceWorkload(snapshot: RuntimeServiceSnapshot | null | undefined): string {
  const workload = snapshot?.active_workload;
  if (!workload) {
    return 'No active work';
  }
  const parts = [
    workload.terminal_count > 0 ? `${workload.terminal_count} ${workload.terminal_count === 1 ? 'terminal' : 'terminals'}` : '',
    workload.session_count > 0 ? `${workload.session_count} ${workload.session_count === 1 ? 'session' : 'sessions'}` : '',
    workload.task_count > 0 ? `${workload.task_count} ${workload.task_count === 1 ? 'task' : 'tasks'}` : '',
    workload.port_forward_count > 0 ? `${workload.port_forward_count} ${workload.port_forward_count === 1 ? 'port forward' : 'port forwards'}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'No active work';
}
