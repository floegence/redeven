export type PermissionKind = 'read' | 'write' | 'execute' | 'admin';

export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (!e || typeof e !== 'object') return String(e);

  const any = e as any;
  if (typeof any.message === 'string') return any.message;
  if (typeof any.error === 'string') return any.error;
  return String(e);
}

export function isPermissionDeniedError(e: unknown, kind?: PermissionKind): boolean {
  const msg = getErrorMessage(e).toLowerCase();
  if (!msg) return false;

  // Most runtime-side permission errors follow the pattern: "<perm> permission denied" with RPC code=403 or HTTP 403.
  if (!msg.includes('permission denied')) return false;

  if (!kind) return true;
  return msg.includes(`${kind} permission denied`) || (msg.includes(kind) && msg.includes('permission denied'));
}
