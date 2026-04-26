import type { WorkbenchWidgetItem } from '@floegence/floe-webapp-core/workbench';

export type WorkbenchFocusHistory = readonly string[];

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function liveWidgetIdSet(widgets: readonly WorkbenchWidgetItem[]): Set<string> {
  return new Set(widgets.map((widget) => compact(widget.id)).filter(Boolean));
}

export function pruneWorkbenchFocusHistory(
  history: WorkbenchFocusHistory,
  widgets: readonly WorkbenchWidgetItem[],
): string[] {
  const liveWidgetIds = liveWidgetIdSet(widgets);
  const seen = new Set<string>();
  const next: string[] = [];

  for (const entry of history) {
    const widgetId = compact(entry);
    if (!widgetId || seen.has(widgetId) || !liveWidgetIds.has(widgetId)) {
      continue;
    }
    seen.add(widgetId);
    next.push(widgetId);
  }

  return next;
}

export function recordWorkbenchFocus(
  history: WorkbenchFocusHistory,
  widgets: readonly WorkbenchWidgetItem[],
  selectedWidgetId: string | null | undefined,
): string[] {
  const liveWidgetIds = liveWidgetIdSet(widgets);
  const selected = compact(selectedWidgetId);
  const pruned = pruneWorkbenchFocusHistory(history, widgets);
  if (!selected || !liveWidgetIds.has(selected)) {
    return pruned;
  }

  return [
    selected,
    ...pruned.filter((widgetId) => widgetId !== selected),
  ];
}

export function resolveWorkbenchFocusFallback(
  history: WorkbenchFocusHistory,
  widgets: readonly WorkbenchWidgetItem[],
  excludedWidgetIds: readonly string[] = [],
): string | null {
  const liveWidgetIds = liveWidgetIdSet(widgets);
  const excluded = new Set(excludedWidgetIds.map(compact).filter(Boolean));

  for (const entry of history) {
    const widgetId = compact(entry);
    if (widgetId && !excluded.has(widgetId) && liveWidgetIds.has(widgetId)) {
      return widgetId;
    }
  }

  return null;
}
