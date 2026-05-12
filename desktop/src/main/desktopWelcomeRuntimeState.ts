import path from 'node:path';

import { loadAttachableRuntimeState, loadExternalLocalUIStartup } from './runtimeState';
import type { StartupReport } from './startup';
import type { DesktopPreferences } from './desktopPreferences';
import type { DesktopSessionSummary } from './desktopTarget';
import type {
  DesktopLocalEnvironmentState,
  DesktopLocalEnvironmentRuntimeState,
} from '../shared/desktopLocalEnvironmentState';
import {
  normalizeRuntimeServiceSnapshot,
  runtimeServiceMatchesIdentity,
  type RuntimeServiceIdentity,
  type RuntimeServiceOwner,
} from '../shared/runtimeService';

const DEFAULT_WELCOME_RUNTIME_PROBE_TIMEOUT_MS = 200;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function runtimeOwnedByCurrentDesktop(startup: StartupReport, desktopOwnerID: string): boolean {
  const cleanOwnerID = compact(desktopOwnerID);
  const startupOwnerID = compact(startup.desktop_owner_id);
  return startup.desktop_managed === true && cleanOwnerID !== '' && startupOwnerID !== '' && startupOwnerID === cleanOwnerID;
}

function runtimeDesktopOwnership(startup: StartupReport, desktopOwnerID: string): DesktopLocalEnvironmentRuntimeState['desktop_ownership'] {
  if (startup.desktop_managed !== true) {
    return 'external';
  }
  if (runtimeOwnedByCurrentDesktop(startup, desktopOwnerID)) {
    return 'owned';
  }
  return compact(startup.desktop_owner_id) === '' ? 'legacy_unleased' : 'managed_elsewhere';
}

function runtimeStateFromStartup(
  startup: StartupReport,
  desktopOwnerID: string,
  expectedRuntimeIdentity: RuntimeServiceIdentity | null | undefined,
  localUIURLOverride?: string,
  serviceOwner?: RuntimeServiceOwner,
): DesktopLocalEnvironmentRuntimeState | undefined {
  const localUIURL = compact(localUIURLOverride) || compact(startup.local_ui_url);
  if (localUIURL === '') {
    return undefined;
  }
  const pid = Number(startup.pid);
  const rawDesktopManaged = startup.desktop_managed === true;
  const serviceDesktopManaged = startup.runtime_service?.desktop_managed ?? rawDesktopManaged;
  const runtimeService = normalizeRuntimeServiceSnapshot(startup.runtime_service ?? { service_owner: serviceOwner }, {
    desktopManaged: serviceDesktopManaged,
    effectiveRunMode: startup.effective_run_mode,
    remoteEnabled: startup.remote_enabled === true,
  });
  const desktopRuntimeIdentityMismatch = rawDesktopManaged
    && !runtimeServiceMatchesIdentity(runtimeService, expectedRuntimeIdentity);
  return {
    local_ui_url: localUIURL,
    effective_run_mode: compact(startup.effective_run_mode),
    remote_enabled: startup.remote_enabled === true,
    desktop_managed: rawDesktopManaged,
    desktop_owner_id: compact(startup.desktop_owner_id) || undefined,
    desktop_ownership: runtimeDesktopOwnership(startup, desktopOwnerID),
    controlplane_base_url: compact(startup.controlplane_base_url) || undefined,
    controlplane_provider_id: compact(startup.controlplane_provider_id) || undefined,
    env_public_id: compact(startup.env_public_id) || undefined,
    password_required: startup.password_required === true,
    diagnostics_enabled: startup.diagnostics_enabled === true,
    pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
    runtime_service: desktopRuntimeIdentityMismatch
      ? normalizeRuntimeServiceSnapshot({
          ...runtimeService,
          compatibility: 'update_required',
          compatibility_message: 'Desktop has a newer bundled runtime. Restart the Local Runtime before opening.',
          open_readiness: {
            state: 'blocked',
            reason_code: 'runtime_update_required',
            message: 'Desktop has a newer bundled runtime. Restart the Local Runtime before opening.',
          },
        })
      : runtimeService,
  };
}

