import type {
  WorkbenchWidgetDefinition,
  WorkbenchWidgetItem,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import type { RuntimeWorkbenchLayoutWidget } from './runtimeWorkbenchLayout';
import { arrangeWorkbenchWidgetsByType } from './workbenchAutoArrange';

export type RedevenWorkbenchInitialLayout = Readonly<{
  widgets: RuntimeWorkbenchLayoutWidget[];
  sticky_notes: [];
  annotations: [];
  background_layers: [];
}>;

export type CreateRedevenWorkbenchInitialLayoutOptions = Readonly<{
  widgetDefinitions: readonly WorkbenchWidgetDefinition[];
  initialWidgetTypes: readonly WorkbenchWidgetType[];
  typeOrder: readonly WorkbenchWidgetType[];
  createdAtUnixMs: number;
  centerX?: number;
  centerY?: number;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function initialWidgetIDForType(widgetType: WorkbenchWidgetType): string {
  const suffix = compact(widgetType)
    .replace(/^redeven\./, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return suffix ? `widget-initial-${suffix}` : 'widget-initial';
}

function uniqueWidgetTypes(widgetTypes: readonly WorkbenchWidgetType[]): WorkbenchWidgetType[] {
  const seen = new Set<string>();
  const next: WorkbenchWidgetType[] = [];
  for (const widgetType of widgetTypes) {
    const normalized = compact(widgetType);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(widgetType);
  }
  return next;
}

export function createRedevenWorkbenchInitialLayout(
  options: CreateRedevenWorkbenchInitialLayoutOptions,
): RedevenWorkbenchInitialLayout {
  const definitionByType = new Map(options.widgetDefinitions.map((definition) => [definition.type, definition]));
  const createdAtUnixMs = Number.isFinite(options.createdAtUnixMs)
    ? Math.max(0, Math.trunc(options.createdAtUnixMs))
    : 0;
  const widgets: WorkbenchWidgetItem[] = uniqueWidgetTypes(options.initialWidgetTypes)
    .map((widgetType, index) => {
      const definition = definitionByType.get(widgetType);
      if (!definition) {
        return null;
      }
      return {
        id: initialWidgetIDForType(widgetType),
        type: widgetType,
        title: definition.defaultTitle,
        x: 0,
        y: 0,
        width: definition.defaultSize.width,
        height: definition.defaultSize.height,
        z_index: index + 1,
        created_at_unix_ms: createdAtUnixMs + index,
      };
    })
    .filter((widget): widget is WorkbenchWidgetItem => widget !== null);

  const arrangedWidgets = arrangeWorkbenchWidgetsByType({
    widgets,
    typeOrder: options.typeOrder,
    centerX: Number.isFinite(options.centerX) ? Number(options.centerX) : 0,
    centerY: Number.isFinite(options.centerY) ? Number(options.centerY) : 0,
  });

  return {
    widgets: arrangedWidgets.map((widget) => ({
      widget_id: widget.id,
      widget_type: widget.type,
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
      z_index: widget.z_index,
      created_at_unix_ms: widget.created_at_unix_ms,
    })),
    sticky_notes: [],
    annotations: [],
    background_layers: [],
  };
}
