import path from 'node:path';

import { loadAttachableRuntimeState } from './runtimeState';
import type { StartupReport } from './startup';
import type { DesktopPreferences } from './desktopPreferences';
import type { DesktopSessionSummary } from './desktopTarget';
import type {
  DesktopLocalEnvironmentState,
  DesktopLocalEnvironmentRuntimeState,
} from '../shared/desktopLocalEnvironmentState';
import { normalizeRuntimeServiceSnapshot, type RuntimeServiceOwner } from '../shared/runtimeService';

const DEFAULT_WELCOME_RUNTIME_PROBE_TIMEOUT_MS = 200;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function runtimeStateFromStartup(
  startup: StartupReport,
  desktopManaged: boolean,
  localUIURLOverride?: string,
  serviceOwner?: RuntimeServiceOwner,
): DesktopLocalEnvironmentRuntimeState | undefined {
  const localUIURL = compact(localUIURLOverride) || compact(startup.local_ui_url);
  if (localUIURL === '') {
    return undefined;
  }
  const pid = Number(startup.pid);
  const serviceDesktopManaged = startup.runtime_service?.desktop_managed ?? desktopManaged;
  return {
    local_ui_url: localUIURL,
    effective_run_mode: compact(startup.effective_run_mode),
    remote_enabled: startup.remote_enabled === true,
    desktop_managed: desktopManaged,
    controlplane_base_url: compact(startup.controlplane_base_url) || undefined,
    controlplane_provider_id: compact(startup.controlplane_provider_id) || undefined,
    env_public_id: compact(startup.env_public_id) || undefined,
    password_required: startup.password_required === true,
    diagnostics_enabled: startup.diagnostics_enabled === true,
    pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
    runtime_service: normalizeRuntimeServiceSnapshot(startup.runtime_service ?? { service_owner: serviceOwner }, {
      desktopManaged: serviceDesktopManaged,
      effectiveRunMode: startup.effective_run_mode,
      remoteEnabled: startup.remote_enabled === true,
    }),
  };
}

function localManagedSessionByEnvironmentID(
  openSessions: readonly DesktopSessionSummary[],
): ReadonlyMap<string, DesktopSessionSummary> {
  return new Map(
    openSessions.flatMap((session) => (
      session.target.kind === 'managed_environment' && session.target.route === 'local_host'
        ? [[session.target.environment_id, session] as const]
        : []
    )),
  );
}

function currentRuntimeFromLocalSession(
  session: DesktopSessionSummary | null | undefined,
): DesktopLocalEnvironmentRuntimeState | undefined {
  if (
    !session
    || session.target.kind !== 'managed_environment'
    || session.target.route !== 'local_host'
    || !session.startup
  ) {
    return undefined;
  }
  return runtimeStateFromStartup(
    session.startup,
    session.runtime_lifecycle_owner === 'desktop' || session.startup.desktop_managed === true,
    session.entry_url,
    session.runtime_lifecycle_owner,
  );
}

async function currentRuntimeFromProbeStateDir(
  stateDir: string,
  probeTimeoutMs: number,
): Promise<DesktopLocalEnvironmentRuntimeState | undefined> {
  const cleanStateDir = compact(stateDir);
  if (cleanStateDir === '') {
    return undefined;
  }
  const startup = await loadAttachableRuntimeState(
    path.join(cleanStateDir, 'runtime', 'local-ui.json'),
    probeTimeoutMs,
  );
  if (!startup) {
    return undefined;
  }
  return runtimeStateFromStartup(startup, startup.desktop_managed === true);
}

async function currentRuntimeFromProbe(
  environment: DesktopLocalEnvironmentState,
  probeTimeoutMs: number,
): Promise<DesktopLocalEnvironmentRuntimeState | undefined> {
  return currentRuntimeFromProbeStateDir(environment.local_hosting?.state_dir ?? '', probeTimeoutMs);
}

function withCurrentRuntime(
  environment: DesktopLocalEnvironmentState,
  currentRuntime: DesktopLocalEnvironmentRuntimeState | undefined,
): DesktopLocalEnvironmentState {
  if (!environment.local_hosting) {
    return environment;
  }
  const existingRuntime = environment.local_hosting.current_runtime;
  const existingURL = compact(existingRuntime?.local_ui_url);
  const nextURL = compact(currentRuntime?.local_ui_url);
  if (
    existingURL === nextURL
    && (existingRuntime?.desktop_managed ?? false) === (currentRuntime?.desktop_managed ?? false)
    && (existingRuntime?.controlplane_base_url ?? '') === (currentRuntime?.controlplane_base_url ?? '')
    && (existingRuntime?.controlplane_provider_id ?? '') === (currentRuntime?.controlplane_provider_id ?? '')
    && (existingRuntime?.env_public_id ?? '') === (currentRuntime?.env_public_id ?? '')
    && (existingRuntime?.password_required ?? false) === (currentRuntime?.password_required ?? false)
    && (existingRuntime?.effective_run_mode ?? '') === (currentRuntime?.effective_run_mode ?? '')
    && (existingRuntime?.remote_enabled ?? false) === (currentRuntime?.remote_enabled ?? false)
    && (existingRuntime?.diagnostics_enabled ?? false) === (currentRuntime?.diagnostics_enabled ?? false)
    && (existingRuntime?.pid ?? 0) === (currentRuntime?.pid ?? 0)
    && JSON.stringify(existingRuntime?.runtime_service ?? null) === JSON.stringify(currentRuntime?.runtime_service ?? null)
  ) {
    return environment;
  }
  return {
    ...environment,
    local_hosting: {
      ...environment.local_hosting,
      current_runtime: currentRuntime,
    },
  };
}

export async function hydrateWelcomeManagedEnvironmentRuntimeState(
  preferences: DesktopPreferences,
  openSessions: readonly DesktopSessionSummary[],
  options: Readonly<{
    probeTimeoutMs?: number;
  }> = {},
): Promise<DesktopPreferences> {
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_WELCOME_RUNTIME_PROBE_TIMEOUT_MS;
  const localSessionsByEnvironmentID = localManagedSessionByEnvironmentID(openSessions);
  const localEnvironment = preferences.local_environment;
  const currentRuntime = currentRuntimeFromLocalSession(localSessionsByEnvironmentID.get(localEnvironment.id))
    ?? await currentRuntimeFromProbe(localEnvironment, probeTimeoutMs);
  return {
    ...preferences,
    local_environment: withCurrentRuntime(localEnvironment, currentRuntime),
  };
}
