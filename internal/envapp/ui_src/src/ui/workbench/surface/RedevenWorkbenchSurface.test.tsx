// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedevenWorkbenchSurface, type RedevenWorkbenchSurfaceApi } from './RedevenWorkbenchSurface';

const modelMocks = vi.hoisted(() => {
  const widget = {
    id: 'widget-files-1',
    type: 'redeven.files',
    title: 'Files',
    x: 40,
    y: 32,
    width: 720,
    height: 520,
    z_index: 1,
    created_at_unix_ms: 1,
  };

  return {
    widget,
    handleArrowNavigation: vi.fn(),
    focusWidget: vi.fn((nextWidget: any) => nextWidget),
    ensureWidget: vi.fn(() => widget),
    deleteSelected: vi.fn(),
    setCanvasFrameRef: vi.fn(),
  };
});

const TEST_WORKBENCH_FILTERS = {
  terminal: true,
  'file-browser': true,
  'system-monitor': true,
  'log-viewer': true,
  'code-editor': true,
} as const;

vi.mock('@floegence/floe-webapp-core/workbench', () => ({
  WorkbenchContextMenu: () => null,
  useWorkbenchModel: () => ({
    widgets: () => [modelMocks.widget],
    viewport: () => ({ x: 0, y: 0, scale: 1 }),
    locked: () => false,
    filters: () => ({ 'redeven.files': true }),
    selectedWidgetId: () => modelMocks.widget.id,
    topZIndex: () => 1,
    scaleLabel: () => '100%',
    optimisticFrontWidgetId: () => null,
    widgetDefinitions: () => [],
    contextMenu: {
      state: () => null,
      items: () => [],
      position: () => undefined,
      close: vi.fn(),
      retarget: vi.fn(),
    },
    canvas: {
      commitViewport: vi.fn(),
      openCanvasContextMenu: vi.fn(),
      selectWidget: vi.fn(),
      openWidgetContextMenu: vi.fn(),
      startOptimisticFront: vi.fn(),
      commitFront: vi.fn(),
      commitMove: vi.fn(),
      commitResize: vi.fn(),
    },
    hud: {
      zoomOut: vi.fn(),
      zoomIn: vi.fn(),
    },
    lock: {
      toggle: vi.fn(),
    },
    filter: {
      solo: vi.fn(),
      showAll: vi.fn(),
    },
    navigation: {
      handleArrowNavigation: modelMocks.handleArrowNavigation,
      centerOnWidget: vi.fn(),
      focusWidget: modelMocks.focusWidget,
    },
    widgetActions: {
      ensureWidget: modelMocks.ensureWidget,
      deleteSelected: modelMocks.deleteSelected,
      deleteWidget: vi.fn(),
      addWidget: vi.fn(),
      addWidgetAtCursor: vi.fn(),
      addWidgetCentered: vi.fn(),
    },
    queries: {
      findWidgetByType: vi.fn(() => modelMocks.widget),
      findWidgetById: vi.fn(() => modelMocks.widget),
    },
    setCanvasFrameRef: modelMocks.setCanvasFrameRef,
    handleCloseRequest: vi.fn(),
  }),
}));

vi.mock('./RedevenWorkbenchCanvas', () => ({
  RedevenWorkbenchCanvas: (props: any) => (
    <div
      class="workbench-canvas"
      ref={(el) => {
        props.setCanvasFrameRef?.(el);
      }}
      data-testid="mock-canvas"
    >
      <article
        data-redeven-workbench-widget-root="true"
        data-redeven-workbench-widget-id="widget-files-1"
        tabIndex={0}
      >
        Files
      </article>
    </div>
  ),
}));

vi.mock('./RedevenWorkbenchFilterBar', () => ({
  RedevenWorkbenchFilterBar: () => null,
}));

vi.mock('./RedevenWorkbenchHud', () => ({
  RedevenWorkbenchHud: () => null,
}));

vi.mock('./RedevenWorkbenchLockButton', () => ({
  RedevenWorkbenchLockButton: () => null,
}));

