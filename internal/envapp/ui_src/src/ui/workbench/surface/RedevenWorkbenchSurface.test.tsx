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
    fitWidget: vi.fn((nextWidget: any) => nextWidget),
    overviewWidget: vi.fn((nextWidget: any) => nextWidget),
    ensureWidget: vi.fn(() => widget),
    deleteSelected: vi.fn(),
    clearSelection: vi.fn(),
    setCanvasFrameRef: vi.fn(),
  };
});

const surfaceMocks = vi.hoisted(() => ({
  contextMenuState: null as any,
  contextMenuItems: [] as any[],
  contextMenuProps: null as any,
  contextMenuClose: vi.fn(),
  canvasProps: null as any,
  hudProps: null as any,
}));

const TEST_WORKBENCH_FILTERS = {
  terminal: true,
  'file-browser': true,
  'system-monitor': true,
  'log-viewer': true,
  'code-editor': true,
} as const;

function dispatchPointerDown(target: EventTarget): void {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor('pointerdown', {
    bubbles: true,
    button: 0,
  });
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', { configurable: true, value: 1 });
  }
  target.dispatchEvent(event);
}

vi.mock('@floegence/floe-webapp-core/workbench', () => ({
  WorkbenchContextMenu: (props: any) => {
    surfaceMocks.contextMenuProps = props;
    return (
      <div
        data-testid="mock-context-menu"
        data-floe-workbench-context-menu="true"
      >
        {props.items.map((item: any) => item.id).join(',')}
      </div>
    );
  },
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
      state: () => surfaceMocks.contextMenuState,
      items: () => surfaceMocks.contextMenuItems,
      position: () => undefined,
      close: surfaceMocks.contextMenuClose,
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
      fitWidget: modelMocks.fitWidget,
      overviewWidget: modelMocks.overviewWidget,
    },
    selection: {
      clear: modelMocks.clearSelection,
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
      {(() => {
        surfaceMocks.canvasProps = props;
        return null;
      })()}
      <button
        type="button"
        data-testid="mock-blank-canvas"
        onPointerDown={(event) => props.onCanvasPointerDown?.(event)}
      >
        Blank canvas
      </button>
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
  RedevenWorkbenchHud: (props: any) => {
    surfaceMocks.hudProps = props;
    return null;
  },
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
    modelMocks.fitWidget.mockReset();
    modelMocks.fitWidget.mockImplementation((nextWidget: any) => nextWidget);
    modelMocks.overviewWidget.mockReset();
    modelMocks.overviewWidget.mockImplementation((nextWidget: any) => nextWidget);
    modelMocks.ensureWidget.mockReset();
    modelMocks.ensureWidget.mockImplementation(() => modelMocks.widget);
    modelMocks.deleteSelected.mockReset();
    modelMocks.clearSelection.mockReset();
    modelMocks.setCanvasFrameRef.mockReset();
    surfaceMocks.contextMenuState = null;
    surfaceMocks.contextMenuItems = [];
    surfaceMocks.contextMenuProps = null;
    surfaceMocks.contextMenuClose.mockReset();
    surfaceMocks.canvasProps = null;
    surfaceMocks.hudProps = null;
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

  it('exposes fit, overview, and clear-selection surface api helpers', async () => {
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
    api.fitWidget(modelMocks.widget);
    api.unfocusWidget(modelMocks.widget);
    api.clearSelection();
    await Promise.resolve();

    expect(modelMocks.fitWidget).toHaveBeenCalledWith(modelMocks.widget);
    expect(modelMocks.overviewWidget).toHaveBeenCalledWith(modelMocks.widget);
    expect(modelMocks.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('exposes workbench appearance attributes on the surface root', async () => {
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
        appearance={{ tone: 'ivory', texture: 'pin_dot' }}
      />
    ), host);

    const surfaceRoot = host.querySelector('.redeven-workbench-surface') as HTMLElement | null;
    expect(surfaceRoot?.getAttribute('data-redeven-workbench-tone')).toBe('ivory');
    expect(surfaceRoot?.getAttribute('data-redeven-workbench-texture')).toBe('pin_dot');
  });

  it('forwards background appearance controls into the hud', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onToneSelect = vi.fn();
    const onTextureSelect = vi.fn();
    const onResetAppearance = vi.fn();

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
        appearance={{ tone: 'mist', texture: 'grid' }}
        onToneSelect={onToneSelect}
        onTextureSelect={onTextureSelect}
        onResetAppearance={onResetAppearance}
      />
    ), host);

    expect(surfaceMocks.hudProps).toMatchObject({
      scaleLabel: '100%',
      appearance: { tone: 'mist', texture: 'grid' },
      onToneSelect,
      onTextureSelect,
      onResetAppearance,
    });
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

  it('filters programmatic widget types out of the manual add context menu', () => {
    surfaceMocks.contextMenuState = {
      clientX: 32,
      clientY: 48,
      worldX: 120,
      worldY: 160,
    };
    surfaceMocks.contextMenuItems = [
      { id: 'add-redeven.files', kind: 'action', label: 'Add Files' },
      { id: 'add-redeven.preview', kind: 'action', label: 'Add Preview' },
      { id: 'add-redeven.terminal', kind: 'action', label: 'Add Terminal' },
    ];

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
        filterBarWidgetTypes={['redeven.files', 'redeven.terminal']}
      />
    ), host);

    const contextMenu = document.querySelector('[data-testid="mock-context-menu"]');
    expect(contextMenu?.textContent).toContain('add-redeven.files');
    expect(contextMenu?.textContent).toContain('add-redeven.terminal');
    expect(contextMenu?.textContent).not.toContain('add-redeven.preview');
  });

  it('clears the current selection when blank canvas is pressed', () => {
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
          selectedWidgetId: 'widget-files-1',
        })}
        setState={() => {}}
        widgetDefinitions={[]}
      />
    ), host);

    const blankCanvas = host.querySelector('[data-testid="mock-blank-canvas"]') as HTMLButtonElement | null;
    expect(blankCanvas).toBeTruthy();

    dispatchPointerDown(blankCanvas!);

    expect(modelMocks.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('closes the workbench menu only when pointerdown lands outside the menu boundary', () => {
    surfaceMocks.contextMenuState = {
      clientX: 32,
      clientY: 48,
      worldX: 120,
      worldY: 160,
    };
    surfaceMocks.contextMenuItems = [
      { id: 'add-redeven.files', kind: 'action', label: 'Add Files' },
    ];

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

    const menu = document.querySelector('[data-testid="mock-context-menu"]') as HTMLElement | null;
    expect(menu).toBeTruthy();

    dispatchPointerDown(menu!);
    expect(surfaceMocks.contextMenuClose).not.toHaveBeenCalled();

    dispatchPointerDown(document.body);
    expect(surfaceMocks.contextMenuClose).toHaveBeenCalledTimes(1);
  });
});
