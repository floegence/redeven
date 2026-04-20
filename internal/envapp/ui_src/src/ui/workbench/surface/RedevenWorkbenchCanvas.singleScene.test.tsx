// @vitest-environment jsdom

import { createEffect } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchWidgetBodyProps, WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
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

const observedSurfaceMetrics = new Map<string, unknown[]>();

function rememberSurfaceMetrics(props: WorkbenchWidgetBodyProps) {
  createEffect(() => {
    const bucket = observedSurfaceMetrics.get(props.widgetId) ?? [];
    bucket.push(props.surfaceMetrics);
    observedSurfaceMetrics.set(props.widgetId, bucket);
  });
}

const widgetDefinitions: readonly WorkbenchWidgetDefinition[] = [
  {
    type: 'redeven.files',
    label: 'Files',
    icon: () => null,
    body: (props) => {
      rememberSurfaceMetrics(props);
      return <div data-testid="files-body">Files</div>;
    },
    defaultTitle: 'Files',
    defaultSize: { width: 760, height: 560 },
  },
  {
    type: 'redeven.preview',
    label: 'Preview',
    icon: () => null,
    body: (props) => {
      rememberSurfaceMetrics(props);
      return <div data-testid="preview-body">Preview</div>;
    },
    defaultTitle: 'Preview',
    defaultSize: { width: 900, height: 620 },
  },
];

const widgetFilters = createWorkbenchFilterState(widgetDefinitions);

describe('RedevenWorkbenchCanvas single-scene geometry', () => {
  afterEach(() => {
    observedSurfaceMetrics.clear();
    document.body.innerHTML = '';
  });

  it('renders ordinary workbench widgets inside the shared canvas scene without projected geometry props', async () => {
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
            id: 'widget-preview',
            type: 'redeven.preview',
            title: 'Preview',
            x: 480,
            y: 96,
            width: 900,
            height: 620,
            z_index: 1,
            created_at_unix_ms: 1,
          },
        ]}
        viewport={{ x: 120, y: 40, scale: 1.25 }}
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
    const filesWidget = host.querySelector('[data-floe-workbench-widget-id="widget-files"]') as HTMLElement | null;
    const previewWidget = host.querySelector('[data-floe-workbench-widget-id="widget-preview"]') as HTMLElement | null;

    expect(projectedLayer).toBeNull();
    expect(viewport?.contains(filesWidget!)).toBe(true);
    expect(viewport?.contains(previewWidget!)).toBe(true);
    expect(filesWidget?.style.transform).toBe('translate(30px, 18px)');
    expect(previewWidget?.style.transform).toBe('translate(480px, 96px)');
    expect(filesWidget?.getAttribute('data-floe-workbench-render-mode')).toBeNull();
    expect(previewWidget?.getAttribute('data-floe-workbench-render-mode')).toBeNull();
    expect(observedSurfaceMetrics.get('widget-files')?.at(-1)).toBeUndefined();
    expect(observedSurfaceMetrics.get('widget-preview')?.at(-1)).toBeUndefined();

    dispose();
  });
});