describe('RedevenWorkbenchSurface', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    modelMocks.handleArrowNavigation.mockReset();
    modelMocks.focusWidget.mockReset();
    modelMocks.focusWidget.mockImplementation((nextWidget: any) => nextWidget);
    modelMocks.ensureWidget.mockReset();
    modelMocks.ensureWidget.mockImplementation(() => modelMocks.widget);
    modelMocks.deleteSelected.mockReset();
    modelMocks.setCanvasFrameRef.mockReset();
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  it('focuses the widget root when the surface api focuses a widget', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    let capturedApi: RedevenWorkbenchSurfaceApi | null = null;

    dispose = render(() => (
      <RedevenWorkbenchSurface
        state={() => ({
          version: 1,
          widgets: [],
          viewport: { x: 0, y: 0, scale: 1 },
          locked: false,
          filters: TEST_WORKBENCH_FILTERS,
          selectedWidgetId: null,
        })}
        setState={() => {}}
        widgetDefinitions={[]}
        onApiReady={(api) => {
          capturedApi = api;
        }}
      />
    ), host);

    expect(capturedApi).toBeTruthy();
    const api = capturedApi!;
    modelMocks.setCanvasFrameRef.mockClear();
    api.focusWidget(modelMocks.widget, { centerViewport: false });
    await Promise.resolve();

    const widgetRoot = host.querySelector('[data-redeven-workbench-widget-root="true"]');
    expect(document.activeElement).toBe(widgetRoot);
    expect(modelMocks.focusWidget).toHaveBeenCalledWith(modelMocks.widget, { centerViewport: false });
    expect(modelMocks.setCanvasFrameRef).not.toHaveBeenCalled();
  });

  it('delegates ensureWidget without an extra canvas measurement refresh', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    let capturedApi: RedevenWorkbenchSurfaceApi | null = null;

    dispose = render(() => (
      <RedevenWorkbenchSurface
        state={() => ({
          version: 1,
          widgets: [],
          viewport: { x: 0, y: 0, scale: 1 },
          locked: false,
          filters: TEST_WORKBENCH_FILTERS,
          selectedWidgetId: null,
        })}
        setState={() => {}}
        widgetDefinitions={[]}
        onApiReady={(api) => {
          capturedApi = api;
        }}
      />
    ), host);

    modelMocks.setCanvasFrameRef.mockClear();

    const api = capturedApi!;
    api.ensureWidget('redeven.files', { centerViewport: true });

    expect(modelMocks.setCanvasFrameRef).not.toHaveBeenCalled();
    expect(modelMocks.ensureWidget).toHaveBeenCalledWith('redeven.files', { centerViewport: true });
  });

  it('does not trigger global arrow navigation when a widget root owns focus', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    let capturedApi: RedevenWorkbenchSurfaceApi | null = null;

    dispose = render(() => (
      <RedevenWorkbenchSurface
        state={() => ({
          version: 1,
          widgets: [],
          viewport: { x: 0, y: 0, scale: 1 },
          locked: false,
          filters: TEST_WORKBENCH_FILTERS,
          selectedWidgetId: null,
        })}
        setState={() => {}}
        widgetDefinitions={[]}
        onApiReady={(api) => {
          capturedApi = api;
        }}
      />
    ), host);

    const api = capturedApi!;
    api.focusWidget(modelMocks.widget, { centerViewport: false });
    await Promise.resolve();

    const widgetRoot = host.querySelector('[data-redeven-workbench-widget-root="true"]') as HTMLElement | null;
    expect(widgetRoot).toBeTruthy();
    widgetRoot!.focus();
    widgetRoot!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    modelMocks.setCanvasFrameRef.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(modelMocks.handleArrowNavigation).not.toHaveBeenCalled();
    expect(modelMocks.setCanvasFrameRef).not.toHaveBeenCalled();
  });

  it('delegates global arrow navigation without an extra canvas measurement refresh', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    dispose = render(() => (
      <RedevenWorkbenchSurface
        state={() => ({
          version: 1,
          widgets: [],
          viewport: { x: 0, y: 0, scale: 1 },
          locked: false,
          filters: TEST_WORKBENCH_FILTERS,
          selectedWidgetId: null,
        })}
        setState={() => {}}
        widgetDefinitions={[]}
      />
    ), host);

    modelMocks.setCanvasFrameRef.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(modelMocks.setCanvasFrameRef).not.toHaveBeenCalled();
    expect(modelMocks.handleArrowNavigation).toHaveBeenCalledWith('right');
  });
});
