import { describe, expect, it } from 'vitest';
import type { WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';

import { createRedevenWorkbenchInitialLayout } from './workbenchInitialCanvas';
import { createRedevenWorkbenchCanvasPreset } from './workbenchInitialCanvasPreset';
import { createWorkbenchOverviewViewport } from './runtimeWorkbenchLayout';

const widgetDefinitions: WorkbenchWidgetDefinition[] = [
  ['redeven.files', 1200, 800], ['redeven.terminal', 1120, 780], ['redeven.monitor', 1040, 800], ['redeven.preview', 1080, 700],
].map(([type, width, height]) => ({
  type: String(type), label: String(type), defaultTitle: String(type), icon: () => null, body: () => null,
  defaultSize: { width: Number(width), height: Number(height) },
}));
const initialWidgetTypes = widgetDefinitions.map((widget) => widget.type);
const options = { widgetDefinitions, initialWidgetTypes, typeOrder: initialWidgetTypes, createdAtUnixMs: 1_700_000_000_000 };

describe('workbenchInitialCanvas', () => {
  it('keeps the complete welcome scene readable and inside a laptop overview', () => {
    const layout = createRedevenWorkbenchInitialLayout(options);
    const objects = [...layout.widgets, ...layout.sticky_notes, ...layout.annotations, ...layout.background_layers];
    const width = Math.max(...objects.map((item) => item.x + item.width)) - Math.min(...objects.map((item) => item.x));
    expect(width).toBeLessThanOrEqual(2600);
    const viewport = createWorkbenchOverviewViewport({
      widgets: layout.widgets.map((widget) => ({ ...widget, id: widget.widget_id, type: widget.widget_type, title: '' })),
      stickyNotes: layout.sticky_notes, annotations: layout.annotations, backgroundLayers: layout.background_layers,
      frameWidth: 1280, frameHeight: 759,
    });
    expect(viewport.scale).toBeGreaterThan(0.4);
    for (const object of objects) {
      expect(object.x * viewport.scale + viewport.x).toBeGreaterThanOrEqual(63);
      expect(object.y * viewport.scale + viewport.y).toBeGreaterThanOrEqual(63);
      expect((object.x + object.width) * viewport.scale + viewport.x).toBeLessThanOrEqual(1217);
      expect((object.y + object.height) * viewport.scale + viewport.y).toBeLessThanOrEqual(664);
    }
  });

  it('places usable core windows inside their regions without overlaps or changing Add sizes', () => {
    const before = widgetDefinitions.map((widget) => ({ ...widget.defaultSize }));
    const layout = createRedevenWorkbenchInitialLayout(options);
    expect(layout.widgets.map((widget) => widget.widget_type)).toEqual(['redeven.files', 'redeven.terminal', 'redeven.monitor']);
    const minimumContentSizes = [{ width: 800, height: 800 }, { width: 900, height: 400 }, { width: 900, height: 440 }];
    layout.widgets.forEach((widget, index) => {
      expect(widget.width).toBeGreaterThanOrEqual(minimumContentSizes[index].width);
      expect(widget.height).toBeGreaterThanOrEqual(minimumContentSizes[index].height);
    });
    expect(widgetDefinitions.map((widget) => widget.defaultSize)).toEqual(before);
    const windowsAndNotes = [...layout.widgets, ...layout.sticky_notes];
    for (const item of windowsAndNotes) {
      expect(layout.background_layers.some((region) => region.x < item.x && region.y < item.y
        && region.x + region.width > item.x + item.width && region.y + region.height > item.y + item.height)).toBe(true);
      for (const other of windowsAndNotes) {
        if (item === other) continue;
        expect(item.x < other.x + other.width && item.x + item.width > other.x
          && item.y < other.y + other.height && item.y + item.height > other.y).toBe(false);
      }
    }
    expect(layout.sticky_notes.every((note) => note.title && !/<\/?[a-z]/i.test(note.body))).toBe(true);
    expect(new Set(layout.sticky_notes.map((note) => note.material)).size).toBe(2);
    expect(new Set(layout.background_layers.map((region) => region.material)).size).toBe(3);
    expect(layout.background_layers.every((region) => region.name === '')).toBe(true);
  });

  it('skips unavailable or unrequested widgets and never creates contextual previews', () => {
    const preset = createRedevenWorkbenchCanvasPreset({
      ...options, widgetDefinitions: widgetDefinitions.filter((definition) => definition.type !== 'redeven.monitor'),
      initialWidgetTypes: ['redeven.files', 'redeven.monitor', 'redeven.preview'],
    });
    expect(preset.canvas.widgets.map((widget) => widget.widget_type)).toEqual(['redeven.files']);
  });
});
