import {
  type WorkbenchAnnotationItem,
  type WorkbenchBackgroundLayer,
  type WorkbenchStickyNoteColor,
  type WorkbenchStickyNoteItem,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import type { RuntimeWorkbenchLayoutWidget } from './runtimeWorkbenchLayout';

export type RedevenWorkbenchCanvasPresetID = 'redeven.first_run.welcome.v1';

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

type PresetWidgetSpec = Readonly<{
  widgetType: WorkbenchWidgetType;
  widgetId: string;
  y: number;
}>;

type PresetStickySpec = Readonly<{
  id: string;
  body: string;
  color: WorkbenchStickyNoteColor;
  x: number;
  y: number;
}>;

const PRESET_ID = 'redeven.first_run.welcome.v1' satisfies RedevenWorkbenchCanvasPresetID;
const TITLE_FONT_FAMILY = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const CORE_WIDGET_TYPES = new Set<WorkbenchWidgetType>([
  'redeven.files',
  'redeven.terminal',
  'redeven.monitor',
]);

const WIDGET_SPECS: readonly PresetWidgetSpec[] = [
  { widgetType: 'redeven.files', widgetId: 'widget-initial-files', y: 420 },
  { widgetType: 'redeven.terminal', widgetId: 'widget-initial-terminal', y: 420 },
  { widgetType: 'redeven.monitor', widgetId: 'widget-initial-monitor', y: 420 },
];

const WIDGET_STAGE_LEFT = 160;
const WIDGET_STAGE_GAP = 80;
const STICKY_WIDTH = 310;
const STICKY_HEIGHT = 172;
const STICKY_SPECS: readonly PresetStickySpec[] = [
  {
    id: 'sticky-initial-capture',
    body: '✨ Capture the <strong>thought</strong>, decision, or next step here.',
    color: 'amber',
    x: 160,
    y: 220,
  },
  {
    id: 'sticky-initial-region',
    body: '🧭 Use a Region for an <em>intentional</em> workspace.',
    color: 'sage',
    x: 500,
    y: 220,
  },
  {
    id: 'sticky-initial-runtime-tools',
    body: '🛠️ Files and Terminal are <strong>local runtime</strong> tools.',
    color: 'azure',
    x: 840,
    y: 220,
  },
  {
    id: 'sticky-initial-demo',
    body: '🎬 Demo-ready canvas: edit, move, or delete anything.',
    color: 'coral',
    x: 1180,
    y: 220,
  },
];

function normalizedTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function coreWidgetDefinitionByType(
  options: CreateRedevenWorkbenchCanvasPresetOptions,
): Map<WorkbenchWidgetType, WorkbenchWidgetDefinition> {
  const requested = new Set(options.initialWidgetTypes);
  return new Map(
    options.widgetDefinitions
      .filter((definition) => CORE_WIDGET_TYPES.has(definition.type) && requested.has(definition.type))
      .map((definition) => [definition.type, definition]),
  );
}

function createPresetWidgets(
  options: CreateRedevenWorkbenchCanvasPresetOptions,
  createdAtUnixMs: number,
): RuntimeWorkbenchLayoutWidget[] {
  const definitions = coreWidgetDefinitionByType(options);
  let nextX = WIDGET_STAGE_LEFT;
  const widgets: RuntimeWorkbenchLayoutWidget[] = [];
  for (const spec of WIDGET_SPECS) {
    const definition = definitions.get(spec.widgetType);
    if (!definition) continue;
    widgets.push({
      widget_id: spec.widgetId,
      widget_type: definition.type,
      x: nextX,
      y: spec.y,
      width: definition.defaultSize.width,
      height: definition.defaultSize.height,
      z_index: 20 + widgets.length,
      created_at_unix_ms: createdAtUnixMs + widgets.length,
    });
    nextX += definition.defaultSize.width + WIDGET_STAGE_GAP;
  }
  return widgets;
}

function createPresetStickyNotes(createdAtUnixMs: number): WorkbenchStickyNoteItem[] {
  return STICKY_SPECS.map((spec, index) => ({
    id: spec.id,
    kind: 'sticky_note',
    body: spec.body,
    color: spec.color,
    x: spec.x,
    y: spec.y,
    width: STICKY_WIDTH,
    height: STICKY_HEIGHT,
    z_index: 10 + index,
    created_at_unix_ms: createdAtUnixMs + 100 + index,
    updated_at_unix_ms: createdAtUnixMs + 100 + index,
  }));
}

function createPresetAnnotations(createdAtUnixMs: number): WorkbenchAnnotationItem[] {
  return [
    {
      id: 'annotation-initial-welcome-title',
      kind: 'text',
      text: '🚀 Welcome to Redeven',
      font_family: TITLE_FONT_FAMILY,
      font_size: 98,
      font_weight: 800,
      color: '#64748b',
      align: 'left',
      x: 160,
      y: 72,
      width: 1280,
      height: 116,
      z_index: 8,
      created_at_unix_ms: createdAtUnixMs + 200,
      updated_at_unix_ms: createdAtUnixMs + 200,
    },
  ];
}

function createPresetBackgroundLayers(
  widgets: readonly RuntimeWorkbenchLayoutWidget[],
  createdAtUnixMs: number,
): WorkbenchBackgroundLayer[] {
  if (widgets.length <= 0) return [];
  const minX = Math.min(...widgets.map((widget) => widget.x), ...STICKY_SPECS.map((note) => note.x), 160);
  const minY = 48;
  const maxX = Math.max(
    ...widgets.map((widget) => widget.x + widget.width),
    ...STICKY_SPECS.map((note) => note.x + STICKY_WIDTH),
    1440,
  );
  const maxY = Math.max(...widgets.map((widget) => widget.y + widget.height), 1350);
  const padding = 72;

  return [
    {
      id: 'region-initial-welcome-runtime',
      name: 'Welcome Region',
      fill: '#a79d8e',
      opacity: 0.28,
      material: 'glass',
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
      z_index: 1,
      created_at_unix_ms: createdAtUnixMs + 300,
      updated_at_unix_ms: createdAtUnixMs + 300,
    },
  ];
}

export function createRedevenWorkbenchCanvasPreset(
  options: CreateRedevenWorkbenchCanvasPresetOptions,
): RedevenWorkbenchCanvasPreset {
  const createdAtUnixMs = normalizedTimestamp(options.createdAtUnixMs);
  const widgets = createPresetWidgets(options, createdAtUnixMs);
  const stickyNotes = createPresetStickyNotes(createdAtUnixMs);
  const annotations = createPresetAnnotations(createdAtUnixMs);
  const backgroundLayers = createPresetBackgroundLayers(widgets, createdAtUnixMs);

  return {
    preset_id: PRESET_ID,
    schema_version: 1,
    title: 'Welcome to Redeven',
    description: 'First-run Workbench canvas for new Redeven runtime environments.',
    canvas: {
      widgets,
      sticky_notes: stickyNotes,
      annotations,
      background_layers: backgroundLayers,
    },
  };
}
