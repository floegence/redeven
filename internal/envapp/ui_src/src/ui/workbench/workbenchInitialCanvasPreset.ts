import {
  WORKBENCH_DEFAULT_TEXT_COLOR,
  WORKBENCH_TEXT_FONT_OPTIONS,
  type WorkbenchAnnotationItem,
  type WorkbenchBackgroundLayer,
  type WorkbenchStickyNoteItem,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import type { I18nHelpers } from '../i18n';
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
  t: I18nHelpers['t'];
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
  const { t } = options;
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
    title: t('workbench.welcome.title'),
    description: t('workbench.welcome.subtitle'),
    canvas: {
      widgets,
      background_layers: [
        { ...geometry('region-initial-ideas', 80, 344, 416, 1134, 1), name: '', fill: '#9da8a1', material: 'solid', opacity: 1 },
        { ...geometry('region-initial-build', 528, 344, 912, 1134, 2), name: '', fill: '#8fa1aa', material: 'frame', opacity: 1 },
        { ...geometry('region-initial-runtime', 1472, 344, 1104, 1134, 3), name: '', fill: '#a79d8e', material: 'hatched', opacity: 1 },
      ],
      annotations: [
        text('annotation-initial-brand', 'Redeven', 82, 52, 600, 40, 24, 600),
        text('annotation-initial-welcome-title', t('workbench.welcome.title'), 80, 120, 2496, 108, 68, 600),
        text('annotation-initial-welcome-subtitle', t('workbench.welcome.subtitle'), 84, 254, 2488, 56, 26),
        text('annotation-initial-ideas-title', t('workbench.welcome.ideasTitle'), 112, 380, 352, 56, 36, 600),
        text('annotation-initial-ideas-description', t('workbench.welcome.ideasDescription'), 112, 456, 352, 56, 22),
        text('annotation-initial-build-title', t('workbench.welcome.filesTitle'), 560, 380, 848, 56, 36, 600),
        text('annotation-initial-build-description', t('workbench.welcome.filesDescription'), 560, 456, 848, 56, 22),
        text('annotation-initial-runtime-title', t('workbench.welcome.runtimeTitle'), 1504, 380, 1040, 56, 36, 600),
        text('annotation-initial-runtime-description', t('workbench.welcome.runtimeDescription'), 1504, 456, 1040, 56, 22),
      ],
      sticky_notes: [
        {
          ...geometry('sticky-initial-capture', 112, 552, 352, 400, 10), kind: 'sticky_note',
          title: t('workbench.welcome.noteTitle'), body: t('workbench.welcome.noteBody'), color: 'amber', material: 'tab',
        },
        {
          ...geometry('sticky-initial-guide', 112, 984, 352, 462, 11), kind: 'sticky_note',
          title: t('workbench.welcome.guideTitle'), body: t('workbench.welcome.guideBody'), color: 'graphite', material: 'ruled',
        },
      ],
    },
  };
}
