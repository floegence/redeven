import type {
  DesktopEnvironmentEntry,
  DesktopLauncherActionRequest,
} from '../shared/desktopLauncherIPC';
import {
  environmentOpenFlowAfterPreflight,
  type EnvironmentOpenFlow,
} from './viewModel';

export type EnvironmentOpenPreflightAttempt = Readonly<{
  opened: boolean;
  message: string;
  recovery?: 'update_runtime' | 'update_desktop' | 'refresh_runtime';
}>;

export type EnvironmentOpenPreflightResolution =
  | Readonly<{ kind: 'opened' }>
  | Readonly<{
      kind: 'guidance';
      flow: Extract<EnvironmentOpenFlow, 'initialize' | 'start' | 'request_access'>;
      environment: DesktopEnvironmentEntry;
    }>
  | Readonly<{
      kind: 'failed';
      message: string;
      recovery?: 'update_runtime' | 'update_desktop' | 'refresh_runtime';
    }>;

export type EnvironmentOpenAfterLifecycleResolution =
  | Readonly<{ kind: 'opened' }>
  | Readonly<{
      kind: 'failed';
      message: string;
      recovery?: 'update_runtime' | 'update_desktop' | 'refresh_runtime';
    }>;

export async function reconcileEnvironmentOpenBeforeLifecycle(input: Readonly<{
  environment: DesktopEnvironmentEntry;
  loadLatestEnvironment: (environmentID: string) => Promise<DesktopEnvironmentEntry | null>;
  refreshRuntime: (environment: DesktopEnvironmentEntry) => Promise<unknown>;
}>): Promise<Readonly<{
  environment: DesktopEnvironmentEntry;
  flow: EnvironmentOpenFlow;
}>> {
  let latest = input.environment;
  try {
    latest = await input.loadLatestEnvironment(input.environment.id) ?? latest;
  } catch {
    return {
      environment: latest,
      flow: environmentOpenFlowAfterPreflight(latest),
    };
  }
  try {
    await input.refreshRuntime(latest);
  } catch {
    // The authoritative Open path still validates readiness before starting.
  }
  try {
    latest = await input.loadLatestEnvironment(input.environment.id) ?? latest;
  } catch {
    // Keep the last observed entry when the status refresh cannot be read back.
  }
  return {
    environment: latest,
    flow: environmentOpenFlowAfterPreflight(latest),
  };
}

export async function continueEnvironmentOpenAfterLifecycle(input: Readonly<{
  environment: DesktopEnvironmentEntry;
  loadLatestEnvironment: (environmentID: string) => Promise<DesktopEnvironmentEntry | null>;
  attemptOpen: (environment: DesktopEnvironmentEntry) => Promise<EnvironmentOpenPreflightAttempt>;
}>): Promise<EnvironmentOpenAfterLifecycleResolution> {
  let environment = input.environment;
  try {
    environment = await input.loadLatestEnvironment(input.environment.id) ?? environment;
  } catch {
    // The main-process Open path performs the authoritative readiness check.
  }
  const opened = await input.attemptOpen(environment);
  return opened.opened
    ? { kind: 'opened' }
    : {
        kind: 'failed',
        message: opened.message,
        ...(opened.recovery ? { recovery: opened.recovery } : {}),
      };
}

export async function runConfirmedEnvironmentStart<Result extends Readonly<{
  ok: boolean;
  code?: string;
  operation_key?: string;
}>>(input: Readonly<{
  request: DesktopLauncherActionRequest;
  perform: (request: DesktopLauncherActionRequest) => Promise<Result>;
}>): Promise<Result> {
  const result = await input.perform(input.request);
  if (result.ok || result.code !== 'confirmation_required') {
    return result;
  }
  const operationKey = result.operation_key?.trim();
  if (!operationKey) {
    return result;
  }
  return input.perform({
    kind: 'confirm_runtime_operation',
    operation_key: operationKey,
  });
}

export async function runEnvironmentOpenPreflight(input: Readonly<{
  environment: DesktopEnvironmentEntry;
  attemptOpen: (environment: DesktopEnvironmentEntry) => Promise<EnvironmentOpenPreflightAttempt>;
  loadLatestEnvironment: (environmentID: string) => Promise<DesktopEnvironmentEntry | null>;
}>): Promise<EnvironmentOpenPreflightResolution> {
  const attempt = await input.attemptOpen(input.environment);
  if (attempt.opened) {
    return { kind: 'opened' };
  }

  let latest: DesktopEnvironmentEntry | null = null;
  try {
    latest = await input.loadLatestEnvironment(input.environment.id);
  } catch {
    return {
      kind: 'failed',
      message: attempt.message,
      ...(attempt.recovery ? { recovery: attempt.recovery } : {}),
    };
  }
  if (!latest) {
    return {
      kind: 'failed',
      message: attempt.message,
      ...(attempt.recovery ? { recovery: attempt.recovery } : {}),
    };
  }

  const flow = environmentOpenFlowAfterPreflight(latest);
  if (flow === 'initialize' || flow === 'start' || flow === 'request_access') {
    return { kind: 'guidance', flow, environment: latest };
  }
  return {
    kind: 'failed',
    message: attempt.message,
    ...(attempt.recovery ? { recovery: attempt.recovery } : {}),
  };
}
