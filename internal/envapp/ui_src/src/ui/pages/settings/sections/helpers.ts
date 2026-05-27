import type { RuntimeServiceSnapshot } from '../../../protocol/redeven_v1/sdk/sys';

export function formatRuntimeServiceOwner(snapshot: RuntimeServiceSnapshot | undefined): string {
  if (!snapshot) return 'Unknown';
  if (snapshot.serviceOwner === 'desktop' || snapshot.desktopManaged) return 'Redeven Desktop';
  if (snapshot.serviceOwner === 'external') return 'External service';
  return 'Unknown';
}

export function formatRuntimeServiceCompatibility(snapshot: RuntimeServiceSnapshot | undefined): string {
  const value = String(snapshot?.compatibility ?? 'unknown').trim();
  switch (value) {
    case 'compatible': return 'Compatible';
    case 'update_available': return 'Update available';
    case 'restart_recommended': return 'Restart recommended';
    case 'update_required': return 'Update required';
    case 'desktop_update_required': return 'Desktop update required';
    case 'managed_elsewhere': return 'Managed elsewhere';
    default: return 'Unknown';
  }
}

export function runtimeServiceCompatibilityTone(snapshot: RuntimeServiceSnapshot | undefined): 'default' | 'warning' | 'success' {
  switch (snapshot?.compatibility) {
    case 'compatible': return 'success';
    case 'update_available': case 'restart_recommended': case 'update_required':
    case 'desktop_update_required': case 'managed_elsewhere': return 'warning';
    default: return 'default';
  }
}
