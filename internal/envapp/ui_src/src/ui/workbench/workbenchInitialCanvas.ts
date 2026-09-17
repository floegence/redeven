import type {
  WorkbenchAnnotationItem,
  WorkbenchBackgroundLayer,
  WorkbenchStickyNoteItem,
  WorkbenchWidgetDefinition,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import type { RuntimeWorkbenchLayoutWidget } from './runtimeWorkbenchLayout';
import { createRedevenWorkbenchCanvasPreset } from './workbenchInitialCanvasPreset';

export type RedevenWorkbenchInitialLayout = Readonly<{
  widgets: RuntimeWorkbenchLayoutWidget[];
  sticky_notes: WorkbenchStickyNoteItem[];
  annotations: WorkbenchAnnotationItem[];
  background_layers: WorkbenchBackgroundLayer[];
}>;

export type CreateRedevenWorkbenchInitialLayoutOptions = Readonly<{
  widgetDefinitions: readonly WorkbenchWidgetDefinition[];
  initialWidgetTypes: readonly WorkbenchWidgetType[];
  typeOrder: readonly WorkbenchWidgetType[];
  createdAtUnixMs: number;
  centerX?: number;
  centerY?: number;
}>;

export function createRedevenWorkbenchInitialLayout(
  options: CreateRedevenWorkbenchInitialLayoutOptions,
): RedevenWorkbenchInitialLayout {
  const preset = createRedevenWorkbenchCanvasPreset({
    widgetDefinitions: options.widgetDefinitions,
    initialWidgetTypes: options.initialWidgetTypes,
    createdAtUnixMs: options.createdAtUnixMs,
  });

  return {
    widgets: [...preset.canvas.widgets],
    sticky_notes: [...preset.canvas.sticky_notes],
    annotations: [...preset.canvas.annotations],
    background_layers: [...preset.canvas.background_layers],
  };
}
