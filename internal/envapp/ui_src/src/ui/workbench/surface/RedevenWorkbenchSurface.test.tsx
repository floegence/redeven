// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKBENCH_TEXT_FONT_OPTIONS } from '@floegence/floe-webapp-core/workbench';

import { RedevenWorkbenchSurface, type RedevenWorkbenchSurfaceApi } from './RedevenWorkbenchSurface';
import {
  REDEVEN_WORKBENCH_SURFACE_ROOT_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
} from './workbenchInputRouting';

const sansTextFont = WORKBENCH_TEXT_FONT_OPTIONS.find((option) => option.id === 'sans') ?? WORKBENCH_TEXT_FONT_OPTIONS[0]!;

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
  createStickyNote: vi.fn(),
  findStickyNoteById: vi.fn(),
  updateStickyNote: vi.fn(),
  deleteStickyNote: vi.fn(),
  createTextAnnotation: vi.fn(),
  findAnnotationById: vi.fn(),
  updateTextAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
  createBackgroundLayer: vi.fn(),
  findBackgroundLayerById: vi.fn(),
  updateBackgroundLayer: vi.fn(),
  deleteBackgroundLayer: vi.fn(),
}));

const sharedSurfaceMocks = vi.hoisted(() => ({
  lastProps: null as any,
}));

vi.mock('@floegence/floe-webapp-core/workbench', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@floegence/floe-webapp-core/workbench')>()),
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
      createStickyNote: upstreamApiMocks.createStickyNote,
      findStickyNoteById: upstreamApiMocks.findStickyNoteById,
      updateStickyNote: upstreamApiMocks.updateStickyNote,
      deleteStickyNote: upstreamApiMocks.deleteStickyNote,
      createTextAnnotation: upstreamApiMocks.createTextAnnotation,
      findAnnotationById: upstreamApiMocks.findAnnotationById,
      updateTextAnnotation: upstreamApiMocks.updateTextAnnotation,
      deleteAnnotation: upstreamApiMocks.deleteAnnotation,
      createBackgroundLayer: upstreamApiMocks.createBackgroundLayer,
      findBackgroundLayerById: upstreamApiMocks.findBackgroundLayerById,
      updateBackgroundLayer: upstreamApiMocks.updateBackgroundLayer,
      deleteBackgroundLayer: upstreamApiMocks.deleteBackgroundLayer,
    });
    return (
      <div data-testid="mock-workbench-surface">
        <div class="workbench-canvas__projected-layer" data-testid="projected-layer" />
        <div
          data-floe-workbench-canvas-frame="true"
          ref={(el) => {
            if (!el) return;
            Object.defineProperty(el, 'getBoundingClientRect', {
              configurable: true,
              value: () => ({
                left: 0,
                top: 0,
                right: 960,
                bottom: 640,
                width: 960,
                height: 640,
                x: 0,
                y: 0,
                toJSON: () => undefined,
              }),
            });
          }}
        />
      </div>
    );
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
    expect(sharedSurfaceMocks.lastProps.textAnnotationDefaults).toEqual({
      font_family: sansTextFont.fontFamily,
      font_weight: sansTextFont.fontWeight,
      font_size: 45,
      width: 460,
    });
  });

  it('allows callers to override shared text annotation defaults', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <RedevenWorkbenchSurface
        state={() => createWorkbenchState()}
        setState={() => {}}
        textAnnotationDefaults={{
          font_family: 'Serif',
          font_size: 32,
          width: 320,
        }}
      />
    ), host);

    expect(sharedSurfaceMocks.lastProps.textAnnotationDefaults).toEqual({
      font_family: 'Serif',
      font_size: 32,
      width: 320,
    });
  });

  it('forwards the context-menu item resolver to the shared surface', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const resolveContextMenuItems = vi.fn((context: any) => context.items);

    render(() => (
      <RedevenWorkbenchSurface
        state={() => createWorkbenchState()}
        setState={() => {}}
        resolveContextMenuItems={resolveContextMenuItems}
      />
    ), host);

    expect(sharedSurfaceMocks.lastProps.resolveContextMenuItems).toBe(resolveContextMenuItems);
  });

  it('keeps the projected layer anchored when browser focus scrolls it', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <RedevenWorkbenchSurface
        state={() => createWorkbenchState()}
        setState={() => {}}
      />
    ), host);
    await Promise.resolve();

    const layer = host.querySelector('[data-testid="projected-layer"]') as HTMLDivElement | null;
    expect(layer).toBeTruthy();

    layer!.scrollTop = 275;
    layer!.scrollLeft = 19;
    layer!.dispatchEvent(new Event('scroll'));

    expect(layer!.scrollTop).toBe(0);
    expect(layer!.scrollLeft).toBe(0);
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
    capturedApi!.createTextAnnotation({ worldX: 20, worldY: 30 });
    capturedApi!.createStickyNote({ worldX: 40, worldY: 50 });
    capturedApi!.createBackgroundLayer({ worldX: 60, worldY: 70 });

    expect(upstreamApiMocks.createWidget).toHaveBeenCalledWith('redeven.files', {
      centerViewport: false,
    });
    expect(upstreamApiMocks.findWidgetById).toHaveBeenCalledWith('widget-files-1');
    expect(upstreamApiMocks.updateWidgetTitle).toHaveBeenCalledWith(
      'widget-files-1',
      'README.md'
    );
    expect(upstreamApiMocks.createTextAnnotation).toHaveBeenCalledWith({
      worldX: 20,
      worldY: 30,
    });
    expect(upstreamApiMocks.createStickyNote).toHaveBeenCalledWith({
      worldX: 40,
      worldY: 50,
    });
    expect(upstreamApiMocks.createBackgroundLayer).toHaveBeenCalledWith({
      worldX: 60,
      worldY: 70,
    });
  });

  it('exposes a semantic overview entry api that clears selection and resets the viewport', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    let currentState = createWorkbenchState();
    const setState = vi.fn((updater: (prev: any) => any) => {
      currentState = updater(currentState);
    });
    let capturedApi: RedevenWorkbenchSurfaceApi | null = null;

    render(() => (
      <RedevenWorkbenchSurface
        state={() => currentState}
        setState={setState}
        onApiReady={(api) => {
          capturedApi = api;
        }}
      />
    ), host);

    currentState = {
      ...currentState,
      widgets: [
        {
          id: 'widget-files-1',
          type: 'redeven.files',
          title: 'Files',
          x: 100,
          y: 80,
          width: 300,
          height: 200,
          z_index: 1,
          created_at_unix_ms: 1,
        },
      ],
      selectedWidgetId: 'widget-files-1',
      selectedObject: { kind: 'sticky_note', id: 'note-1' },
    };

    capturedApi!.enterOverview();

    expect(upstreamApiMocks.clearSelection).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledTimes(1);
    expect(currentState.selectedWidgetId).toBeNull();
    expect(currentState.selectedObject).toBeNull();
    expect(currentState.viewport).toEqual({
      x: 367.5,
      y: 239,
      scale: 0.45,
    });
  });
});
