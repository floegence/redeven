import os from 'node:os';
import path from 'node:path';

const LOCAL_ENVIRONMENT_DIR = 'local-environment';
const FLOWER_HOST_DIR = 'flower';

export type DesktopLocalEnvironmentStateLayout = Readonly<{
  stateRoot: string;
  configPath: string;
  secretsFile: string;
  lockFile: string;
  stateDir: string;
  runtimeControlSocket: string;
  diagnosticsDir: string;
  auditDir: string;
  appsDir: string;
  gatewayDir: string;
}>;

export type DesktopFlowerHostStateLayout = Readonly<{
  stateRoot: string;
  stateDir: string;
  configPath: string;
  secretsFile: string;
  targetCacheFile: string;
  threadsFile: string;
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
    runtimeControlSocket: path.join(stateDir, 'runtime', 'control.sock'),
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

export function flowerHostStateLayout(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  override?: string,
): DesktopFlowerHostStateLayout {
  const stateRoot = resolveStateRoot(env, homedir, override);
  const stateDir = path.join(stateRoot, FLOWER_HOST_DIR);
  return {
    stateRoot,
    stateDir,
    configPath: path.join(stateDir, 'config.json'),
    secretsFile: path.join(stateDir, 'secrets.json'),
    targetCacheFile: path.join(stateDir, 'target-cache.json'),
    threadsFile: path.join(stateDir, 'threads.json'),
  };
}
