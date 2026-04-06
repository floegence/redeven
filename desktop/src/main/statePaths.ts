import os from 'node:os';
import path from 'node:path';

export type DesktopManagedStateLayout = Readonly<{
  configPath: string;
  stateDir: string;
  runtimeStateFile: string;
}>;

function resolveStateRoot(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const homeDir = String(env.HOME ?? '').trim() || String(homedir() ?? '').trim();
  if (!homeDir) {
    throw new Error('user home directory is unavailable');
  }
  return path.join(homeDir, '.redeven');
}

function sanitizeStateScopeID(value: string): string {
  return String(value ?? '').trim().replace(/[^A-Za-z0-9_.-]/g, '_');
}

export function stateLayoutForConfigPath(configPath: string): DesktopManagedStateLayout {
  const cleanPath = String(configPath ?? '').trim();
  if (!cleanPath) {
    throw new Error('missing config path');
  }

  const resolvedConfigPath = path.resolve(cleanPath);
  const stateDir = path.dirname(resolvedConfigPath);
  return {
    configPath: resolvedConfigPath,
    stateDir,
    runtimeStateFile: path.join(stateDir, 'runtime', 'local-ui.json'),
  };
}

export function defaultManagedStateLayout(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): DesktopManagedStateLayout {
  return stateLayoutForConfigPath(path.join(resolveStateRoot(env, homedir), 'config.json'));
}

export function envManagedStateLayout(
  envID: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): DesktopManagedStateLayout {
  const cleanEnvID = String(envID ?? '').trim();
  if (!cleanEnvID) {
    return defaultManagedStateLayout(env, homedir);
  }
  return stateLayoutForConfigPath(path.join(resolveStateRoot(env, homedir), 'envs', sanitizeStateScopeID(cleanEnvID), 'config.json'));
}
