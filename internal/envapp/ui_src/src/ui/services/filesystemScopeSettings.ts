import type { FilesystemRootPolicy, FilesystemScope } from '../pages/settings/types';

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
      permissions: { read: true, write: true },
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
