import {
  DEFAULT_ENV_WORKBENCH_VIEWPORT,
  type EnvWorkbenchState,
  type EnvWorkbenchViewport,
  type EnvWorkbenchWidgetDefinition,
  type EnvWorkbenchWidgetItem,
  type EnvWorkbenchWidgetType,
} from './types';
import {
  createEnvWorkbenchFilterState,
  getEnvWorkbenchWidgetEntry,
  resolveEnvWorkbenchWidgetDefinitions,
} from './widgetRegistry';

export function createEnvWorkbenchId(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === 'function') {
    return `env-wb-${crypto.randomUUID()}`;
  }
  return `env-wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeEnvWorkbenchViewport(viewport: Partial<EnvWorkbenchViewport> | undefined): EnvWorkbenchViewport {
  if (!viewport) {
    return { ...DEFAULT_ENV_WORKBENCH_VIEWPORT };
  }
  return {
    x: Number.isFinite(viewport.x) ? viewport.x! : DEFAULT_ENV_WORKBENCH_VIEWPORT.x,
    y: Number.isFinite(viewport.y) ? viewport.y! : DEFAULT_ENV_WORKBENCH_VIEWPORT.y,
    scale: Number.isFinite(viewport.scale) && viewport.scale! > 0 ? viewport.scale! : DEFAULT_ENV_WORKBENCH_VIEWPORT.scale,
  };
}

export function sanitizeEnvWorkbenchFilters(
  filters: Partial<Record<EnvWorkbenchWidgetType, boolean>> | undefined,
  widgetDefinitions?: readonly EnvWorkbenchWidgetDefinition[],
): Record<EnvWorkbenchWidgetType, boolean> {
  return createEnvWorkbenchFilterState(widgetDefinitions, filters);
}

function isValidWidgetType(
  type: unknown,
  widgetDefinitions: readonly EnvWorkbenchWidgetDefinition[],
): type is EnvWorkbenchWidgetType {
  return typeof type === 'string' && widgetDefinitions.some((entry) => entry.type === type);
}

export interface SanitizeEnvWorkbenchStateOptions {
  widgetDefinitions?: readonly EnvWorkbenchWidgetDefinition[];
  createFallbackState?: () => EnvWorkbenchState;
}

export function sanitizeEnvWorkbenchState(
  input: unknown,
  options: SanitizeEnvWorkbenchStateOptions = {},
): EnvWorkbenchState {
  const widgetDefinitions = resolveEnvWorkbenchWidgetDefinitions(options.widgetDefinitions);
  const createFallbackState = options.createFallbackState ?? (() => createDefaultEnvWorkbenchState(widgetDefinitions));
  const state = input as Partial<EnvWorkbenchState> | undefined;
  if (!state || state.version !== 1 || !Array.isArray(state.widgets)) {
    return createFallbackState();
  }

  const widgets: EnvWorkbenchWidgetItem[] = state.widgets
    .filter(
      (widget): widget is EnvWorkbenchWidgetItem => !!widget
        && typeof widget.id === 'string'
        && isValidWidgetType(widget.type, widgetDefinitions)
        && typeof widget.title === 'string',
    )
    .map((widget) => {
      const entry = getEnvWorkbenchWidgetEntry(widget.type, widgetDefinitions);
      return {
        id: widget.id,
        type: widget.type,
        title: widget.title,
        x: Number.isFinite(widget.x) ? widget.x : 0,
        y: Number.isFinite(widget.y) ? widget.y : 0,
        width: Number.isFinite(widget.width) && widget.width > 0 ? widget.width : entry.defaultSize.width,
        height: Number.isFinite(widget.height) && widget.height > 0 ? widget.height : entry.defaultSize.height,
        z_index: Number.isFinite(widget.z_index) && widget.z_index >= 0 ? widget.z_index : 1,
        created_at_unix_ms: Number.isFinite(widget.created_at_unix_ms) ? widget.created_at_unix_ms : Date.now(),
      };
    });

  const selectedWidgetId = typeof state.selectedWidgetId === 'string' && widgets.some((widget) => widget.id === state.selectedWidgetId)
    ? state.selectedWidgetId
    : null;

  return {
    version: 1,
    widgets,
    viewport: sanitizeEnvWorkbenchViewport(state.viewport),
    locked: typeof state.locked === 'boolean' ? state.locked : false,
    filters: sanitizeEnvWorkbenchFilters(state.filters, widgetDefinitions),
    selectedWidgetId,
  };
}

export function createDefaultEnvWorkbenchState(
  widgetDefinitions?: readonly EnvWorkbenchWidgetDefinition[],
): EnvWorkbenchState {
  const definitions = resolveEnvWorkbenchWidgetDefinitions(widgetDefinitions);
  const now = Date.now();
  const seedSpecs: ReadonlyArray<Readonly<{ type: string; title: string; x: number; y: number }>> = [
    { type: 'redeven.terminal', title: 'Terminal', x: 120, y: 88 },
    { type: 'redeven.files', title: 'Files', x: 980, y: 112 },
    { type: 'redeven.monitor', title: 'Monitoring', x: 240, y: 612 },
  ];

  const widgets = seedSpecs
    .filter((seed) => definitions.some((entry) => entry.type === seed.type))
    .map((seed, index) => {
      const entry = getEnvWorkbenchWidgetEntry(seed.type, definitions);
      return {
        id: `env-wb-seed-${index + 1}`,
        type: seed.type,
        title: seed.title,
        x: seed.x,
        y: seed.y,
        width: entry.defaultSize.width,
        height: entry.defaultSize.height,
        z_index: index + 1,
        created_at_unix_ms: now - (seedSpecs.length - index) * 60_000,
      } satisfies EnvWorkbenchWidgetItem;
    });

  return {
    version: 1,
    widgets,
    viewport: { ...DEFAULT_ENV_WORKBENCH_VIEWPORT },
    locked: false,
    filters: createEnvWorkbenchFilterState(definitions),
    selectedWidgetId: widgets[0]?.id ?? null,
  };
}

export const ENV_WORKBENCH_CANVAS_ZOOM_STEP = 1.18;
export const ENV_WORKBENCH_CONTEXT_MENU_WIDTH_PX = 220;

export function createEnvWorkbenchContextMenuPosition(options: {
  clientX: number;
  clientY: number;
  menuWidth: number;
  menuHeight: number;
}): { left: number; top: number } {
  const viewWidth = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const viewHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
  let left = options.clientX;
  let top = options.clientY;

  if (left + options.menuWidth > viewWidth) {
    left = Math.max(0, viewWidth - options.menuWidth - 8);
  }
  if (top + options.menuHeight > viewHeight) {
    top = Math.max(0, viewHeight - options.menuHeight - 8);
  }

  return { left, top };
}

export function getEnvWorkbenchTopZIndex(widgets: readonly EnvWorkbenchWidgetItem[]): number {
  return widgets.reduce((max, widget) => Math.max(max, widget.z_index), 1);
}

export function clampEnvWorkbenchScale(scale: number, min = 0.45, max = 2.2): number {
  return Math.max(min, Math.min(max, scale));
}

export function estimateEnvWorkbenchContextMenuHeight(actionCount: number, separatorCount = 0): number {
  return 16 + Math.max(1, actionCount) * 32 + Math.max(0, separatorCount) * 9;
}

export function findNearestEnvWorkbenchWidget(
  widgets: readonly EnvWorkbenchWidgetItem[],
  currentId: string | null,
  direction: 'up' | 'down' | 'left' | 'right',
  filters: Record<EnvWorkbenchWidgetType, boolean>,
): EnvWorkbenchWidgetItem | null {
  const visible = widgets.filter((widget) => filters[widget.type]);
  if (visible.length === 0) return null;
  if (!currentId) return visible[0] ?? null;

  const current = visible.find((widget) => widget.id === currentId);
  if (!current) return visible[0] ?? null;

  const cx = current.x + current.width / 2;
  const cy = current.y + current.height / 2;
  let best: EnvWorkbenchWidgetItem | null = null;
  let bestScore = Infinity;

  for (const candidate of visible) {
    if (candidate.id === currentId) {
      continue;
    }

    const dx = candidate.x + candidate.width / 2 - cx;
    const dy = candidate.y + candidate.height / 2 - cy;

    let isInDirection = false;
    switch (direction) {
      case 'up':
        isInDirection = dy < -10;
        break;
      case 'down':
        isInDirection = dy > 10;
        break;
      case 'left':
        isInDirection = dx < -10;
        break;
      case 'right':
        isInDirection = dx > 10;
        break;
    }
    if (!isInDirection) {
      continue;
    }

    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(
      direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy),
      direction === 'up' || direction === 'down' ? Math.abs(dy) : Math.abs(dx),
    );
    const score = distance * (1 + angle * 1.5);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}
