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
    }>;

export type EnvironmentOpenAfterLifecycleResolution =
  | Readonly<{ kind: 'opened' }>
  | Readonly<{
      kind: 'failed';
      message: string;
    }>;

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
    : { kind: 'failed', message: opened.message };
}

export async function runConfirmedEnvironmentStart<Result extends Readonly<{
  ok: boolean;
  code?: string;
}>>(input: Readonly<{
  environmentID: string;
  request: DesktopLauncherActionRequest;
  perform: (request: DesktopLauncherActionRequest) => Promise<Result>;
}>): Promise<Result> {
  const result = await input.perform(input.request);
  if (result.ok || result.code !== 'confirmation_required') {
    return result;
  }
  return input.perform({
    kind: 'confirm_runtime_operation',
    operation_key: `${input.environmentID}:start`,
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
    return { kind: 'failed', message: attempt.message };
  }
  if (!latest) {
    return { kind: 'failed', message: attempt.message };
  }

  const flow = environmentOpenFlowAfterPreflight(latest);
  if (flow === 'initialize' || flow === 'start' || flow === 'request_access') {
    return { kind: 'guidance', flow, environment: latest };
  }
  return { kind: 'failed', message: attempt.message };
}
