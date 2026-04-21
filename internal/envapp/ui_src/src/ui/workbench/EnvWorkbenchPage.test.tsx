// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvWorkbenchPage } from './EnvWorkbenchPage';

const storageMocks = vi.hoisted(() => ({
  isDesktopStateStorageAvailable: vi.fn(() => false),
  readUIStorageJSON: vi.fn(() => null),
  writeUIStorageJSON: vi.fn(),
}));

const layoutApiMocks = vi.hoisted(() => ({
  getWorkbenchLayoutSnapshot: vi.fn(async (): Promise<any> => ({
    seq: 0,
    revision: 0,
    updated_at_unix_ms: 0,
    widgets: [] as any[],
  })),
  putWorkbenchLayout: vi.fn(async (input: any): Promise<any> => ({
    seq: Math.max(1, Number(input?.base_revision ?? 0) + 1),
    revision: Math.max(1, Number(input?.base_revision ?? 0) + 1),
    updated_at_unix_ms: 200,
    widgets: (input?.widgets ?? []) as any[],
  })),
  connectWorkbenchLayoutEventStream: vi.fn(async (args: any) => {
    layoutApiMocks.lastStreamArgs = args;
    await new Promise<void>((resolve) => {
      args.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }),
  lastStreamArgs: null as any,
}));

const surfaceApiMocks = vi.hoisted(() => ({
  ensureWidget: vi.fn(),
  createWidget: vi.fn(),
  focusWidget: vi.fn(),
  fitWidget: vi.fn(),
  unfocusWidget: vi.fn(),
  clearSelection: vi.fn(),
  findWidgetByType: vi.fn(() => null),
  findWidgetById: vi.fn(() => null),
  updateWidgetTitle: vi.fn(),
  lastWidgetDefinitions: null as any,
  lastStateAccessor: null as any,
  lastSetState: null as any,
}));

const stableSurfaceApi = vi.hoisted(() => ({
  ensureWidget: (type: any, options?: any) => surfaceApiMocks.ensureWidget(type, options),
  createWidget: (type: any, options?: any) => surfaceApiMocks.createWidget(type, options),
  focusWidget: (widget: any, options?: any) => surfaceApiMocks.focusWidget(widget, options),
  fitWidget: (widget: any) => surfaceApiMocks.fitWidget(widget),
  unfocusWidget: (widget: any) => surfaceApiMocks.unfocusWidget(widget),
  clearSelection: () => surfaceApiMocks.clearSelection(),
  findWidgetByType: (type: any) => (surfaceApiMocks.findWidgetByType as any)(type),
  findWidgetById: (widgetId: any) => (surfaceApiMocks.findWidgetById as any)(widgetId),
  updateWidgetTitle: (widgetId: any, title: any) => (surfaceApiMocks.updateWidgetTitle as any)(widgetId, title),
}));

const contextMocks = vi.hoisted(() => ({
  consumeWorkbenchSurfaceActivation: vi.fn(),
  consumeWorkbenchFilePreviewActivation: vi.fn(),
}));

const [envId, setEnvId] = createSignal('env-123');
const [workbenchSurfaceActivationSeq, setWorkbenchSurfaceActivationSeq] = createSignal(0);
const [workbenchSurfaceActivation, setWorkbenchSurfaceActivation] = createSignal<any>(null);
const [workbenchFilePreviewActivationSeq, setWorkbenchFilePreviewActivationSeq] = createSignal(0);
const [workbenchFilePreviewActivation, setWorkbenchFilePreviewActivation] = createSignal<any>(null);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: () => null,
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    env_id: envId,
    connectionOverlayVisible: () => false,
    connectionOverlayMessage: () => 'Connecting to runtime...',
    workbenchSurfaceActivationSeq,
    workbenchSurfaceActivation,
    workbenchFilePreviewActivationSeq,
    workbenchFilePreviewActivation,
    consumeWorkbenchSurfaceActivation: (requestId: string) => {
      contextMocks.consumeWorkbenchSurfaceActivation(requestId);
      setWorkbenchSurfaceActivation((current) => (
        current?.requestId === requestId ? null : current
      ));
    },
    consumeWorkbenchFilePreviewActivation: (requestId: string) => {
      contextMocks.consumeWorkbenchFilePreviewActivation(requestId);
      setWorkbenchFilePreviewActivation((current) => (
        current?.requestId === requestId ? null : current
      ));
    },
  }),
}));

