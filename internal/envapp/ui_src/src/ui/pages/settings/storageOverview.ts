import type { SettingsSection } from '../../../../../../settings_ui/src/settingsSession';
import type { EnvSurfaceId } from '../../envViewMode';

export type StorageEntry = Readonly<{ id: string; path: string; kind: string; backup: string; bytes: number; complete: boolean; present: boolean }>;
export type StorageDestination = Readonly<
  { kind: 'settings'; section: SettingsSection } | { kind: 'surface'; surface: EnvSurfaceId }
  | { kind: 'plugins' } | { kind: 'files'; path: string } | { kind: 'workbench' } | { kind: 'canvas' }
>;

// IMPORTANT: Inventory grants no deletion or migration authority. Only explicit
// owner routes are actionable; never send an opaque store to a generic file editor.
export function storageDestination(entry: StorageEntry): StorageDestination | undefined {
  switch (entry.id) {
    case 'configuration': return { kind: 'settings', section: 'config' };
    case 'credentials': return { kind: 'settings', section: 'ai' };
    case 'flower': case 'read_state': return { kind: 'surface', surface: 'ai' };
    case 'plugins': case 'plugin_drafts': return { kind: 'plugins' };
    case 'skills': return { kind: 'settings', section: 'extensions' };
    case 'computer': return { kind: 'settings', section: 'browser' };
    case 'task_files': return { kind: 'files', path: entry.path };
    case 'services': case 'service_registry': return { kind: 'surface', surface: 'ports' };
    case 'code': return { kind: 'surface', surface: 'codespaces' };
    case 'terminal': return { kind: 'settings', section: 'terminal' };
    case 'favorites': return { kind: 'surface', surface: 'files' };
    case 'tessiven': return { kind: 'canvas' };
    case 'notes': case 'workbench': return { kind: 'workbench' };
    // Mixed caches, audit and coordination stores have no single cleanup UI.
    default: return undefined;
  }
}
export function orderStorageEntries(entries: readonly StorageEntry[]): StorageEntry[] {
  return [...entries].sort((a, b) => b.bytes - a.bytes || Number(b.present) - Number(a.present) || a.id.localeCompare(b.id));
}
export function formatStorageBytes(bytes: number, locale: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  const power = Math.min(units.length - 1, bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1000)) : 0);
  return new Intl.NumberFormat(locale, { style: 'unit', unit: units[power], maximumFractionDigits: power === 0 ? 0 : 1 }).format(bytes / 1000 ** power);
}
