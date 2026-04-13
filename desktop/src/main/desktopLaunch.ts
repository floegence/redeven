import type { DesktopPreferences } from './desktopPreferences';
import { controlPlaneManagedStateLayout, defaultManagedStateLayout, type DesktopManagedStateLayout } from './statePaths';

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
  state_layout: DesktopManagedStateLayout;
}>;

export type DesktopAgentLaunchPlan = DesktopAgentSpawnPlan;

type BuildDesktopAgentArgsOptions = Readonly<{
  localUIBind?: string;
  bootstrap?: DesktopAgentBootstrap | null;
  configPath?: string;
}>;

function resolvedAgentBootstrap(
  _preferences: DesktopPreferences,
  bootstrap: DesktopAgentBootstrap | null | undefined,
): DesktopAgentBootstrap | null {
  return bootstrap ?? null;
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
  const configPath = String(options?.configPath ?? '').trim();
  if (configPath !== '') {
    args.push('--config-path', configPath);
  }

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

function buildDesktopAgentPlan(
  preferences: DesktopPreferences,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopAgentBootstrap | null;
  }>,
): DesktopAgentLaunchPlan {
  const stateLayout = resolveDesktopManagedStateLayout(preferences, baseEnv, { bootstrap: options?.bootstrap });
  const env = buildDesktopAgentEnvironment(preferences, baseEnv, { bootstrap: options?.bootstrap });
  const args = buildDesktopAgentArgs(preferences, {
    localUIBind: options?.localUIBind,
    bootstrap: options?.bootstrap,
    configPath: stateLayout.configPath,
  });
  const passwordStdin = String(preferences.local_ui_password ?? '');
  return {
    args,
    env,
    password_stdin: passwordStdin,
    state_layout: stateLayout,
  };
}

export function buildDesktopAgentLaunchPlan(
  preferences: DesktopPreferences,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopAgentBootstrap | null;
  }>,
): DesktopAgentLaunchPlan {
  return buildDesktopAgentPlan(preferences, baseEnv, options);
}

export function buildDesktopAgentSpawnPlan(
  startupReportFile: string,
  preferences: DesktopPreferences,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopAgentBootstrap | null;
  }>,
): DesktopAgentSpawnPlan {
  const launchPlan = buildDesktopAgentLaunchPlan(preferences, baseEnv, options);
  return {
    ...launchPlan,
    args: [...launchPlan.args, '--startup-report-file', startupReportFile],
  };
}

export function resolveDesktopManagedStateLayout(
  preferences: DesktopPreferences,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{ bootstrap?: DesktopAgentBootstrap | null }>,
): DesktopManagedStateLayout {
  const bootstrap = resolvedAgentBootstrap(preferences, options?.bootstrap);
  if (bootstrap) {
    return controlPlaneManagedStateLayout(bootstrap.controlplane_url, bootstrap.env_id, baseEnv);
  }
  return defaultManagedStateLayout(baseEnv);
}
