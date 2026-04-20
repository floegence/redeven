// @vitest-environment jsdom

import { createEffect } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkbenchWidgetDefinition,
  WorkbenchWidgetSurfaceMetrics,
} from '@floegence/floe-webapp-core/workbench';
import { createWorkbenchFilterState } from '@floegence/floe-webapp-core/workbench';

import { RedevenWorkbenchCanvas } from './RedevenWorkbenchCanvas';

vi.mock('./RedevenInfiniteCanvas', () => ({
  RedevenInfiniteCanvas: (props: any) => (
    <div data-testid="mock-redeven-infinite-canvas">
      <div data-testid="mock-redeven-infinite-canvas-viewport">
        {props.children}
      </div>
      {props.overlay?.(props.viewport)}
    </div>
  ),
}));

const observedProjectedMetrics: WorkbenchWidgetSurfaceMetrics[] = [];

const widgetDefinitions: readonly WorkbenchWidgetDefinition[] = [
  {
    type: 'redeven.files',
    label: 'Files',
    icon: () => null,
    body: (props) => {
      createEffect(() => {
        if (props.surfaceMetrics) {
          observedProjectedMetrics.push(props.surfaceMetrics);
        }
      });
      return <div data-testid="files-body">Files</div>;
    },
    defaultTitle: 'Files',
    defaultSize: { width: 760, height: 560 },
    renderMode: 'projected_surface',
  },
  {
    type: 'redeven.monitor',
    label: 'Monitoring',
    icon: () => null,
    body: (props) => {
      createEffect(() => {
        if (props.surfaceMetrics) {
          observedProjectedMetrics.push(props.surfaceMetrics);
        }
      });
      return <div data-testid="monitor-body">Monitoring</div>;
    },
    defaultTitle: 'Monitoring',
    defaultSize: { width: 420, height: 300 },
  },
];

const widgetFilters = createWorkbenchFilterState(widgetDefinitions);

describe('RedevenWorkbenchCanvas projected surfaces', () => {
  afterEach(() => {
    observedProjectedMetrics.length = 0;
    document.body.innerHTML = '';
  });

  it('keeps projected widgets out of the scaled viewport while exposing projected metrics', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <RedevenWorkbenchCanvas
        widgetDefinitions={widgetDefinitions}
        widgets={[
          {
            id: 'widget-files',
            type: 'redeven.files',
            title: 'Files',
            x: 30,
            y: 18,
            width: 760,
            height: 560,
            z_index: 2,
            created_at_unix_ms: 2,
          },
          {
            id: 'widget-monitor',
            type: 'redeven.monitor',
            title: 'Monitoring',
            x: 480,
            y: 96,
            width: 420,
            height: 300,
            z_index: 1,
            created_at_unix_ms: 1,
          },
        ]}
        viewport={{ x: 120, y: 40, scale: 1.25 }}
        canvasFrameSize={{ width: 1440, height: 900 }}
        selectedWidgetId="widget-files"
        optimisticFrontWidgetId={null}
        locked={false}
        filters={widgetFilters}
        setCanvasFrameRef={() => {}}
        onViewportCommit={vi.fn()}
        onCanvasContextMenu={vi.fn()}
        onSelectWidget={vi.fn()}
        onWidgetContextMenu={vi.fn()}
        onStartOptimisticFront={vi.fn()}
        onCommitFront={vi.fn()}
        onCommitMove={vi.fn()}
        onCommitResize={vi.fn()}
        onRequestDelete={vi.fn()}
      />
    ), host);

    await Promise.resolve();

    const viewport = host.querySelector('[data-testid="mock-redeven-infinite-canvas-viewport"]') as HTMLElement | null;
    const projectedLayer = host.querySelector('.workbench-canvas__projected-layer') as HTMLElement | null;
    const projectedWidget = host.querySelector(
      '[data-floe-workbench-widget-id="widget-files"]'
    ) as HTMLElement | null;
    const canvasWidget = host.querySelector(
      '[data-floe-workbench-widget-id="widget-monitor"]'
    ) as HTMLElement | null;

    expect(viewport?.contains(canvasWidget!)).toBe(true);
    expect(viewport?.contains(projectedWidget!)).toBe(false);
    expect(projectedLayer?.contains(projectedWidget!)).toBe(true);
    expect(projectedWidget?.dataset.floeWorkbenchRenderMode).toBe('projected_surface');
    expect(projectedWidget?.style.left).toBe('157.5px');
    expect(projectedWidget?.style.top).toBe('62.5px');
    expect(projectedWidget?.getAttribute('style')).toContain('--floe-workbench-projected-scale: 1.25;');

    expect(observedProjectedMetrics.at(-1)).toEqual({
      ready: true,
      rect: {
        widgetId: 'widget-files',
        worldX: 30,
        worldY: 18,
        worldWidth: 760,
        worldHeight: 560,
        screenX: 157.5,
        screenY: 62.5,
        screenWidth: 950,
        screenHeight: 700,
        viewportScale: 1.25,
      },
    });

    dispose();
  });
});
