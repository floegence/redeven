import type { AgentSettingsResponse, FilesystemRootPolicy, FilesystemScope, SettingsUpdateResponse } from '../pages/settings/types';
import { fetchGatewayJSON } from './gatewayApi';

export type FilesystemRootWriteUpdateResult = Readonly<{
  settings: AgentSettingsResponse;
  filesystemScope: FilesystemScope;
}>;

export async function fetchFilesystemSettings(): Promise<AgentSettingsResponse> {
  return fetchGatewayJSON<AgentSettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' });
}

function runtimeFilesystemRoots(agentHomeDir: string, scope: FilesystemScope | null | undefined): readonly FilesystemRootPolicy[] {
  if (scope?.roots?.length) return scope.roots;
  const home = String(agentHomeDir ?? '').trim();
  return [
    {
      id: 'home',
      label: 'Home',
      path: home || '~',
      kind: 'home',
      permissions: { read: true, write: true },
      system: true,
    },
    {
      id: 'computer',
      label: 'Computer',
      path: '/',
      kind: 'computer',
      permissions: { read: true, write: false },
      system: true,
    },
  ];
}

function cloneFilesystemRoot(root: FilesystemRootPolicy): FilesystemRootPolicy {
  return {
    id: String(root.id ?? ''),
    label: String(root.label ?? ''),
    path: String(root.path ?? ''),
    kind: root.kind,
    permissions: {
      read: Boolean(root.permissions?.read),
      write: Boolean(root.permissions?.write),
    },
    hidden: Boolean(root.hidden),
    system: Boolean(root.system),
  };
}

export function normalizeFilesystemScopeDraft(agentHomeDir: string, scope: FilesystemScope | null | undefined): FilesystemScope {
  const roots = runtimeFilesystemRoots(agentHomeDir, scope).map((root) => cloneFilesystemRoot(root));
  const currentDefaultRootID = String(scope?.default_root_id ?? '').trim();
  const defaultRootID = currentDefaultRootID && roots.some((root) => root.id === currentDefaultRootID)
    ? currentDefaultRootID
    : (roots.find((root) => root.id === 'home')?.id ?? roots[0]?.id ?? 'home');

  return {
    schema_version: Number(scope?.schema_version ?? 1) || 1,
    default_root_id: defaultRootID,
    roots,
  };
}

export function updateFilesystemRootWritePermission(
  scope: FilesystemScope,
  rootId: string,
  write: boolean,
): FilesystemScope {
  const id = String(rootId ?? '').trim();
  if (!id) throw new Error('Missing filesystem root id.');
  let matched = false;
  const roots = scope.roots.map((root) => {
    if (root.id !== id) return cloneFilesystemRoot(root);
    matched = true;
    return {
      ...cloneFilesystemRoot(root),
      permissions: {
        read: true,
        write,
      },
    };
  });
  if (!matched) throw new Error(`Filesystem root not found: ${id}`);
  return {
    ...scope,
    roots,
  };
}

function normalizeSettingsUpdateResponse(raw: AgentSettingsResponse | SettingsUpdateResponse): AgentSettingsResponse {
  const maybeSettings = (raw as SettingsUpdateResponse)?.settings;
  return (maybeSettings ?? raw) as AgentSettingsResponse;
}

export async function saveFilesystemRootWritePermission(
  currentSettings: AgentSettingsResponse,
  rootId: string,
  write: boolean,
): Promise<FilesystemRootWriteUpdateResult> {
  const agentHomeDir = String(currentSettings.runtime?.agent_home_dir ?? '').trim();
  const baseScope = normalizeFilesystemScopeDraft(agentHomeDir, currentSettings.runtime?.filesystem_scope ?? null);
  const filesystemScope = updateFilesystemRootWritePermission(baseScope, rootId, write);
  const data = await fetchGatewayJSON<AgentSettingsResponse | SettingsUpdateResponse>('/_redeven_proxy/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      agent_home_dir: agentHomeDir,
      shell: String(currentSettings.runtime?.shell ?? ''),
      filesystem_scope: filesystemScope,
    }),
  });
  const settings = normalizeSettingsUpdateResponse(data);
  return {
    settings,
    filesystemScope: settings.runtime?.filesystem_scope ?? filesystemScope,
  };
}
