import {
  managedEnvironmentLocalAccess,
  managedEnvironmentProviderOrigin,
  managedEnvironmentPublicID,
  type DesktopManagedEnvironment,
} from '../shared/desktopManagedEnvironment';
import {
  controlPlaneManagedStateLayout,
  localManagedStateLayout,
  namedManagedStateLayout,
  type DesktopManagedStateLayout,
} from './statePaths';

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
  bootstrap: DesktopAgentBootstrap | null | undefined,
): DesktopAgentBootstrap | null {
  return bootstrap ?? null;
}

export function buildDesktopAgentArgs(
  environment: DesktopManagedEnvironment,
  options: BuildDesktopAgentArgsOptions = {},
): string[] {
  const access = managedEnvironmentLocalAccess(environment);
  const localUIBind = String(options.localUIBind ?? access.local_ui_bind).trim() || access.local_ui_bind;
  const args = [
    'run',
    '--mode',
    'desktop',
    '--desktop-managed',
    '--local-ui-bind',
    localUIBind,
  ];
  const configPath = String(options.configPath ?? '').trim();
  if (configPath !== '') {
    args.push('--config-path', configPath);
  }

  if (access.local_ui_password_configured) {
    args.push('--password-stdin');
  }

  const bootstrap = resolvedAgentBootstrap(options.bootstrap);
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
  _environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{ bootstrap?: DesktopAgentBootstrap | null }>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
  };

  const bootstrap = resolvedAgentBootstrap(options?.bootstrap);
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
  environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopAgentBootstrap | null;
  }>,
): DesktopAgentLaunchPlan {
  const stateLayout = resolveDesktopManagedStateLayout(environment, baseEnv);
  const env = buildDesktopAgentEnvironment(environment, baseEnv, { bootstrap: options?.bootstrap });
  const args = buildDesktopAgentArgs(environment, {
    localUIBind: options?.localUIBind,
    bootstrap: options?.bootstrap,
    configPath: stateLayout.configPath,
  });
  const access = managedEnvironmentLocalAccess(environment);
  const passwordStdin = access.local_ui_password_configured
    ? String(access.local_ui_password ?? '')
    : '';
  return {
    args,
    env,
    password_stdin: passwordStdin,
    state_layout: stateLayout,
  };
}

export function buildDesktopAgentLaunchPlan(
  environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopAgentBootstrap | null;
  }>,
): DesktopAgentLaunchPlan {
  return buildDesktopAgentPlan(environment, baseEnv, options);
}

export function buildDesktopAgentSpawnPlan(
  startupReportFile: string,
  environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopAgentBootstrap | null;
  }>,
): DesktopAgentSpawnPlan {
  const launchPlan = buildDesktopAgentLaunchPlan(environment, baseEnv, options);
  return {
    ...launchPlan,
    args: [...launchPlan.args, '--startup-report-file', startupReportFile],
  };
}

export function resolveDesktopManagedStateLayout(
  environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
): DesktopManagedStateLayout {
  const scope = environment.local_hosting?.scope;
  if (scope?.kind === 'controlplane') {
    return controlPlaneManagedStateLayout(scope.provider_origin, scope.env_public_id, baseEnv);
  }
  if (scope?.kind === 'named') {
    return namedManagedStateLayout(scope.name, baseEnv);
  }
  if (scope?.kind === 'local') {
    return localManagedStateLayout(scope.name, baseEnv);
  }
  if (environment.provider_binding) {
    return controlPlaneManagedStateLayout(
      managedEnvironmentProviderOrigin(environment),
      managedEnvironmentPublicID(environment),
      baseEnv,
    );
  }
  return localManagedStateLayout('default', baseEnv);
}