function localManagedSessionByEnvironmentID(
  openSessions: readonly DesktopSessionSummary[],
): ReadonlyMap<string, DesktopSessionSummary> {
  return new Map(
    openSessions.flatMap((session) => (
      session.target.kind === 'local_environment' && session.target.route === 'local_host'
        ? [[session.target.environment_id, session] as const]
        : []
    )),
  );
}

async function currentRuntimeFromLocalSession(
  session: DesktopSessionSummary | null | undefined,
  probeTimeoutMs: number,
  desktopOwnerID: string,
  expectedRuntimeIdentity: RuntimeServiceIdentity | null | undefined,
): Promise<DesktopLocalEnvironmentRuntimeState | undefined> {
  if (
    !session
    || session.target.kind !== 'local_environment'
    || session.target.route !== 'local_host'
    || !session.startup
  ) {
    return undefined;
  }
  const candidateURLs = [
    session.entry_url,
    session.startup.local_ui_url,
    ...session.startup.local_ui_urls,
  ];
  const seen = new Set<string>();
  for (const candidateURL of candidateURLs) {
    const cleanURL = compact(candidateURL);
    if (cleanURL === '' || seen.has(cleanURL)) {
      continue;
    }
    seen.add(cleanURL);
    const startup = await loadExternalLocalUIStartup(cleanURL, probeTimeoutMs).catch(() => null);
    if (!startup) {
      continue;
    }
    return runtimeStateFromStartup(
      {
        ...session.startup,
        ...startup,
      },
      desktopOwnerID,
      expectedRuntimeIdentity,
      startup.local_ui_url,
      session.runtime_lifecycle_owner,
    );
  }
  return undefined;
}

async function currentRuntimeFromProbeStateDir(
  stateDir: string,
  probeTimeoutMs: number,
  desktopOwnerID: string,
  expectedRuntimeIdentity: RuntimeServiceIdentity | null | undefined,
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
  return runtimeStateFromStartup(
    startup,
    desktopOwnerID,
    expectedRuntimeIdentity,
  );
}

async function currentRuntimeFromProbe(
  environment: DesktopLocalEnvironmentState,
  probeTimeoutMs: number,
  desktopOwnerID: string,
  expectedRuntimeIdentity: RuntimeServiceIdentity | null | undefined,
): Promise<DesktopLocalEnvironmentRuntimeState | undefined> {
  return currentRuntimeFromProbeStateDir(environment.local_hosting?.state_dir ?? '', probeTimeoutMs, desktopOwnerID, expectedRuntimeIdentity);
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
    && (existingRuntime?.desktop_owner_id ?? '') === (currentRuntime?.desktop_owner_id ?? '')
    && (existingRuntime?.desktop_ownership ?? '') === (currentRuntime?.desktop_ownership ?? '')
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

export async function hydrateWelcomeLocalEnvironmentRuntimeState(
  preferences: DesktopPreferences,
  openSessions: readonly DesktopSessionSummary[],
  options: Readonly<{
    probeTimeoutMs?: number;
    desktopOwnerID?: string;
    expectedRuntimeIdentity?: RuntimeServiceIdentity | null;
  }> = {},
): Promise<DesktopPreferences> {
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_WELCOME_RUNTIME_PROBE_TIMEOUT_MS;
  const desktopOwnerID = compact(options.desktopOwnerID);
  const expectedRuntimeIdentity = options.expectedRuntimeIdentity ?? null;
  const localSessionsByEnvironmentID = localManagedSessionByEnvironmentID(openSessions);
  const localEnvironment = preferences.local_environment;
  const currentRuntime = await currentRuntimeFromLocalSession(
    localSessionsByEnvironmentID.get(localEnvironment.id),
    probeTimeoutMs,
    desktopOwnerID,
    expectedRuntimeIdentity,
  )
    ?? await currentRuntimeFromProbe(localEnvironment, probeTimeoutMs, desktopOwnerID, expectedRuntimeIdentity);
  return {
    ...preferences,
    local_environment: withCurrentRuntime(localEnvironment, currentRuntime),
  };
}
