// @vitest-environment jsdom

import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvWorkbenchPage } from './EnvWorkbenchPage';
import { useEnvWorkbenchInstancesContext } from './EnvWorkbenchInstancesContext';

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
    widget_states: [] as any[],
  })),
  putWorkbenchLayout: vi.fn(async (input: any): Promise<any> => ({
    seq: Math.max(1, Number(input?.base_revision ?? 0) + 1),
    revision: Math.max(1, Number(input?.base_revision ?? 0) + 1),
    updated_at_unix_ms: 200,
    widgets: (input?.widgets ?? []) as any[],
    widget_states: [] as any[],
  })),
  putWorkbenchWidgetState: vi.fn(async (widgetId: string, input: any): Promise<any> => ({
    widget_id: widgetId,
    widget_type: input?.widget_type,
    revision: Math.max(1, Number(input?.base_revision ?? 0) + 1),
    updated_at_unix_ms: 300,
    state: input?.state,
  })),
  createWorkbenchTerminalSession: vi.fn(async (widgetId: string): Promise<any> => ({
    session: {
      id: 'session-created',
      name: 'repo',
      working_dir: '/workspace',
      created_at_ms: 1,
      last_active_at_ms: 1,
      is_active: false,
    },
    widget_state: {
      widget_id: widgetId,
      widget_type: 'redeven.terminal',
      revision: 2,
      updated_at_unix_ms: 301,
      state: {
        kind: 'terminal',
        session_ids: ['session-1', 'session-created'],
      },
    },
  })),
  deleteWorkbenchTerminalSession: vi.fn(async (widgetId: string): Promise<any> => ({
    widget_id: widgetId,
    widget_type: 'redeven.terminal',
    revision: 2,
    updated_at_unix_ms: 302,
    state: {
      kind: 'terminal',
      session_ids: [],
    },
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
  lastSurfaceProps: null as any,
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

const widgetBodyMocks = vi.hoisted(() => ({
  renderFilesBody: null as null | ((props: any) => any),
  renderTerminalBody: null as null | ((props: any) => any),
  renderPreviewBody: null as null | ((props: any) => any),
}));

const contextProbeState = vi.hoisted(() => ({
  fileOpenRequest: null as any,
  terminalPanelState: null as any,
  previewItem: null as any,
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
  putWorkbenchWidgetState: layoutApiMocks.putWorkbenchWidgetState,
  createWorkbenchTerminalSession: layoutApiMocks.createWorkbenchTerminalSession,
  deleteWorkbenchTerminalSession: layoutApiMocks.deleteWorkbenchTerminalSession,
  connectWorkbenchLayoutEventStream: layoutApiMocks.connectWorkbenchLayoutEventStream,
  WorkbenchLayoutConflictError: class WorkbenchLayoutConflictError extends Error {
    currentRevision: number;

    constructor(message: string, currentRevision: number) {
      super(message);
      this.name = 'WorkbenchLayoutConflictError';
      this.currentRevision = currentRevision;
    }
  },
  WorkbenchWidgetStateConflictError: class WorkbenchWidgetStateConflictError extends Error {
    widgetId: string;
    currentRevision: number;

    constructor(message: string, widgetId: string, currentRevision: number) {
      super(message);
      this.name = 'WorkbenchWidgetStateConflictError';
      this.widgetId = widgetId;
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
      body: (props: any) => widgetBodyMocks.renderTerminalBody?.(props) ?? null,
      defaultTitle: 'Terminal',
      defaultSize: { width: 800, height: 480 },
      singleton: false,
    },
    {
      type: 'redeven.files',
      label: 'Files',
      icon: () => null,
      body: (props: any) => widgetBodyMocks.renderFilesBody?.(props) ?? null,
      defaultTitle: 'Files',
      defaultSize: { width: 720, height: 520 },
      singleton: false,
    },
    {
      type: 'redeven.preview',
      label: 'Preview',
      icon: () => null,
      body: (props: any) => widgetBodyMocks.renderPreviewBody?.(props) ?? null,
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
    surfaceApiMocks.lastSurfaceProps = props;
    props.onApiReady?.(stableSurfaceApi);
    return (
      <div
        data-testid="env-workbench-surface"
        data-widget-ids={props.state().widgets.map((widget: any) => widget.id).join(',')}
        data-viewport-x={String(props.state().viewport.x)}
        data-widget-x={String(props.state().widgets[0]?.x ?? '')}
      >
        {props.state().widgets.map((widget: any) => {
          const definition = props.widgetDefinitions.find((entry: any) => entry.type === widget.type);
          const Body = definition?.body;
          return Body ? (
            <div data-testid={`widget-body-${widget.id}`}>
              <Body widgetId={widget.id} title={widget.title} type={widget.type} />
            </div>
          ) : null;
        })}
      </div>
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
      widget_states: [],
    });
    layoutApiMocks.putWorkbenchLayout.mockReset();
    layoutApiMocks.putWorkbenchLayout.mockImplementation(async (input: any) => ({
      seq: Math.max(1, Number(input?.base_revision ?? 0) + 1),
      revision: Math.max(1, Number(input?.base_revision ?? 0) + 1),
      updated_at_unix_ms: 200,
      widgets: input?.widgets ?? [],
      widget_states: [],
    }));
    layoutApiMocks.putWorkbenchWidgetState.mockReset();
    layoutApiMocks.putWorkbenchWidgetState.mockImplementation(async (widgetId: string, input: any) => ({
      widget_id: widgetId,
      widget_type: input?.widget_type,
      revision: Math.max(1, Number(input?.base_revision ?? 0) + 1),
      updated_at_unix_ms: 300,
      state: input?.state,
    }));
    layoutApiMocks.createWorkbenchTerminalSession.mockClear();
    layoutApiMocks.deleteWorkbenchTerminalSession.mockClear();
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
    surfaceApiMocks.lastSurfaceProps = null;
    contextMocks.consumeWorkbenchSurfaceActivation.mockReset();
    contextMocks.consumeWorkbenchFilePreviewActivation.mockReset();
    widgetBodyMocks.renderFilesBody = null;
    widgetBodyMocks.renderTerminalBody = null;
    widgetBodyMocks.renderPreviewBody = null;
    contextProbeState.fileOpenRequest = null;
    contextProbeState.terminalPanelState = null;
    contextProbeState.previewItem = null;
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
      widget_states: [],
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
      widget_states: [],
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
        widget_states: [],
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
      widget_states: [],
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
        widget_states: [],
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
      widget_states: [],
    });
    await flushMicrotasks();

    surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    expect(surface.dataset.widgetX).toBe('540');
  });

  it('defers layout persistence during active widget interactions and flushes once at the end', async () => {
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
      widget_states: [],
    });

    render(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionStart();
    surfaceApiMocks.lastSetState((previous: any) => ({
      ...previous,
      widgets: previous.widgets.map((widget: any) => (
        widget.id === 'widget-files-1'
          ? { ...widget, x: 700 }
          : widget
      )),
    }));
    await flushMicrotasks();
    vi.runOnlyPendingTimers();
    await flushMicrotasks();

    expect(layoutApiMocks.putWorkbenchLayout).not.toHaveBeenCalled();

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionEnd();
    await flushMicrotasks();
    vi.runOnlyPendingTimers();
    await flushMicrotasks();

    expect(layoutApiMocks.putWorkbenchLayout).toHaveBeenCalledTimes(1);
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
  });

  it('applies shared file paths and persists only committed path changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 2,
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
      widget_states: [
        {
          widget_id: 'widget-files-1',
          widget_type: 'redeven.files',
          revision: 1,
          updated_at_unix_ms: 120,
          state: {
            kind: 'files',
            current_path: '/workspace/src',
          },
        },
      ],
    });
    widgetBodyMocks.renderFilesBody = (bodyProps: any) => {
      const workbench = useEnvWorkbenchInstancesContext();
      createEffect(() => {
        contextProbeState.fileOpenRequest = workbench.fileBrowserOpenRequest(bodyProps.widgetId);
      });
      return (
        <button
          type="button"
          data-testid="commit-files-path"
          onClick={() => workbench.updateFileBrowserPath(bodyProps.widgetId, '/workspace/app')}
        >
          Commit path
        </button>
      );
    };

    render(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    expect(contextProbeState.fileOpenRequest).toMatchObject({
      widgetId: 'widget-files-1',
      path: '/workspace/src',
    });

    (host.querySelector('[data-testid="commit-files-path"]') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(layoutApiMocks.putWorkbenchWidgetState).toHaveBeenCalledWith('widget-files-1', {
      base_revision: 1,
      widget_type: 'redeven.files',
      state: {
        kind: 'files',
        current_path: '/workspace/app',
      },
    });
  });

  it('applies shared terminal session lists while keeping the active tab local', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 2,
      revision: 1,
      updated_at_unix_ms: 100,
      widgets: [
        {
          widget_id: 'widget-terminal-1',
          widget_type: 'redeven.terminal',
          x: 320,
          y: 180,
          width: 760,
          height: 560,
          z_index: 1,
          created_at_unix_ms: 123,
        },
      ],
      widget_states: [
        {
          widget_id: 'widget-terminal-1',
          widget_type: 'redeven.terminal',
          revision: 1,
          updated_at_unix_ms: 120,
          state: {
            kind: 'terminal',
            session_ids: ['session-1', 'session-2'],
          },
        },
      ],
    });
    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123:instances') {
        return {
          version: 2,
          latestWidgetIdByType: {},
          terminalPanelsByWidgetId: {
            'widget-terminal-1': {
              sessionIds: ['session-1'],
              activeSessionId: 'session-1',
            },
          },
          previewItemsByWidgetId: {},
        };
      }
      return null;
    }) as any);
    widgetBodyMocks.renderTerminalBody = (bodyProps: any) => {
      const workbench = useEnvWorkbenchInstancesContext();
      createEffect(() => {
        contextProbeState.terminalPanelState = workbench.terminalPanelState(bodyProps.widgetId);
      });
      return null;
    };

    render(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    expect(contextProbeState.terminalPanelState).toEqual({
      sessionIds: ['session-1', 'session-2'],
      activeSessionId: 'session-1',
    });

    layoutApiMocks.lastStreamArgs.onEvent({
      seq: 3,
      type: 'widget_state.upserted',
      created_at_unix_ms: 130,
      payload: {
        widget_id: 'widget-terminal-1',
        widget_type: 'redeven.terminal',
        revision: 2,
        updated_at_unix_ms: 130,
        state: {
          kind: 'terminal',
          session_ids: ['session-1', 'session-2', 'session-3'],
        },
      },
    });
    await flushMicrotasks();

    expect(contextProbeState.terminalPanelState).toEqual({
      sessionIds: ['session-1', 'session-2', 'session-3'],
      activeSessionId: 'session-1',
    });
  });

  it('applies shared preview items without changing layout state', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 2,
      revision: 1,
      updated_at_unix_ms: 100,
      widgets: [
        {
          widget_id: 'widget-preview-1',
          widget_type: 'redeven.preview',
          x: 320,
          y: 180,
          width: 760,
          height: 560,
          z_index: 1,
          created_at_unix_ms: 123,
        },
      ],
      widget_states: [
        {
          widget_id: 'widget-preview-1',
          widget_type: 'redeven.preview',
          revision: 1,
          updated_at_unix_ms: 120,
          state: {
            kind: 'preview',
            item: {
              id: '/workspace/demo.txt',
              type: 'file',
              path: '/workspace/demo.txt',
              name: 'demo.txt',
              size: 12,
            },
          },
        },
      ],
    });
    widgetBodyMocks.renderPreviewBody = (bodyProps: any) => {
      const workbench = useEnvWorkbenchInstancesContext();
      createEffect(() => {
        contextProbeState.previewItem = workbench.previewItem(bodyProps.widgetId);
      });
      return null;
    };

    render(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    expect(contextProbeState.previewItem).toMatchObject({
      path: '/workspace/demo.txt',
      name: 'demo.txt',
    });

    layoutApiMocks.lastStreamArgs.onEvent({
      seq: 3,
      type: 'widget_state.upserted',
      created_at_unix_ms: 130,
      payload: {
        widget_id: 'widget-preview-1',
        widget_type: 'redeven.preview',
        revision: 2,
        updated_at_unix_ms: 130,
        state: {
          kind: 'preview',
          item: {
            id: '/workspace/other.txt',
            type: 'file',
            path: '/workspace/other.txt',
            name: 'other.txt',
          },
        },
      },
    });
    await flushMicrotasks();

    expect(contextProbeState.previewItem).toMatchObject({
      path: '/workspace/other.txt',
      name: 'other.txt',
    });
    expect((host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement).dataset.widgetX).toBe('320');
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
