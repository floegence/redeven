export type EnvViewMode = 'activity' | 'deck' | 'workbench';
export type LegacyEnvViewMode = 'tab' | 'deck' | 'infinite_map';

export type EnvSurfaceId =
  | 'terminal'
  | 'monitor'
  | 'files'
  | 'codespaces'
  | 'ports'
  | 'ai'
  | 'codex';

export type EnvSurfaceOpenReason =
  | 'direct_navigation'
  | 'mode_restore'
  | 'handoff_open_terminal'
  | 'handoff_browse_files'
  | 'handoff_ask_flower'
  | 'permission_fallback'
  | 'placeholder_fallback';

export type EnvOpenSurfaceOptions = {
  reason?: EnvSurfaceOpenReason;
  focus?: boolean;
  ensureVisible?: boolean;
};

export const ENV_DESKTOP_VIEW_MODES = ['activity', 'deck', 'workbench'] as const satisfies readonly EnvViewMode[];

export const ENV_VIEW_MODE_LABELS: Record<EnvViewMode, string> = {
  activity: 'Activity',
  deck: 'Deck',
  workbench: 'Workbench',
};

export const ENV_SURFACE_IDS = [
  'terminal',
  'monitor',
  'files',
  'codespaces',
  'ports',
  'ai',
  'codex',
] as const satisfies readonly EnvSurfaceId[];

export const ENV_DEFAULT_SURFACE_ID: EnvSurfaceId = 'terminal';

export const ENV_SURFACE_LABELS: Record<EnvSurfaceId, string> = {
  terminal: 'Terminal',
  monitor: 'Monitoring',
  files: 'File Browser',
  codespaces: 'Codespaces',
  ports: 'Ports',
  ai: 'Flower',
  codex: 'Codex',
};

export const ENV_SURFACE_WIDGET_TYPES: Record<EnvSurfaceId, string> = {
  terminal: 'redeven.terminal',
  monitor: 'redeven.monitor',
  files: 'redeven.files',
  codespaces: 'redeven.codespaces',
  ports: 'redeven.ports',
  ai: 'redeven.ai',
  codex: 'redeven.codex',
};

export function isEnvViewMode(value: unknown): value is EnvViewMode {
  return value === 'activity' || value === 'deck' || value === 'workbench';
}

export function isLegacyEnvViewMode(value: unknown): value is LegacyEnvViewMode {
  return value === 'tab' || value === 'deck' || value === 'infinite_map';
}

export function normalizePersistedEnvViewMode(value: unknown): EnvViewMode | null {
  if (isEnvViewMode(value)) {
    return value;
  }
  if (value === 'tab') {
    return 'activity';
  }
  if (value === 'infinite_map') {
    return 'workbench';
  }
  if (value === 'deck') {
    return 'deck';
  }
  return null;
}

export function isEnvSurfaceId(value: unknown): value is EnvSurfaceId {
  return (
    value === 'terminal'
    || value === 'monitor'
    || value === 'files'
    || value === 'codespaces'
    || value === 'ports'
    || value === 'ai'
    || value === 'codex'
  );
}

export function envWidgetTypeForSurface(surfaceId: EnvSurfaceId): string {
  return ENV_SURFACE_WIDGET_TYPES[surfaceId];
}
