import {
  WORKBENCH_DEFAULT_TEXT_COLOR,
  WORKBENCH_TEXT_FONT_OPTIONS,
  type WorkbenchAnnotationItem,
  type WorkbenchBackgroundLayer,
  type WorkbenchStickyNoteItem,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import type { RuntimeWorkbenchLayoutWidget } from './runtimeWorkbenchLayout';

export type RedevenWorkbenchCanvasPresetID = 'redeven.first_run.welcome.v2';

export type RedevenWorkbenchCanvasPreset = Readonly<{
  preset_id: RedevenWorkbenchCanvasPresetID;
  schema_version: 1;
  title: string;
  description: string;
  canvas: Readonly<{
    widgets: readonly RuntimeWorkbenchLayoutWidget[];
    sticky_notes: readonly WorkbenchStickyNoteItem[];
    annotations: readonly WorkbenchAnnotationItem[];
    background_layers: readonly WorkbenchBackgroundLayer[];
  }>;
}>;

export type CreateRedevenWorkbenchCanvasPresetOptions = Readonly<{
  widgetDefinitions: readonly WorkbenchWidgetDefinition[];
  initialWidgetTypes: readonly WorkbenchWidgetType[];
  createdAtUnixMs: number;
}>;

// Give real widget content room to breathe; overview scales the scene, not its internal layout.
const WIDGET_SPECS = [
  { widget_type: 'redeven.files', widget_id: 'widget-initial-files', x: 560, y: 528, width: 848, height: 918 },
  { widget_type: 'redeven.terminal', widget_id: 'widget-initial-terminal', x: 1504, y: 528, width: 1040, height: 440 },
  { widget_type: 'redeven.monitor', widget_id: 'widget-initial-monitor', x: 1504, y: 1000, width: 1040, height: 446 },
] as const;

export function createRedevenWorkbenchCanvasPreset(
  options: CreateRedevenWorkbenchCanvasPresetOptions,
): RedevenWorkbenchCanvasPreset {
  // Seed copy is editable English user content, independent of the interface language.
  const title = 'Make room for your next idea.';
  const description = 'Files, terminals, and live signals. One space to make them yours.';
  const time = Number.isFinite(options.createdAtUnixMs) ? Math.max(0, Math.trunc(options.createdAtUnixMs)) : 0;
  const geometry = (id: string, x: number, y: number, width: number, height: number, order: number) => ({
    id, x, y, width, height, z_index: order,
    created_at_unix_ms: time + order,
    updated_at_unix_ms: time + order,
  });
  const text = (id: string, content: string, x: number, y: number, width: number, height: number, size: number, weight = 400): WorkbenchAnnotationItem => ({
    ...geometry(id, x, y, width, height, 8),
    kind: 'text', text: content,
    font_family: WORKBENCH_TEXT_FONT_OPTIONS.find((font) => font.id === 'sans')!.fontFamily,
    font_size: size, font_weight: weight, color: WORKBENCH_DEFAULT_TEXT_COLOR, align: 'left',
  });
  const available = new Set(options.widgetDefinitions.map((definition) => definition.type));
  const requested = new Set(options.initialWidgetTypes);
  const widgets: RuntimeWorkbenchLayoutWidget[] = WIDGET_SPECS
    .filter((spec) => available.has(spec.widget_type) && requested.has(spec.widget_type))
    .map((spec, index) => ({ ...spec, z_index: 20 + index, created_at_unix_ms: time + index }));

  return {
    preset_id: 'redeven.first_run.welcome.v2',
    schema_version: 1,
    title,
    description,
    canvas: {
      widgets,
      background_layers: [
        { ...geometry('region-initial-ideas', 80, 344, 416, 1134, 1), name: '', fill: '#9da8a1', material: 'solid', opacity: 1 },
        { ...geometry('region-initial-build', 528, 344, 912, 1134, 2), name: '', fill: '#8fa1aa', material: 'frame', opacity: 1 },
        { ...geometry('region-initial-runtime', 1472, 344, 1104, 1134, 3), name: '', fill: '#a79d8e', material: 'hatched', opacity: 1 },
      ],
      annotations: [
        text('annotation-initial-brand', 'Redeven', 82, 52, 600, 40, 24, 600),
        text('annotation-initial-welcome-title', title, 80, 120, 2496, 108, 68, 600),
        text('annotation-initial-welcome-subtitle', description, 84, 254, 2488, 56, 26),
        text('annotation-initial-ideas-title', 'Think & plan', 112, 380, 352, 56, 36, 600),
        text('annotation-initial-ideas-description', 'Keep a thought. Find your next step.', 112, 456, 352, 56, 22),
        text('annotation-initial-build-title', 'Explore & build', 560, 380, 848, 56, 36, 600),
        text('annotation-initial-build-description', 'Your files, with room to see the details.', 560, 456, 848, 56, 22),
        text('annotation-initial-runtime-title', 'Run & observe', 1504, 380, 1040, 56, 36, 600),
        text('annotation-initial-runtime-description', 'A terminal and a clear view of your environment.', 1504, 456, 1040, 56, 22),
      ],
      sticky_notes: [
        {
          ...geometry('sticky-initial-capture', 112, 552, 352, 400, 10), kind: 'sticky_note',
          title: 'Make it yours', body: 'Click here to capture an idea.\nMove windows by their handles.\nKeep only what you need.', color: 'amber', material: 'tab',
        },
        {
          ...geometry('sticky-initial-guide', 112, 984, 352, 462, 11), kind: 'sticky_note',
          title: 'Shape your space', body: 'Use Composition mode to edit text and regions.\n\nReturn to Work mode for notes and tools.\n\nEverything here can move with your work.', color: 'graphite', material: 'ruled',
        },
      ],
    },
  };
}
