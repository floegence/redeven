import {
  localEnvironmentAccess,
  type DesktopLocalEnvironmentState,
} from '../shared/desktopLocalEnvironmentState';
import {
  defaultLocalEnvironmentStateLayout,
  type DesktopLocalEnvironmentStateLayout,
} from './statePaths';
import { sanitizeDesktopChildEnvironment } from './desktopProcessEnvironment';
import { canonicalLocalUIBind, isLoopbackOnlyBind, parseLocalUIBind } from './localUIBind';

export const DESKTOP_OWNER_ID_ENV_NAME = 'REDEVEN_DESKTOP_OWNER_ID';
export { RUNTIME_SECRET_ENV_NAMES } from './desktopProcessEnvironment';

const STARTUP_SECRETS_MAX_BYTES = 64 * 1024;

export type DesktopRuntimeBootstrap = Readonly<
  {
    kind: 'bootstrap_ticket';
    provider_origin: string;
    controlplane_url: string;
    env_id: string;
    bootstrap_ticket: string;
  }
>;

export type DesktopRuntimeSpawnPlan = Readonly<{
  args: string[];
  env: NodeJS.ProcessEnv;
  startup_secrets_stdin: string;
  state_layout: DesktopLocalEnvironmentStateLayout;
}>;

export type DesktopRuntimeLaunchPlan = DesktopRuntimeSpawnPlan;

type BuildDesktopRuntimeArgsOptions = Readonly<{
  localUIBind?: string;
  bootstrap?: DesktopRuntimeBootstrap | null;
  stateRoot?: string;
}>;

function resolvedRuntimeBootstrap(
  bootstrap: DesktopRuntimeBootstrap | null | undefined,
): DesktopRuntimeBootstrap | null {
  return bootstrap ?? null;
}

function acknowledgementMatchesBind(raw: string | undefined, canonicalBind: string): boolean {
  try {
    return canonicalLocalUIBind(String(raw ?? '')) === canonicalBind;
  } catch {
    return false;
  }
}

export function buildDesktopRuntimeArgs(
  environment: DesktopLocalEnvironmentState,
  options: BuildDesktopRuntimeArgsOptions = {},
): string[] {
  const access = localEnvironmentAccess(environment);
  const localUIBind = canonicalLocalUIBind(String(options.localUIBind ?? access.local_ui_bind).trim() || access.local_ui_bind);
  const parsedBind = parseLocalUIBind(localUIBind);
  const args = [
    'run',
    '--mode',
    'desktop',
    '--desktop-managed',
    '--presentation',
    'machine',
    '--local-ui-bind',
    localUIBind,
  ];
  if (!isLoopbackOnlyBind(parsedBind)) {
    const acknowledgement = access.plaintext_network_exposure_acknowledgement;
    if (!access.local_ui_password_configured || String(access.local_ui_password ?? '') === '') {
      throw new Error('Network Local UI access requires a configured password.');
    }
    if (acknowledgement?.version !== 1 || !acknowledgementMatchesBind(acknowledgement.bind, localUIBind)) {
      throw new Error('Review network exposure before starting this Local Environment.');
    }
    args.push('--acknowledge-plaintext-network-exposure');
  }
  const stateRoot = String(options.stateRoot ?? '').trim();
  if (stateRoot !== '') {
    args.push('--state-root', stateRoot);
  }

  args.push('--startup-secrets-stdin');

  const bootstrap = resolvedRuntimeBootstrap(options.bootstrap);
  if (bootstrap) {
    const providerOrigin = String(bootstrap.provider_origin ?? '').trim();
    const controlPlaneURL = String(bootstrap.controlplane_url ?? '').trim();
    const envID = String(bootstrap.env_id ?? '').trim();
    const bootstrapTicket = String(bootstrap.bootstrap_ticket ?? '').trim();
    if (providerOrigin !== '' && controlPlaneURL !== '' && envID !== '' && bootstrapTicket !== '') {
      args.push(
        '--provider-origin',
        providerOrigin,
        '--controlplane',
        controlPlaneURL,
        '--env-id',
        envID,
      );
    }
  }

  return args;
}

export function buildDesktopRuntimeEnvironment(
  _environment: DesktopLocalEnvironmentState,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    desktopOwnerID?: string;
  }>,
): NodeJS.ProcessEnv {
  const env = sanitizeDesktopChildEnvironment({
    ...baseEnv,
  });
  const desktopOwnerID = String(options?.desktopOwnerID ?? '').trim();
  if (desktopOwnerID !== '') {
    env[DESKTOP_OWNER_ID_ENV_NAME] = desktopOwnerID;
  } else {
    delete env[DESKTOP_OWNER_ID_ENV_NAME];
  }

  return env;
}

function buildDesktopRuntimePlan(
  environment: DesktopLocalEnvironmentState,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopRuntimeBootstrap | null;
    desktopOwnerID?: string;
  }>,
): DesktopRuntimeLaunchPlan {
  const stateLayout = resolveDesktopLocalEnvironmentStateLayout(environment, baseEnv);
  const env = buildDesktopRuntimeEnvironment(environment, baseEnv, {
    desktopOwnerID: options?.desktopOwnerID,
  });
  const args = buildDesktopRuntimeArgs(environment, {
    localUIBind: options?.localUIBind,
    bootstrap: options?.bootstrap,
    stateRoot: stateLayout.stateRoot,
  });
  const access = localEnvironmentAccess(environment);
  const bootstrap = resolvedRuntimeBootstrap(options?.bootstrap);
  const envelope: {
    version: 1;
    local_ui_password?: string;
    bootstrap_ticket?: string;
  } = { version: 1 };
  if (access.local_ui_password_configured) {
    envelope.local_ui_password = String(access.local_ui_password ?? '');
  }
  if (bootstrap && String(bootstrap.bootstrap_ticket ?? '').trim() !== '') {
    envelope.bootstrap_ticket = String(bootstrap.bootstrap_ticket);
  }
  const startupSecretsStdin = JSON.stringify(envelope);
  if (Buffer.byteLength(startupSecretsStdin, 'utf8') > STARTUP_SECRETS_MAX_BYTES) {
    throw new Error('Desktop startup secrets exceed the 64 KiB runtime envelope limit.');
  }
  return {
    args,
    env,
    startup_secrets_stdin: startupSecretsStdin,
    state_layout: stateLayout,
  };
}

export function buildDesktopRuntimeLaunchPlan(
  environment: DesktopLocalEnvironmentState,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopRuntimeBootstrap | null;
    desktopOwnerID?: string;
  }>,
): DesktopRuntimeLaunchPlan {
  return buildDesktopRuntimePlan(environment, baseEnv, options);
}

export function buildDesktopRuntimeSpawnPlan(
  startupReportFile: string,
  environment: DesktopLocalEnvironmentState,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: Readonly<{
    localUIBind?: string;
    bootstrap?: DesktopRuntimeBootstrap | null;
    desktopOwnerID?: string;
  }>,
): DesktopRuntimeSpawnPlan {
  const launchPlan = buildDesktopRuntimeLaunchPlan(environment, baseEnv, options);
  return {
    ...launchPlan,
    args: [...launchPlan.args, '--startup-report-file', startupReportFile],
  };
}

export function resolveDesktopLocalEnvironmentStateLayout(
  _environment: DesktopLocalEnvironmentState,
  baseEnv: NodeJS.ProcessEnv = process.env,
): DesktopLocalEnvironmentStateLayout {
  return defaultLocalEnvironmentStateLayout(baseEnv);
}
