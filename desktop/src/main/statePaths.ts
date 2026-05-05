import os from 'node:os';
import path from 'node:path';

const LOCAL_ENVIRONMENT_SCOPE_KEY = 'local_environment';
const LOCAL_ENVIRONMENT_SCOPE_DIR = 'local-environment';

export type DesktopLocalEnvironmentScopeRef =
  Readonly<{ kind: 'local_environment'; name?: string }>;

export type DesktopLocalEnvironmentStateLayout = Readonly<{
  stateRoot: string;
  scope: DesktopLocalEnvironmentScopeRef | null;
  scopeKey: string;
  scopeDir: string;
  scopeMetadataFile: string;
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

function stateLayoutForLocalEnvironmentScope(
  scope: DesktopLocalEnvironmentScopeRef,
  stateRoot: string,
): DesktopLocalEnvironmentStateLayout {
  const scopeKey = LOCAL_ENVIRONMENT_SCOPE_KEY;
  const scopeDir = path.join(stateRoot, LOCAL_ENVIRONMENT_SCOPE_DIR);

  return {
    stateRoot,
    scope,
    scopeKey,
    scopeDir,
    scopeMetadataFile: path.join(scopeDir, 'scope.json'),
    configPath: path.join(scopeDir, 'config.json'),
    secretsFile: path.join(scopeDir, 'secrets.json'),
    lockFile: path.join(scopeDir, 'agent.lock'),
    stateDir: scopeDir,
    runtimeStateFile: path.join(scopeDir, 'runtime', 'local-ui.json'),
    diagnosticsDir: path.join(scopeDir, 'diagnostics'),
    auditDir: path.join(scopeDir, 'audit'),
    appsDir: path.join(scopeDir, 'apps'),
    gatewayDir: path.join(scopeDir, 'gateway'),
  };
}

export function stateLayoutForConfigPath(configPath: string): DesktopLocalEnvironmentStateLayout {
  const cleanPath = String(configPath ?? '').trim();
  if (!cleanPath) {
    throw new Error('missing config path');
  }

  const resolvedConfigPath = path.resolve(cleanPath);
  const stateDir = path.dirname(resolvedConfigPath);
  return {
    stateRoot: '',
    scope: null,
    scopeKey: '',
    scopeDir: stateDir,
    scopeMetadataFile: path.join(stateDir, 'scope.json'),
    configPath: resolvedConfigPath,
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
  return stateLayoutForLocalEnvironmentScope({ kind: 'local_environment', name: 'local' }, resolveStateRoot(env, homedir, override));
}

export function localEnvironmentStateLayout(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  override?: string,
): DesktopLocalEnvironmentStateLayout {
  return defaultLocalEnvironmentStateLayout(env, homedir, override);
}