vi.mock('../services/uiStorage', () => ({
  isDesktopStateStorageAvailable: storageMocks.isDesktopStateStorageAvailable,
  readUIStorageJSON: storageMocks.readUIStorageJSON,
  writeUIStorageJSON: storageMocks.writeUIStorageJSON,
}));

vi.mock('../services/workbenchLayoutApi', () => ({
  getWorkbenchLayoutSnapshot: layoutApiMocks.getWorkbenchLayoutSnapshot,
  putWorkbenchLayout: layoutApiMocks.putWorkbenchLayout,
  connectWorkbenchLayoutEventStream: layoutApiMocks.connectWorkbenchLayoutEventStream,
  WorkbenchLayoutConflictError: class WorkbenchLayoutConflictError extends Error {
    currentRevision: number;

    constructor(message: string, currentRevision: number) {
      super(message);
      this.name = 'WorkbenchLayoutConflictError';
      this.currentRevision = currentRevision;
    }
  },
}));

vi.mock('./redevenWorkbenchWidgets', () => ({
  redevenWorkbenchWidgets: [
    {
      type: 'redeven.terminal',
      label: 'Terminal',
      icon: () => null,
      body: () => null,
      defaultTitle: 'Terminal',
      defaultSize: { width: 800, height: 480 },
      singleton: false,
    },
    {
      type: 'redeven.files',
      label: 'Files',
      icon: () => null,
      body: () => null,
      defaultTitle: 'Files',
      defaultSize: { width: 720, height: 520 },
      singleton: false,
    },
    {
      type: 'redeven.preview',
      label: 'Preview',
      icon: () => null,
      body: () => null,
      defaultTitle: 'Preview',
      defaultSize: { width: 900, height: 620 },
      singleton: false,
    },
  ],
  redevenWorkbenchFilterBarWidgetTypes: [
    'redeven.terminal',
    'redeven.files',
  ],
}));

vi.mock('@floegence/floe-webapp-core/workbench', () => ({
  createDefaultWorkbenchState: vi.fn(() => ({
    version: 1,
    widgets: [],
    viewport: { x: 80, y: 60, scale: 1 },
    locked: false,
    filters: {
      'redeven.terminal': true,
      'redeven.files': true,
      'redeven.preview': true,
    },
    selectedWidgetId: null,
  })),
  sanitizeWorkbenchState: vi.fn((value: any, options?: any) => {
    if (value && value.version === 1) {
      return value;
    }
    return options?.createFallbackState?.();
  }),
}));

vi.mock('./surface/RedevenWorkbenchSurface', () => ({
  RedevenWorkbenchSurface: (props: any) => {
    surfaceApiMocks.lastWidgetDefinitions = props.widgetDefinitions;
    surfaceApiMocks.lastStateAccessor = props.state;
    surfaceApiMocks.lastSetState = props.setState;
    props.onApiReady?.(stableSurfaceApi);
    return (
      <div
        data-testid="env-workbench-surface"
        data-widget-ids={props.state().widgets.map((widget: any) => widget.id).join(',')}
        data-viewport-x={String(props.state().viewport.x)}
        data-widget-x={String(props.state().widgets[0]?.x ?? '')}
      />
    );
  },
}));

