import os from 'node:os';
import path from 'node:path';

const DEFAULT_LOCAL_SCOPE_NAME = 'default';

export type DesktopManagedScopeRef =
  | Readonly<{ kind: 'local'; name?: string }>
  | Readonly<{ kind: 'named'; name: string }>
  | Readonly<{ kind: 'controlplane'; provider_origin?: string; provider_key?: string; env_public_id: string }>;

export type DesktopManagedStateLayout = Readonly<{
  stateRoot: string;
  scope: DesktopManagedScopeRef | null;
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

function sanitizeStateScopeID(value: string): string {
  return String(value ?? '').trim().replace(/[^A-Za-z0-9_.-]/g, '_');
}

function normalizeLocalScopeName(value: string | undefined): string {
  return sanitizeStateScopeID(String(value ?? '').trim() || DEFAULT_LOCAL_SCOPE_NAME) || DEFAULT_LOCAL_SCOPE_NAME;
}

function normalizeControlPlaneOrigin(rawURL: string): string {
  const value = String(rawURL ?? '').trim();
  if (!value) {
    throw new Error('missing controlplane url');
  }
  const parsed = new URL(value);
  if (!parsed.protocol || !parsed.host) {
    throw new Error('invalid controlplane url');
  }
  parsed.username = '';
  parsed.password = '';
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}`;
}

export function controlPlaneProviderKeyForOrigin(providerOrigin: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(String(providerOrigin ?? '').trim());
  const parsed = new URL(normalizedOrigin);
  return sanitizeStateScopeID(`${parsed.protocol.replace(/:$/u, '').toLowerCase()}__${parsed.host.toLowerCase()}`);
}

function controlPlaneProviderKey(scope: Extract<DesktopManagedScopeRef, { kind: 'controlplane' }>): string {
  const explicitProviderKey = sanitizeStateScopeID(String(scope.provider_key ?? '').trim());
  if (explicitProviderKey) {
    return explicitProviderKey;
  }
  return controlPlaneProviderKeyForOrigin(String(scope.provider_origin ?? '').trim());
}

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

function stateLayoutForScope(scope: DesktopManagedScopeRef, stateRoot: string): DesktopManagedStateLayout {
  let scopeKey = '';
  let scopeDir = '';
  switch (scope.kind) {
    case 'local': {
      const name = normalizeLocalScopeName(scope.name);
      scopeKey = `local/${name}`;
      scopeDir = path.join(stateRoot, 'scopes', 'local', name);
      break;
    }
    case 'named': {
      const name = sanitizeStateScopeID(scope.name);
      if (!name) {
        throw new Error('missing named scope');
      }
      scopeKey = `named/${name}`;
      scopeDir = path.join(stateRoot, 'scopes', 'named', name);
      break;
    }
    case 'controlplane': {
      const providerKey = controlPlaneProviderKey(scope);
      const envPublicID = sanitizeStateScopeID(String(scope.env_public_id ?? '').trim());
      if (!envPublicID) {
        throw new Error('missing environment id');
      }
      scopeKey = `controlplane/${providerKey}/${envPublicID}`;
      scopeDir = path.join(stateRoot, 'scopes', 'controlplane', providerKey, envPublicID);
      break;
    }
    default:
      throw new Error('unsupported scope kind');
  }

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

export function stateLayoutForConfigPath(configPath: string): DesktopManagedStateLayout {
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

export function defaultManagedStateLayout(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  override?: string,
): DesktopManagedStateLayout {
  return localManagedStateLayout(DEFAULT_LOCAL_SCOPE_NAME, env, homedir, override);
}

export function localManagedStateLayout(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  override?: string,
): DesktopManagedStateLayout {
  return stateLayoutForScope({ kind: 'local', name }, resolveStateRoot(env, homedir, override));
}

export function namedManagedStateLayout(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  override?: string,
): DesktopManagedStateLayout {
  return stateLayoutForScope({ kind: 'named', name }, resolveStateRoot(env, homedir, override));
}

export function controlPlaneManagedStateLayout(
  providerOrigin: string,
  envPublicID: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  override?: string,
): DesktopManagedStateLayout {
  return stateLayoutForScope(
    { kind: 'controlplane', provider_origin: providerOrigin, env_public_id: envPublicID },
    resolveStateRoot(env, homedir, override),
  );
}
