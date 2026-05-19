import { describe, expect, it } from 'vitest';
import type { WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';

import { createRedevenWorkbenchInitialLayout } from './workbenchInitialCanvas';
import { createRedevenWorkbenchCanvasPreset } from './workbenchInitialCanvasPreset';

const widgetDefinitions = [
  {
    type: 'redeven.files',
    label: 'Files',
    icon: () => null,
    body: () => null,
    defaultTitle: 'Files',
    defaultSize: { width: 1080, height: 700 },
    singleton: false,
  },
  {
    type: 'redeven.terminal',
    label: 'Terminal',
    icon: () => null,
    body: () => null,
    defaultTitle: 'Terminal',
    defaultSize: { width: 1120, height: 680 },
    singleton: false,
  },
  {
    type: 'redeven.monitor',
    label: 'Monitoring',
    icon: () => null,
    body: () => null,
    defaultTitle: 'Monitoring',
    defaultSize: { width: 1040, height: 640 },
    singleton: true,
  },
  {
    type: 'redeven.preview',
    label: 'Preview',
    icon: () => null,
    body: () => null,
    defaultTitle: 'Preview',
    defaultSize: { width: 1080, height: 700 },
    singleton: false,
  },
] as const satisfies readonly WorkbenchWidgetDefinition[];

const initialWidgetTypes = [
  'redeven.files',
  'redeven.terminal',
  'redeven.monitor',
  'redeven.preview',
] as const;

function byType(type: string) {
  return widgetDefinitions.find((definition) => definition.type === type)!;
}

describe('workbenchInitialCanvas', () => {
  it('creates the first-run welcome preset with the three core runtime widgets', () => {
    const layout = createRedevenWorkbenchInitialLayout({
      widgetDefinitions,
      initialWidgetTypes,
      typeOrder: initialWidgetTypes,
      createdAtUnixMs: 1_700_000_000_000,
    });

    expect(layout.widgets.map((widget) => widget.widget_type)).toEqual([
      'redeven.files',
      'redeven.terminal',
      'redeven.monitor',
    ]);
    expect(layout.sticky_notes).toHaveLength(4);
    expect(layout.annotations).toHaveLength(1);
    expect(layout.background_layers).toHaveLength(1);
  });

  it('uses widget catalog default Add sizes for Files, Terminal, and Monitoring', () => {
    const layout = createRedevenWorkbenchInitialLayout({
      widgetDefinitions,
      initialWidgetTypes,
      typeOrder: initialWidgetTypes,
      createdAtUnixMs: 0,
    });

    for (const widget of layout.widgets) {
      const definition = byType(widget.widget_type);
      expect({ width: widget.width, height: widget.height }).toEqual(definition.defaultSize);
    }
  });

  it('keeps sticky notes in a horizontal row below the welcome title and above the widget stage', () => {
    const layout = createRedevenWorkbenchInitialLayout({
      widgetDefinitions,
      initialWidgetTypes,
      typeOrder: initialWidgetTypes,
      createdAtUnixMs: 0,
    });
    const title = layout.annotations[0]!;
    const widgetTop = Math.min(...layout.widgets.map((widget) => widget.y));

    expect(title.text).toBe('🚀 Welcome to Redeven');
    expect(title.y + title.height).toBeLessThanOrEqual(Math.min(...layout.sticky_notes.map((note) => note.y)));
    expect(Math.max(...layout.sticky_notes.map((note) => note.y + note.height))).toBeLessThan(widgetTop);
    expect(new Set(layout.sticky_notes.map((note) => note.y)).size).toBe(1);
    expect(layout.sticky_notes.map((note) => note.color)).toEqual(['amber', 'sage', 'azure', 'coral']);
    expect(layout.sticky_notes.every((note) => /\p{Emoji}/u.test(note.body))).toBe(true);
    expect(layout.sticky_notes.some((note) => note.body.includes('<strong>'))).toBe(true);
    expect(layout.sticky_notes.some((note) => note.body.includes('<em>intentional</em>'))).toBe(true);
  });

  it('arranges core widgets as a low vertical-depth horizontal stage without overlap', () => {
    const layout = createRedevenWorkbenchInitialLayout({
      widgetDefinitions,
      initialWidgetTypes,
      typeOrder: initialWidgetTypes,
      createdAtUnixMs: 0,
    });

    expect(new Set(layout.widgets.map((widget) => widget.y)).size).toBe(1);
    for (const left of layout.widgets) {
      for (const right of layout.widgets) {
        if (left.widget_id === right.widget_id) continue;
        const overlaps = left.x < right.x + right.width
          && left.x + left.width > right.x
          && left.y < right.y + right.height
          && left.y + left.height > right.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('draws one welcome region that covers title, sticky notes, and core widgets', () => {
    const layout = createRedevenWorkbenchInitialLayout({
      widgetDefinitions,
      initialWidgetTypes,
      typeOrder: initialWidgetTypes,
      createdAtUnixMs: 0,
    });
    const region = layout.background_layers[0]!;
    const objects = [
      ...layout.widgets.map((widget) => ({
        x: widget.x,
        y: widget.y,
        width: widget.width,
        height: widget.height,
      })),
      ...layout.sticky_notes,
      ...layout.annotations,
    ];

    expect(region.name).toBe('Welcome Region');
    expect(region.material).toBe('glass');
    for (const object of objects) {
      expect(region.x).toBeLessThanOrEqual(object.x);
      expect(region.y).toBeLessThanOrEqual(object.y);
      expect(region.x + region.width).toBeGreaterThanOrEqual(object.x + object.width);
      expect(region.y + region.height).toBeGreaterThanOrEqual(object.y + object.height);
    }
  });

  it('skips missing core widget definitions instead of creating invalid layout entries', () => {
    const preset = createRedevenWorkbenchCanvasPreset({
      widgetDefinitions: widgetDefinitions.filter((definition) => definition.type !== 'redeven.monitor'),
      initialWidgetTypes,
      createdAtUnixMs: 0,
    });

    expect(preset.canvas.widgets.map((widget) => widget.widget_type)).toEqual([
      'redeven.files',
      'redeven.terminal',
    ]);
  });

  it('does not include contextual preview widgets in the first-run preset', () => {
    const layout = createRedevenWorkbenchInitialLayout({
      widgetDefinitions,
      initialWidgetTypes,
      typeOrder: initialWidgetTypes,
      createdAtUnixMs: 0,
    });

    expect(layout.widgets.some((widget) => widget.widget_type === 'redeven.preview')).toBe(false);
  });
});
