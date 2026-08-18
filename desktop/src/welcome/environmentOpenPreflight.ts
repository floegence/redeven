import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
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
