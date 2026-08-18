import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCAL_ENVIRONMENT_DIR = 'local-environment';
const MAX_UNIX_SOCKET_PATH_BYTES = 100;
export const DESKTOP_TEMP_ROOT_ENV_NAME = 'REDEVEN_DESKTOP_TEMP_ROOT';
export const DESKTOP_USER_DATA_ROOT_ENV_NAME = 'REDEVEN_DESKTOP_USER_DATA_ROOT';
export const DESKTOP_CACHE_ROOT_ENV_NAME = 'REDEVEN_DESKTOP_CACHE_ROOT';

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

export function resolveConfiguredDesktopTempRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = String(env[DESKTOP_TEMP_ROOT_ENV_NAME] ?? '').trim();
  return explicit === '' ? null : path.resolve(explicit);
}

function resolveConfiguredDesktopPath(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const explicit = String(env[name] ?? '').trim();
  return explicit === '' ? null : path.resolve(explicit);
}

export function resolveConfiguredDesktopUserDataRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return resolveConfiguredDesktopPath(env, DESKTOP_USER_DATA_ROOT_ENV_NAME);
}

export function resolveConfiguredDesktopCacheRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return resolveConfiguredDesktopPath(env, DESKTOP_CACHE_ROOT_ENV_NAME);
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
    runtimeControlSocket: runtimeControlSocketPath(stateDir),
    diagnosticsDir: path.join(stateDir, 'diagnostics'),
    auditDir: path.join(stateDir, 'audit'),
    appsDir: path.join(stateDir, 'apps'),
    gatewayDir: path.join(stateDir, 'gateway'),
  };
}

export function runtimeControlSocketPath(
  stateDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const cleanStateDir = path.normalize(String(stateDir ?? '').trim());
  const localPath = path.join(cleanStateDir, 'runtime', 'control.sock');
  if ((platform !== 'darwin' && platform !== 'linux') || Buffer.byteLength(localPath) <= MAX_UNIX_SOCKET_PATH_BYTES) {
    return localPath;
  }
  const digest = createHash('sha256').update(canonicalPathForDigest(cleanStateDir)).digest('hex').slice(0, 24);
  const fileName = `redeven-runtime-${digest}.sock`;
  return path.join('/tmp', fileName);
}

function canonicalPathForDigest(targetPath: string): string {
  let cursor = path.normalize(targetPath);
  const suffix: string[] = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return path.normalize(targetPath);
    }
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  try {
    return path.join(fs.realpathSync.native(cursor), ...suffix);
  } catch {
    return path.normalize(targetPath);
  }
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
