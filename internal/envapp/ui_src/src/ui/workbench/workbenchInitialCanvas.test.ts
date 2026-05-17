import { describe, expect, it } from 'vitest';
import type { WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';

import { createRedevenWorkbenchInitialLayout } from './workbenchInitialCanvas';

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
    type: 'redeven.preview',
    label: 'Preview',
    icon: () => null,
    body: () => null,
    defaultTitle: 'Preview',
    defaultSize: { width: 1080, height: 700 },
    singleton: false,
  },
] as const satisfies readonly WorkbenchWidgetDefinition[];

describe('workbenchInitialCanvas', () => {
  it('creates one initial widget per configured type using definition default sizes', () => {
    const layout = createRedevenWorkbenchInitialLayout({
      widgetDefinitions,
      initialWidgetTypes: ['redeven.files', 'redeven.terminal', 'redeven.files'],
      typeOrder: ['redeven.files', 'redeven.terminal'],
      createdAtUnixMs: 1_700_000_000_000,
    });

    expect(layout.widgets).toHaveLength(2);
    expect(layout.widgets.map((widget) => widget.widget_type)).toEqual([
      'redeven.files',
      'redeven.terminal',
    ]);
    expect(layout.widgets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        widget_id: 'widget-initial-files',
        widget_type: 'redeven.files',
        width: 1080,
        height: 700,
        z_index: 1,
        created_at_unix_ms: 1_700_000_000_000,
      }),
      expect.objectContaining({
        widget_id: 'widget-initial-terminal',
        widget_type: 'redeven.terminal',
        width: 1120,
        height: 680,
        z_index: 2,
        created_at_unix_ms: 1_700_000_000_001,
      }),
    ]));
  });

  it('does not include contextual preview widgets unless explicitly configured', () => {
    const layout = createRedevenWorkbenchInitialLayout({
      widgetDefinitions,
      initialWidgetTypes: ['redeven.files', 'redeven.terminal'],
      typeOrder: ['redeven.files', 'redeven.terminal', 'redeven.preview'],
      createdAtUnixMs: 0,
    });

    expect(layout.widgets.some((widget) => widget.widget_type === 'redeven.preview')).toBe(false);
  });

  it('arranges initial widgets without overlap', () => {
    const layout = createRedevenWorkbenchInitialLayout({
      widgetDefinitions,
      initialWidgetTypes: ['redeven.files', 'redeven.terminal'],
      typeOrder: ['redeven.files', 'redeven.terminal'],
      createdAtUnixMs: 0,
    });
    const [left, right] = layout.widgets;
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(
      left!.x < right!.x + right!.width
      && left!.x + left!.width > right!.x
      && left!.y < right!.y + right!.height
      && left!.y + left!.height > right!.y,
    ).toBe(false);
  });
});