describe('EnvWorkbenchPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setEnvId('env-123');
    setWorkbenchSurfaceActivation(null);
    setWorkbenchSurfaceActivationSeq(0);
    setWorkbenchFilePreviewActivation(null);
    setWorkbenchFilePreviewActivationSeq(0);
    storageMocks.isDesktopStateStorageAvailable.mockReturnValue(false);
    storageMocks.readUIStorageJSON.mockReset();
    storageMocks.readUIStorageJSON.mockReturnValue(null);
    storageMocks.writeUIStorageJSON.mockReset();
    layoutApiMocks.getWorkbenchLayoutSnapshot.mockReset();
    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 0,
      revision: 0,
      updated_at_unix_ms: 0,
      widgets: [],
    });
    layoutApiMocks.putWorkbenchLayout.mockReset();
    layoutApiMocks.putWorkbenchLayout.mockImplementation(async (input: any) => ({
      seq: Math.max(1, Number(input?.base_revision ?? 0) + 1),
      revision: Math.max(1, Number(input?.base_revision ?? 0) + 1),
      updated_at_unix_ms: 200,
      widgets: input?.widgets ?? [],
    }));
    layoutApiMocks.connectWorkbenchLayoutEventStream.mockReset();
    layoutApiMocks.connectWorkbenchLayoutEventStream.mockImplementation(async (args: any) => {
      layoutApiMocks.lastStreamArgs = args;
      await new Promise<void>((resolve) => {
        args.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });
    layoutApiMocks.lastStreamArgs = null;
    surfaceApiMocks.ensureWidget.mockReset();
    surfaceApiMocks.createWidget.mockReset();
    surfaceApiMocks.focusWidget.mockReset();
    surfaceApiMocks.findWidgetByType.mockReset();
    surfaceApiMocks.findWidgetByType.mockReturnValue(null);
    surfaceApiMocks.findWidgetById.mockReset();
    surfaceApiMocks.findWidgetById.mockReturnValue(null);
    surfaceApiMocks.updateWidgetTitle.mockReset();
    surfaceApiMocks.lastWidgetDefinitions = null;
    surfaceApiMocks.lastStateAccessor = null;
    surfaceApiMocks.lastSetState = null;
    contextMocks.consumeWorkbenchSurfaceActivation.mockReset();
    contextMocks.consumeWorkbenchFilePreviewActivation.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('hydrates the runtime snapshot while persisting only local workbench state', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 1,
      revision: 1,
      updated_at_unix_ms: 100,
      widgets: [
        {
          widget_id: 'widget-files-1',
          widget_type: 'redeven.files',
          x: 320,
          y: 180,
          width: 760,
          height: 560,
          z_index: 1,
          created_at_unix_ms: 123,
        },
      ],
    });
    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123') {
        return {
          version: 1,
          widgets: [
            {
              id: 'legacy-widget',
              type: 'redeven.files',
              title: 'Files · legacy',
              x: 20,
              y: 20,
              width: 720,
              height: 520,
              z_index: 1,
              created_at_unix_ms: 100,
            },
          ],
          viewport: { x: 180, y: 120, scale: 1.25 },
          locked: true,
          filters: {
            'redeven.terminal': true,
            'redeven.files': false,
            'redeven.preview': true,
          },
          selectedWidgetId: 'legacy-widget',
        };
      }
      return null;
    }) as any);

    render(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    expect(storageMocks.readUIStorageJSON).toHaveBeenCalledWith('workbench:env-123', null);
    expect(storageMocks.readUIStorageJSON).toHaveBeenCalledWith('workbench:env-123:local_state', null);
    expect(surface.dataset.widgetIds).toBe('widget-files-1');
    expect(surface.dataset.viewportX).toBe('180');
    expect(surface.dataset.widgetX).toBe('320');

    vi.advanceTimersByTime(120);
    expect(storageMocks.writeUIStorageJSON).toHaveBeenCalledWith(
      'workbench:env-123:local_state',
      expect.objectContaining({
        version: 1,
        viewport: { x: 180, y: 120, scale: 1.25 },
        locked: true,
      }),
    );
  });

  it('wires the workbench surface with the expected widget definitions', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    expect(surfaceApiMocks.lastSetState).toBeTypeOf('function');
    expect(surfaceApiMocks.lastWidgetDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'redeven.terminal', singleton: false }),
      expect.objectContaining({ type: 'redeven.files', singleton: false }),
      expect.objectContaining({ type: 'redeven.preview', singleton: false }),
    ]));
  });

  it('applies remote layout events without moving the local viewport', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 1,
      revision: 1,
      updated_at_unix_ms: 100,
      widgets: [
        {
          widget_id: 'widget-files-1',
          widget_type: 'redeven.files',
          x: 320,
          y: 180,
          width: 760,
          height: 560,
          z_index: 1,
          created_at_unix_ms: 123,
        },
      ],
    });
    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123') {
        return {
          version: 1,
          widgets: [],
          viewport: { x: 180, y: 120, scale: 1.25 },
          locked: false,
          filters: {
            'redeven.terminal': true,
            'redeven.files': true,
            'redeven.preview': true,
          },
          selectedWidgetId: null,
        };
      }
      return null;
    }) as any);

    render(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    layoutApiMocks.lastStreamArgs.onEvent({
      seq: 2,
      type: 'layout.replaced',
      created_at_unix_ms: 200,
      payload: {
        seq: 2,
        revision: 2,
        updated_at_unix_ms: 200,
        widgets: [
          {
            widget_id: 'widget-files-1',
            widget_type: 'redeven.files',
            x: 540,
            y: 220,
            width: 760,
            height: 560,
            z_index: 1,
            created_at_unix_ms: 123,
          },
        ],
      },
    });
    await flushMicrotasks();

    const surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    expect(surface.dataset.viewportX).toBe('180');
    expect(surface.dataset.widgetX).toBe('540');
  });

  it('buffers remote layout events while a local submit is pending', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 1,
      revision: 1,
      updated_at_unix_ms: 100,
      widgets: [
        {
          widget_id: 'widget-files-1',
          widget_type: 'redeven.files',
          x: 320,
          y: 180,
          width: 760,
          height: 560,
          z_index: 1,
          created_at_unix_ms: 123,
        },
      ],
    });

    const putDeferred = deferred<any>();
    layoutApiMocks.putWorkbenchLayout.mockReturnValue(putDeferred.promise);

    render(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    surfaceApiMocks.lastSetState((previous: any) => ({
      ...previous,
      widgets: previous.widgets.map((widget: any) => (
        widget.id === 'widget-files-1'
          ? { ...widget, x: 700 }
          : widget
      )),
    }));
    await flushMicrotasks();

    layoutApiMocks.lastStreamArgs.onEvent({
      seq: 3,
      type: 'layout.replaced',
      created_at_unix_ms: 300,
      payload: {
        seq: 3,
        revision: 3,
        updated_at_unix_ms: 300,
        widgets: [
          {
            widget_id: 'widget-files-1',
            widget_type: 'redeven.files',
            x: 540,
            y: 220,
            width: 760,
            height: 560,
            z_index: 1,
            created_at_unix_ms: 123,
          },
        ],
      },
    });
    await flushMicrotasks();

    let surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    expect(surface.dataset.widgetX).toBe('700');

    vi.advanceTimersByTime(180);
    await flushMicrotasks();
    expect(layoutApiMocks.putWorkbenchLayout).toHaveBeenCalledWith({
      base_revision: 1,
      widgets: [
        {
          widget_id: 'widget-files-1',
          widget_type: 'redeven.files',
          x: 700,
          y: 180,
          width: 760,
          height: 560,
          z_index: 1,
          created_at_unix_ms: 123,
        },
      ],
    });

    surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    expect(surface.dataset.widgetX).toBe('700');

    putDeferred.resolve({
      seq: 2,
      revision: 2,
      updated_at_unix_ms: 250,
      widgets: [
        {
          widget_id: 'widget-files-1',
          widget_type: 'redeven.files',
          x: 700,
          y: 180,
          width: 760,
          height: 560,
          z_index: 1,
          created_at_unix_ms: 123,
        },
      ],
    });
    await flushMicrotasks();

    surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    expect(surface.dataset.widgetX).toBe('540');
  });

  it('routes workbench preview activation requests through the preview widget lifecycle', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const existingWidget = {
      id: 'widget-preview-existing',
      type: 'redeven.preview',
      title: 'Preview · demo.txt',
      x: 120,
      y: 90,
      width: 900,
      height: 620,
      z_index: 7,
      created_at_unix_ms: 456,
    };

    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123') {
        return {
          version: 1,
          widgets: [existingWidget],
          viewport: { x: 80, y: 60, scale: 1 },
          locked: false,
          filters: {
            'redeven.terminal': true,
            'redeven.files': true,
            'redeven.preview': true,
          },
          selectedWidgetId: existingWidget.id,
        };
      }
      if (key === 'workbench:env-123:instances') {
        return {
          version: 2,
          latestWidgetIdByType: {
            'redeven.preview': existingWidget.id,
          },
          terminalPanelsByWidgetId: {},
          previewItemsByWidgetId: {
            [existingWidget.id]: {
              id: '/workspace/demo.txt',
              type: 'file',
              name: 'demo.txt',
              path: '/workspace/demo.txt',
              size: 12,
            },
          },
        };
      }
      return null;
    }) as any);
    surfaceApiMocks.createWidget.mockReturnValue(existingWidget as any);
    surfaceApiMocks.findWidgetById.mockReturnValue(existingWidget as any);

    render(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    setWorkbenchFilePreviewActivation({
      requestId: 'request-preview-existing',
      item: {
        id: '/workspace/demo.txt',
        type: 'file',
        name: 'demo.txt',
        path: '/workspace/demo.txt',
        size: 12,
      },
      focus: true,
      ensureVisible: true,
    });
    setWorkbenchFilePreviewActivationSeq((value) => value + 1);
    await flushMicrotasks();

    expect(surfaceApiMocks.focusWidget).toHaveBeenCalledWith(existingWidget, { centerViewport: true });
    expect(surfaceApiMocks.updateWidgetTitle).toHaveBeenCalledWith(existingWidget.id, 'Preview · demo.txt');
    expect(contextMocks.consumeWorkbenchFilePreviewActivation).toHaveBeenCalledWith('request-preview-existing');
  });
});
