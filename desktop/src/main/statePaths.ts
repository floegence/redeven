import os from 'node:os';
import path from 'node:path';

const LOCAL_ENVIRONMENT_DIR = 'local-environment';

export type DesktopLocalEnvironmentStateLayout = Readonly<{
  stateRoot: string;
  configPath: string;
  secretsFile: string;
  lockFile: string;
  stateDir: string;
  runtimeStateFile: string;
  diagnosticsDir: string;
  auditDir: string;
  appsDir: string;
  gatewayDir: string;
}>;

export function resolveStateRoot(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  override?: string,
): string {
  const explicit = String(override ?? '').trim() || String(env.REDEVEN_STATE_ROOT ?? '').trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const homeDir = String(env.HOME ?? '').trim() || String(homedir() ?? '').trim();
  if (!homeDir) {
    throw new Error('user home directory is unavailable');
  }
  return path.join(homeDir, '.redeven');
}

function stateLayoutForResolvedStateRoot(
  stateRoot: string,
): DesktopLocalEnvironmentStateLayout {
  const stateDir = path.join(stateRoot, LOCAL_ENVIRONMENT_DIR);

  return {
    stateRoot,
    configPath: path.join(stateDir, 'config.json'),
    secretsFile: path.join(stateDir, 'secrets.json'),
    lockFile: path.join(stateDir, 'agent.lock'),
    stateDir,
    runtimeStateFile: path.join(stateDir, 'runtime', 'local-ui.json'),
    diagnosticsDir: path.join(stateDir, 'diagnostics'),
    auditDir: path.join(stateDir, 'audit'),
    appsDir: path.join(stateDir, 'apps'),
    gatewayDir: path.join(stateDir, 'gateway'),
  };
}

export function defaultLocalEnvironmentStateLayout(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  override?: string,
): DesktopLocalEnvironmentStateLayout {
  return stateLayoutForResolvedStateRoot(resolveStateRoot(env, homedir, override));
}

export function localEnvironmentStateLayout(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  override?: string,
): DesktopLocalEnvironmentStateLayout {
  return defaultLocalEnvironmentStateLayout(env, homedir, override);
}
