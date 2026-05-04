import {
  managedEnvironmentLocalAccess,
  type DesktopManagedEnvironment,
} from '../shared/desktopManagedEnvironment';
import {
  defaultManagedStateLayout,
  type DesktopManagedStateLayout,
} from './statePaths';

export const BOOTSTRAP_TICKET_ENV_NAME = 'REDEVEN_DESKTOP_BOOTSTRAP_TICKET';

export type DesktopRuntimeBootstrap = Readonly<
  {
    kind: 'bootstrap_ticket';
    controlplane_url: string;
    env_id: string;
    bootstrap_ticket: string;
  }
>;

export type DesktopRuntimeSpawnPlan = Readonly<{
  args: string[];
  env: NodeJS.ProcessEnv;
  password_stdin: string;
  state_layout: DesktopManagedStateLayout;
}>;

export type DesktopRuntimeLaunchPlan = DesktopRuntimeSpawnPlan;

type BuildDesktopRuntimeArgsOptions = Readonly<{
  localUIBind?: string;
  bootstrap?: DesktopRuntimeBootstrap | null;
  configPath?: string;
}>;

function resolvedRuntimeBootstrap(
  bootstrap: DesktopRuntimeBootstrap | null | undefined,
): DesktopRuntimeBootstrap | null {
  return bootstrap ?? null;
}

export function buildDesktopRuntimeArgs(
  environment: DesktopManagedEnvironment,
  options: BuildDesktopRuntimeArgsOptions = {},
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

  const bootstrap = resolvedRuntimeBootstrap(options.bootstrap);
  if (bootstrap) {
    const controlPlaneURL = bootstrap.controlplane_url;
    const envID = bootstrap.env_id;
    if (controlPlaneURL !== '' && envID !== '') {
      args.push(
        '--controlplane',
        controlPlaneURL,
        '--env-id',
        envID,
        '--bootstrap-ticket-env',
        BOOTSTRAP_TICKET_ENV_NAME,
      );
    }
  }

  return args;
}

export function buildDesktopRuntimeEnvironment(
  _environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{ bootstrap?: DesktopRuntimeBootstrap | null }>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
  };

  const bootstrap = resolvedRuntimeBootstrap(options?.bootstrap);
  if (bootstrap) {
    env[BOOTSTRAP_TICKET_ENV_NAME] = bootstrap.bootstrap_ticket;
  } else {
    delete env[BOOTSTRAP_TICKET_ENV_NAME];
  }

  return env;
}

function buildDesktopRuntimePlan(
  environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopRuntimeBootstrap | null;
  }>,
): DesktopRuntimeLaunchPlan {
  const stateLayout = resolveDesktopManagedStateLayout(environment, baseEnv);
  const env = buildDesktopRuntimeEnvironment(environment, baseEnv, { bootstrap: options?.bootstrap });
  const args = buildDesktopRuntimeArgs(environment, {
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

export function buildDesktopRuntimeLaunchPlan(
  environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopRuntimeBootstrap | null;
  }>,
): DesktopRuntimeLaunchPlan {
  return buildDesktopRuntimePlan(environment, baseEnv, options);
}

export function buildDesktopRuntimeSpawnPlan(
  startupReportFile: string,
  environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopRuntimeBootstrap | null;
  }>,
): DesktopRuntimeSpawnPlan {
  const launchPlan = buildDesktopRuntimeLaunchPlan(environment, baseEnv, options);
  return {
    ...launchPlan,
    args: [...launchPlan.args, '--startup-report-file', startupReportFile],
  };
}

export function resolveDesktopManagedStateLayout(
  _environment: DesktopManagedEnvironment,
  baseEnv: NodeJS.ProcessEnv = process.env,
): DesktopManagedStateLayout {
  return defaultManagedStateLayout(baseEnv);
}
