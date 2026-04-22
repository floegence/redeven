// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedevenWorkbenchSurface, type RedevenWorkbenchSurfaceApi } from './RedevenWorkbenchSurface';
import {
  REDEVEN_WORKBENCH_SURFACE_ROOT_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
} from './workbenchInputRouting';

const upstreamApiMocks = vi.hoisted(() => ({
  widget: {
    id: 'widget-files-1',
    type: 'redeven.files',
    title: 'Files',
    x: 40,
    y: 32,
    width: 720,
    height: 520,
    z_index: 1,
    created_at_unix_ms: 1,
  },
  ensureWidget: vi.fn(),
  createWidget: vi.fn(),
  clearSelection: vi.fn(),
  focusWidget: vi.fn(),
  fitWidget: vi.fn(),
  overviewWidget: vi.fn(),
  findWidgetByType: vi.fn(),
  findWidgetById: vi.fn(),
  updateWidgetTitle: vi.fn(),
}));

const sharedSurfaceMocks = vi.hoisted(() => ({
  lastProps: null as any,
}));

vi.mock('@floegence/floe-webapp-core/workbench', () => ({
  WorkbenchSurface: (props: any) => {
    sharedSurfaceMocks.lastProps = props;
    props.onApiReady?.({
      ensureWidget: upstreamApiMocks.ensureWidget,
      createWidget: upstreamApiMocks.createWidget,
      clearSelection: upstreamApiMocks.clearSelection,
      focusWidget: upstreamApiMocks.focusWidget,
      fitWidget: upstreamApiMocks.fitWidget,
      overviewWidget: upstreamApiMocks.overviewWidget,
      findWidgetByType: upstreamApiMocks.findWidgetByType,
      findWidgetById: upstreamApiMocks.findWidgetById,
      updateWidgetTitle: upstreamApiMocks.updateWidgetTitle,
    });
    return <div data-testid="mock-workbench-surface" />;
  },
}));

function createWorkbenchState(): any {
  return {
    version: 1,
    widgets: [],
    viewport: { x: 0, y: 0, scale: 1 },
    locked: false,
    filters: { 'redeven.files': true },
    selectedWidgetId: null,
    theme: 'mica',
  };
}

describe('RedevenWorkbenchSurface', () => {
  afterEach(() => {
    sharedSurfaceMocks.lastProps = null;
    Object.values(upstreamApiMocks).forEach((value) => {
      if (typeof value === 'function' && 'mockReset' in value) {
        value.mockReset();
      }
    });
    document.body.innerHTML = '';
  });

  it('forwards the shared launcher contract and Redeven interaction adapter', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <RedevenWorkbenchSurface
        state={() => createWorkbenchState()}
        setState={() => {}}
        filterBarWidgetTypes={['redeven.files', 'redeven.terminal']}
        onRequestDelete={vi.fn()}
        onLayoutInteractionStart={vi.fn()}
        onLayoutInteractionEnd={vi.fn()}
      />
    ), host);

    expect(sharedSurfaceMocks.lastProps).toMatchObject({
      launcherWidgetTypes: ['redeven.files', 'redeven.terminal'],
    });
    expect(sharedSurfaceMocks.lastProps.interactionAdapter.surfaceRootAttr).toBe(
      REDEVEN_WORKBENCH_SURFACE_ROOT_ATTR
    );
    expect(sharedSurfaceMocks.lastProps.interactionAdapter.widgetRootAttr).toBe(
      REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR
    );
    expect(sharedSurfaceMocks.lastProps.interactionAdapter.widgetIdAttr).toBe(
      REDEVEN_WORKBENCH_WIDGET_ID_ATTR
    );
  });

  it('maps the shared overview api to the local unfocusWidget alias', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    let capturedApi: RedevenWorkbenchSurfaceApi | null = null;

    render(() => (
      <RedevenWorkbenchSurface
        state={() => createWorkbenchState()}
        setState={() => {}}
        onApiReady={(api) => {
          capturedApi = api;
        }}
      />
    ), host);

    expect(capturedApi).toBeTruthy();
    capturedApi!.unfocusWidget(upstreamApiMocks.widget as any);

    expect(upstreamApiMocks.overviewWidget).toHaveBeenCalledWith(upstreamApiMocks.widget);
  });

  it('preserves the shared api surface for create/find/title flows', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    let capturedApi: RedevenWorkbenchSurfaceApi | null = null;

    render(() => (
      <RedevenWorkbenchSurface
        state={() => createWorkbenchState()}
        setState={() => {}}
        onApiReady={(api) => {
          capturedApi = api;
        }}
      />
    ), host);

    capturedApi!.createWidget('redeven.files', { centerViewport: false });
    capturedApi!.findWidgetById('widget-files-1');
    capturedApi!.updateWidgetTitle('widget-files-1', 'README.md');

    expect(upstreamApiMocks.createWidget).toHaveBeenCalledWith('redeven.files', {
      centerViewport: false,
    });
    expect(upstreamApiMocks.findWidgetById).toHaveBeenCalledWith('widget-files-1');
    expect(upstreamApiMocks.updateWidgetTitle).toHaveBeenCalledWith(
      'widget-files-1',
      'README.md'
    );
  });
});
