import type { DesktopPreferences } from './desktopPreferences';

export const ENV_TOKEN_ENV_NAME = 'REDEVEN_DESKTOP_ENV_TOKEN';
export const BOOTSTRAP_TICKET_ENV_NAME = 'REDEVEN_DESKTOP_BOOTSTRAP_TICKET';

export type DesktopAgentBootstrap = Readonly<
  | {
      kind: 'env_token';
      controlplane_url: string;
      env_id: string;
      env_token: string;
    }
  | {
      kind: 'bootstrap_ticket';
      controlplane_url: string;
      env_id: string;
      bootstrap_ticket: string;
    }
>;

export type DesktopAgentSpawnPlan = Readonly<{
  args: string[];
  env: NodeJS.ProcessEnv;
  password_stdin: string;
  uses_pending_bootstrap: boolean;
}>;

type BuildDesktopAgentArgsOptions = Readonly<{
  localUIBind?: string;
  bootstrap?: DesktopAgentBootstrap | null;
}>;

function pendingBootstrapToAgentBootstrap(preferences: DesktopPreferences): DesktopAgentBootstrap | null {
  const pendingBootstrap = preferences.pending_bootstrap;
  if (!pendingBootstrap) {
    return null;
  }
  return {
    kind: 'env_token',
    controlplane_url: pendingBootstrap.controlplane_url,
    env_id: pendingBootstrap.env_id,
    env_token: pendingBootstrap.env_token,
  };
}

function resolvedAgentBootstrap(
  preferences: DesktopPreferences,
  bootstrap: DesktopAgentBootstrap | null | undefined,
): DesktopAgentBootstrap | null {
  return bootstrap ?? pendingBootstrapToAgentBootstrap(preferences);
}

export function buildDesktopAgentArgs(preferences: DesktopPreferences, options?: BuildDesktopAgentArgsOptions): string[] {
  const localUIBind = String(options?.localUIBind ?? preferences.local_ui_bind).trim() || preferences.local_ui_bind;
  const args = [
    'run',
    '--mode',
    'desktop',
    '--desktop-managed',
    '--local-ui-bind',
    localUIBind,
  ];

  if (String(preferences.local_ui_password ?? '') !== '') {
    args.push('--password-stdin');
  }

  const bootstrap = resolvedAgentBootstrap(preferences, options?.bootstrap);
  if (bootstrap) {
    args.push('--controlplane', bootstrap.controlplane_url, '--env-id', bootstrap.env_id);
    if (bootstrap.kind === 'bootstrap_ticket') {
      args.push('--bootstrap-ticket-env', BOOTSTRAP_TICKET_ENV_NAME);
    } else {
      args.push('--env-token-env', ENV_TOKEN_ENV_NAME);
    }
  }

  return args;
}

export function buildDesktopAgentEnvironment(
  preferences: DesktopPreferences,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{ bootstrap?: DesktopAgentBootstrap | null }>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
  };

  const bootstrap = resolvedAgentBootstrap(preferences, options?.bootstrap);
  if (bootstrap?.kind === 'bootstrap_ticket') {
    env[BOOTSTRAP_TICKET_ENV_NAME] = bootstrap.bootstrap_ticket;
    delete env[ENV_TOKEN_ENV_NAME];
  } else if (bootstrap?.kind === 'env_token') {
    env[ENV_TOKEN_ENV_NAME] = bootstrap.env_token;
    delete env[BOOTSTRAP_TICKET_ENV_NAME];
  } else {
    delete env[ENV_TOKEN_ENV_NAME];
    delete env[BOOTSTRAP_TICKET_ENV_NAME];
  }

  return env;
}

export function buildDesktopAgentSpawnPlan(
  startupReportFile: string,
  preferences: DesktopPreferences,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{ bootstrap?: DesktopAgentBootstrap | null }>,
): DesktopAgentSpawnPlan {
  const args = buildDesktopAgentArgs(preferences, { bootstrap: options?.bootstrap });
  const env = buildDesktopAgentEnvironment(preferences, baseEnv, { bootstrap: options?.bootstrap });
  const usesPendingBootstrap = preferences.pending_bootstrap !== null;
  const passwordStdin = String(preferences.local_ui_password ?? '');
  args.push('--startup-report-file', startupReportFile);
  return {
    args,
    env,
    password_stdin: passwordStdin,
    uses_pending_bootstrap: usesPendingBootstrap,
  };
}
