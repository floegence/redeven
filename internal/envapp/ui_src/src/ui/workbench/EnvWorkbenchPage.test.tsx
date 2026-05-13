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
  removeUIStorageItem: vi.fn(),
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
  openWorkbenchPreview: vi.fn(async (input: any): Promise<any> => {
    const widgetId = 'widget-preview-command';
    const now = 400;
    return {
      request_id: input?.request_id ?? '',
      widget_id: widgetId,
      created: true,
      snapshot: {
        seq: 1,
        revision: 1,
        updated_at_unix_ms: now,
        widgets: [
          {
            widget_id: widgetId,
            widget_type: 'redeven.preview',
            x: 80,
            y: 90,
            width: 900,
            height: 620,
            z_index: 1,
            created_at_unix_ms: now,
          },
        ],
        widget_states: [
          {
            widget_id: widgetId,
            widget_type: 'redeven.preview',
            revision: 1,
            updated_at_unix_ms: now,
            state: {
              kind: 'preview',
              item: input?.item ?? null,
            },
          },
        ],
      },
      widget_state: {
        widget_id: widgetId,
        widget_type: 'redeven.preview',
        revision: 1,
        updated_at_unix_ms: now,
        state: {
          kind: 'preview',
          item: input?.item ?? null,
        },
      },
    };
  }),
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
  enterOverview: vi.fn(),
  runViewportTransition: vi.fn((action: () => unknown, _options?: unknown) => action()),
  clearSelection: vi.fn(),
  findWidgetByType: vi.fn((_type?: unknown): any => null),
  findWidgetById: vi.fn((_widgetId?: unknown): any => null),
  updateWidgetTitle: vi.fn(),
  viewportTransitionReleases: [] as Array<() => void>,
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
  enterOverview: () => surfaceApiMocks.enterOverview(),
  runViewportTransition: (action: () => unknown, options?: any) => surfaceApiMocks.runViewportTransition(action, options),
  clearSelection: () => surfaceApiMocks.clearSelection(),
  findWidgetByType: (type: any) => (surfaceApiMocks.findWidgetByType as any)(type),
  findWidgetById: (widgetId: any) => (surfaceApiMocks.findWidgetById as any)(widgetId),
  updateWidgetTitle: (widgetId: any, title: any) => (surfaceApiMocks.updateWidgetTitle as any)(widgetId, title),
}));

const contextMocks = vi.hoisted(() => ({
  consumeWorkbenchOverviewEntry: vi.fn(),
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
  terminalOpenRequest: null as any,
  terminalPanelState: null as any,
  previewItem: null as any,
  previewOpenRequest: null as any,
}));

const [envId, setEnvId] = createSignal('env-123');
const [workbenchOverviewEntrySeq, setWorkbenchOverviewEntrySeq] = createSignal(0);
const [workbenchOverviewEntry, setWorkbenchOverviewEntry] = createSignal<any>(null);
const [workbenchSurfaceActivationSeq, setWorkbenchSurfaceActivationSeq] = createSignal(0);
const [workbenchSurfaceActivation, setWorkbenchSurfaceActivation] = createSignal<any>(null);
const [workbenchFilePreviewActivationSeq, setWorkbenchFilePreviewActivationSeq] = createSignal(0);
const [workbenchFilePreviewActivation, setWorkbenchFilePreviewActivation] = createSignal<any>(null);
const testDisposers: Array<() => void> = [];

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

async function advanceTimersByTimeAndFlush(ms: number) {
  vi.advanceTimersByTime(ms);
  await flushMicrotasks();
}

function setMockCanvasFrameRect(host: HTMLElement, width: number, height: number) {
  const frame = host.querySelector('[data-floe-workbench-canvas-frame="true"]') as HTMLDivElement | null;
  expect(frame).toBeTruthy();
  Object.defineProperty(frame!, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }),
  });
}

function centerOfWidgets(widgets: readonly any[]): { x: number; y: number } {
  const minX = Math.min(...widgets.map((widget) => widget.x));
  const minY = Math.min(...widgets.map((widget) => widget.y));
  const maxX = Math.max(...widgets.map((widget) => widget.x + widget.width));
  const maxY = Math.max(...widgets.map((widget) => widget.y + widget.height));
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

function widgetsOverlap(left: any, right: any): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function ensureCSSEscape() {
  const css = globalThis.CSS as { escape?: (value: string) => string } | undefined;
  if (css && typeof css.escape === 'function') {
    return ensureDOMMatrix();
  }
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: {
      ...(css ?? {}),
      escape: (value: string) => String(value),
    },
  });
  ensureDOMMatrix();
}

function ensureDOMMatrix() {
  if (typeof globalThis.DOMMatrix === 'function') {
    return;
  }
  class TestDOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    is2D = true;

    translateSelf(x = 0, y = 0) {
      this.e += Number(x) || 0;
      this.f += Number(y) || 0;
      return this;
    }

    rotateSelf() {
      return this;
    }

    scaleSelf(scaleX = 1, scaleY = scaleX) {
      this.a *= Number(scaleX) || 1;
      this.d *= Number(scaleY) || 1;
      return this;
    }

    inverse() {
      return new TestDOMMatrix();
    }

    multiply() {
      return this;
    }

    toString() {
      return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
    }
  }
  Object.defineProperty(globalThis, 'DOMMatrix', {
    configurable: true,
    value: TestDOMMatrix,
  });
}

function mount(ui: () => any, host: HTMLElement) {
  const dispose = render(ui, host);
  testDisposers.push(dispose);
}

function runtimeWidget(widget_id: string, widget_type: string, z_index: number, created_at_unix_ms: number) {
  return {
    widget_id,
    widget_type,
    x: 80 + (z_index * 20),
    y: 90 + (z_index * 20),
    width: 360,
    height: 240,
    z_index,
    created_at_unix_ms,
  };
}

function persistedWidget(widget_id: string, widget_type: string, title: string, z_index: number, created_at_unix_ms: number) {
  return {
    id: widget_id,
    type: widget_type,
    title,
    x: 80 + (z_index * 20),
    y: 90 + (z_index * 20),
    width: 360,
    height: 240,
    z_index,
    created_at_unix_ms,
  };
}

function runtimePreviewState(widget_id: string, path: string, name: string, revision = 1, updated_at_unix_ms = 400, size?: number) {
  return {
    widget_id,
    widget_type: 'redeven.preview',
    revision,
    updated_at_unix_ms,
    state: {
      kind: 'preview',
      item: {
        id: path,
        type: 'file',
        path,
        name,
        ...(typeof size === 'number' ? { size } : {}),
      },
    },
  };
}

function openPreviewResponse(args: {
  requestId: string;
  widgetId: string;
  created: boolean;
  widgets: any[];
  item: { path: string; name: string; size?: number };
  seq?: number;
  revision?: number;
  stateRevision?: number;
}) {
  const state = runtimePreviewState(
    args.widgetId,
    args.item.path,
    args.item.name,
    args.stateRevision ?? 1,
    400,
    args.item.size,
  );
  return {
    request_id: args.requestId,
    widget_id: args.widgetId,
    created: args.created,
    snapshot: {
      seq: args.seq ?? 2,
      revision: args.revision ?? 2,
      updated_at_unix_ms: 400,
      widgets: args.widgets,
      widget_states: [state],
      sticky_notes: [],
      annotations: [],
      background_layers: [],
    },
    widget_state: state,
  };
}

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    env_id: envId,
    connectionOverlayVisible: () => false,
    connectionOverlayMessage: () => 'Connecting to runtime...',
    workbenchOverviewEntrySeq,
    workbenchOverviewEntry,
    workbenchSurfaceActivationSeq,
    workbenchSurfaceActivation,
    workbenchFilePreviewActivationSeq,
    workbenchFilePreviewActivation,
    consumeWorkbenchOverviewEntry: (requestId: string) => {
      contextMocks.consumeWorkbenchOverviewEntry(requestId);
      setWorkbenchOverviewEntry((current) => (
        current?.requestId === requestId ? null : current
      ));
    },
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
  removeUIStorageItem: storageMocks.removeUIStorageItem,
}));

vi.mock('../services/workbenchLayoutApi', () => ({
  getWorkbenchLayoutSnapshot: layoutApiMocks.getWorkbenchLayoutSnapshot,
  putWorkbenchLayout: layoutApiMocks.putWorkbenchLayout,
  putWorkbenchWidgetState: layoutApiMocks.putWorkbenchWidgetState,
  openWorkbenchPreview: layoutApiMocks.openWorkbenchPreview,
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

vi.mock('@floegence/floe-webapp-core/workbench', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@floegence/floe-webapp-core/workbench')>()),
  DEFAULT_WORKBENCH_THEME: 'default',
  isWorkbenchThemeId: (value: unknown) => (
    value === 'default'
    || value === 'vibrancy'
    || value === 'mica'
    || value === 'midnight'
    || value === 'aurora'
    || value === 'terminal'
  ),
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
    theme: 'default',
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
    const topWidgetId = () => ([...props.state().widgets].sort((left: any, right: any) => {
      if (left.z_index !== right.z_index) {
        return right.z_index - left.z_index;
      }
      if (left.created_at_unix_ms !== right.created_at_unix_ms) {
        return right.created_at_unix_ms - left.created_at_unix_ms;
      }
      return String(right.id).localeCompare(String(left.id));
    })[0]?.id ?? '');
    return (
      <div>
        <div class="workbench-hud" data-testid="mock-workbench-hud">
          <button type="button" class="workbench-hud__button" aria-label="Zoom out">-</button>
          <div class="workbench-hud__scale">100%</div>
          <button type="button" class="workbench-hud__button" aria-label="Zoom in">+</button>
        </div>
        <div
          data-floe-workbench-canvas-frame="true"
          data-testid="mock-workbench-canvas-frame"
        >
          <div
            data-testid="env-workbench-surface"
            data-widget-ids={props.state().widgets.map((widget: any) => widget.id).join(',')}
            data-viewport-x={String(props.state().viewport.x)}
            data-viewport-y={String(props.state().viewport.y)}
            data-viewport-scale={String(props.state().viewport.scale)}
            data-widget-x={String(props.state().widgets[0]?.x ?? '')}
            data-selected-widget-id={String(props.state().selectedWidgetId ?? '')}
            data-top-widget-id={topWidgetId()}
          >
            {props.state().widgets.map((widget: any) => {
              const definition = props.widgetDefinitions.find((entry: any) => entry.type === widget.type);
              const Body = definition?.body;
              return Body ? (
                <div
                  data-testid={`widget-body-${widget.id}`}
                  data-redeven-workbench-widget-id={widget.id}
                >
                  <Body widgetId={widget.id} title={widget.title} type={widget.type} />
                </div>
              ) : null;
            })}
          </div>
        </div>
      </div>
    );
  },
}));

describe('EnvWorkbenchPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ensureCSSEscape();
    setEnvId('env-123');
    setWorkbenchOverviewEntry(null);
    setWorkbenchOverviewEntrySeq(0);
    setWorkbenchSurfaceActivation(null);
    setWorkbenchSurfaceActivationSeq(0);
    setWorkbenchFilePreviewActivation(null);
    setWorkbenchFilePreviewActivationSeq(0);
    storageMocks.isDesktopStateStorageAvailable.mockReturnValue(false);
    storageMocks.readUIStorageJSON.mockReset();
    storageMocks.readUIStorageJSON.mockReturnValue(null);
    storageMocks.writeUIStorageJSON.mockReset();
    storageMocks.removeUIStorageItem.mockReset();
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
    layoutApiMocks.openWorkbenchPreview.mockReset();
    layoutApiMocks.openWorkbenchPreview.mockImplementation(async (input: any) => {
      const widgetId = 'widget-preview-command';
      const now = 400;
      return {
        request_id: input?.request_id ?? '',
        widget_id: widgetId,
        created: true,
        snapshot: {
          seq: 1,
          revision: 1,
          updated_at_unix_ms: now,
          widgets: [
            {
              widget_id: widgetId,
              widget_type: 'redeven.preview',
              x: 80,
              y: 90,
              width: 900,
              height: 620,
              z_index: 1,
              created_at_unix_ms: now,
            },
          ],
          widget_states: [
            {
              widget_id: widgetId,
              widget_type: 'redeven.preview',
              revision: 1,
              updated_at_unix_ms: now,
              state: {
                kind: 'preview',
                item: input?.item ?? null,
              },
            },
          ],
        },
        widget_state: {
          widget_id: widgetId,
          widget_type: 'redeven.preview',
          revision: 1,
          updated_at_unix_ms: now,
          state: {
            kind: 'preview',
            item: input?.item ?? null,
          },
        },
      };
    });
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
    surfaceApiMocks.fitWidget.mockReset();
    surfaceApiMocks.unfocusWidget.mockReset();
    surfaceApiMocks.enterOverview.mockReset();
    surfaceApiMocks.runViewportTransition.mockReset();
    surfaceApiMocks.runViewportTransition.mockImplementation((action: () => unknown) => action());
    surfaceApiMocks.findWidgetByType.mockReset();
    surfaceApiMocks.findWidgetByType.mockReturnValue(null);
    surfaceApiMocks.findWidgetById.mockReset();
    surfaceApiMocks.findWidgetById.mockReturnValue(null);
    surfaceApiMocks.updateWidgetTitle.mockReset();
    surfaceApiMocks.viewportTransitionReleases = [];
    surfaceApiMocks.lastWidgetDefinitions = null;
    surfaceApiMocks.lastStateAccessor = null;
    surfaceApiMocks.lastSetState = null;
    surfaceApiMocks.lastSurfaceProps = null;
    contextMocks.consumeWorkbenchOverviewEntry.mockReset();
    contextMocks.consumeWorkbenchSurfaceActivation.mockReset();
    contextMocks.consumeWorkbenchFilePreviewActivation.mockReset();
    widgetBodyMocks.renderFilesBody = null;
    widgetBodyMocks.renderTerminalBody = null;
    widgetBodyMocks.renderPreviewBody = null;
    contextProbeState.fileOpenRequest = null;
    contextProbeState.terminalOpenRequest = null;
    contextProbeState.terminalPanelState = null;
    contextProbeState.previewItem = null;
    contextProbeState.previewOpenRequest = null;
  });

  afterEach(() => {
    while (testDisposers.length > 0) {
      const dispose = testDisposers.pop();
      dispose?.();
    }
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
          theme: 'mica',
        };
      }
      return null;
    }) as any);

    mount(() => <EnvWorkbenchPage />, host);
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
        version: 3,
        locked: true,
        theme: 'mica',
        mode: 'work',
        activeTool: 'select',
      }),
    );
  });

  it('migrates legacy workbench appearance into persisted local theme state', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'redeven_envapp_workbench_appearance_v1') {
        return { tone: 'slate', texture: 'grid' };
      }
      return null;
    }) as any);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    expect(surfaceApiMocks.lastStateAccessor().theme).toBe('midnight');
    expect(storageMocks.writeUIStorageJSON).toHaveBeenCalledWith(
      'workbench:env-123:local_state',
      expect.objectContaining({
        theme: 'midnight',
      }),
    );
    expect(storageMocks.removeUIStorageItem).toHaveBeenCalledWith(
      'redeven_envapp_workbench_appearance_v1',
    );
  });

  it('wires the workbench surface with the expected widget definitions', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    expect(surfaceApiMocks.lastSetState).toBeTypeOf('function');
    expect(surfaceApiMocks.lastWidgetDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'redeven.terminal', singleton: false }),
      expect.objectContaining({ type: 'redeven.files', singleton: false }),
      expect.objectContaining({ type: 'redeven.preview', singleton: false }),
    ]));
  });

  it('uses a full-screen progress curtain until the runtime layout is ready', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const layout = deferred<any>();
    layoutApiMocks.getWorkbenchLayoutSnapshot.mockReturnValueOnce(layout.promise);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const curtain = host.querySelector('.redeven-workbench-progress-curtain') as HTMLElement | null;
    expect(curtain).toBeTruthy();
    expect(curtain?.getAttribute('data-redeven-loading-curtain-stage')).toBe('layout');
    expect(host.querySelector('.workbench-entry-intro')).toBeNull();
    expect(host.querySelector('.redeven-workbench-intro-preparing')).toBeNull();
    expect(host.textContent).toContain('Loading layout');

    layout.resolve({
      seq: 0,
      revision: 0,
      updated_at_unix_ms: 0,
      widgets: [],
      widget_states: [],
    });
    await flushMicrotasks();

    expect(host.querySelector('.redeven-workbench-progress-curtain')).toBeNull();
    expect(host.textContent).not.toContain('Loading workbench');
  });

  it('shows the global min-scale HUD action even without a selected widget', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    expect(document.querySelector('[aria-label="Scale canvas to minimum"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Fit selected widget to viewport"]')).toBeNull();
  });

  it('renders the HUD shortcut group with semantic shortcut styling and prevents pointer focus steals', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const minButton = document.querySelector('[aria-label="Scale canvas to minimum"]') as HTMLButtonElement | null;
    expect(minButton).toBeTruthy();
    expect(minButton?.className).toContain('bg-warning/10');
    expect(minButton?.className).toContain('border-warning/30');
    expect(minButton?.closest('.redeven-workbench-hud-shortcuts')).toBeTruthy();

    const pointerDown = new Event('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    minButton!.dispatchEvent(pointerDown);

    expect(pointerDown.defaultPrevented).toBe(true);
  });

  it('animates the canvas scale down around the current viewport center without clearing selection', async () => {
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
          theme: 'default',
        };
      }
      return null;
    }) as any);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();
    setMockCanvasFrameRect(host, 1200, 800);

    const minButton = document.querySelector('[aria-label="Scale canvas to minimum"]') as HTMLButtonElement | null;
    expect(minButton).toBeTruthy();

    const surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    expect(surface.dataset.viewportScale).toBe('1.25');
    expect(Number(surface.dataset.viewportX)).toBeCloseTo(180, 6);
    expect(Number(surface.dataset.viewportY)).toBeCloseTo(120, 6);

    minButton!.click();
    await flushMicrotasks();

    expect(surfaceApiMocks.runViewportTransition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ reason: 'hud_control' }),
    );
    expect(surface.dataset.viewportScale).toBe('1.25');

    vi.advanceTimersByTime(90);
    await flushMicrotasks();

    expect(Number(surface.dataset.viewportScale)).toBeLessThan(1.25);
    expect(Number(surface.dataset.viewportScale)).toBeGreaterThan(0.45);
    expect(Number(surface.dataset.viewportX)).toBeGreaterThan(180);
    expect(Number(surface.dataset.viewportX)).toBeLessThan(448.8);
    expect(Number(surface.dataset.viewportY)).toBeGreaterThan(120);
    expect(Number(surface.dataset.viewportY)).toBeLessThan(299.2);

    vi.advanceTimersByTime(120);
    await flushMicrotasks();

    expect(Number(surface.dataset.viewportScale)).toBeCloseTo(0.45, 6);
    expect(Number(surface.dataset.viewportX)).toBeCloseTo(448.8, 6);
    expect(Number(surface.dataset.viewportY)).toBeCloseTo(299.2, 6);
    expect(surface.dataset.selectedWidgetId).toBe('');
  });

  it('maps Escape to the global min-scale action when no widget is selected', async () => {
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
          theme: 'default',
        };
      }
      return null;
    }) as any);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();
    setMockCanvasFrameRect(host, 1200, 800);

    const surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(escapeEvent);
    await flushMicrotasks();

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(surface.dataset.viewportScale).toBe('1.25');

    vi.advanceTimersByTime(210);
    await flushMicrotasks();

    expect(Number(surface.dataset.viewportScale)).toBeCloseTo(0.45, 6);
    expect(Number(surface.dataset.viewportX)).toBeCloseTo(448.8, 6);
    expect(Number(surface.dataset.viewportY)).toBeCloseTo(299.2, 6);
  });

  it('ignores Escape canvas minimize when a widget is selected', async () => {
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
          selectedWidgetId: 'widget-files-1',
          theme: 'default',
        };
      }
      return null;
    }) as any);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();
    setMockCanvasFrameRect(host, 1200, 800);

    const surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(escapeEvent);
    await flushMicrotasks();
    vi.advanceTimersByTime(210);
    await flushMicrotasks();

    expect(escapeEvent.defaultPrevented).toBe(false);
    expect(Number(surface.dataset.viewportScale)).toBeCloseTo(1.25, 6);
    expect(Number(surface.dataset.viewportX)).toBeCloseTo(180, 6);
    expect(Number(surface.dataset.viewportY)).toBeCloseTo(120, 6);
  });

  it('shows the fit button only for a selected widget and routes it to fitWidget', async () => {
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
          selectedWidgetId: 'widget-files-1',
          theme: 'default',
        };
      }
      return null;
    }) as any);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const fitButton = document.querySelector('[aria-label="Fit selected widget to viewport"]') as HTMLButtonElement | null;
    expect(fitButton).toBeTruthy();
    expect(fitButton?.className).toContain('bg-success/10');
    expect(fitButton?.className).toContain('border-success/30');

    fitButton!.click();

    expect(surfaceApiMocks.fitWidget).toHaveBeenCalledWith(expect.objectContaining({
      id: 'widget-files-1',
      type: 'redeven.files',
    }));
  });

  it('adds a canvas context-menu action that tidies widgets around the viewport center', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 1,
      revision: 1,
      updated_at_unix_ms: 100,
      widgets: [
        {
          widget_id: 'widget-terminal-wide',
          widget_type: 'redeven.terminal',
          x: -1600,
          y: 720,
          width: 1320,
          height: 340,
          z_index: 1,
          created_at_unix_ms: 123,
        },
        {
          widget_id: 'widget-files-tall',
          widget_type: 'redeven.files',
          x: 980,
          y: -860,
          width: 520,
          height: 940,
          z_index: 2,
          created_at_unix_ms: 124,
        },
        {
          widget_id: 'widget-terminal-small',
          widget_type: 'redeven.terminal',
          x: 2400,
          y: 1600,
          width: 460,
          height: 380,
          z_index: 3,
          created_at_unix_ms: 125,
        },
      ],
      widget_states: [],
    });

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();
    setMockCanvasFrameRect(host, 1200, 800);

    const closeMenu = vi.fn();
    const menuItems = surfaceApiMocks.lastSurfaceProps.resolveContextMenuItems({
      menu: {
        clientX: 200,
        clientY: 200,
        worldX: 0,
        worldY: 0,
      },
      items: [
        {
          id: 'add-redeven.terminal',
          kind: 'action',
          label: 'Add Terminal',
          icon: () => null,
          onSelect: vi.fn(),
        },
      ],
      widgets: surfaceApiMocks.lastStateAccessor().widgets,
      widget: null,
      closeMenu,
    });
    const tidyItem = menuItems[0] as any;
    expect(tidyItem).toMatchObject({
      id: 'redeven-tidy-by-type',
      label: 'Tidy by Type',
      disabled: false,
    });

    tidyItem.onSelect();

    const arrangedWidgets = surfaceApiMocks.lastStateAccessor().widgets;
    expect(closeMenu).toHaveBeenCalledTimes(1);
    expect(arrangedWidgets.map((widget: any) => [widget.id, widget.width, widget.height])).toEqual([
      ['widget-terminal-wide', 1320, 340],
      ['widget-files-tall', 520, 940],
      ['widget-terminal-small', 460, 380],
    ]);
    expect(centerOfWidgets(arrangedWidgets)).toEqual({ x: 520, y: 340 });
    for (let leftIndex = 0; leftIndex < arrangedWidgets.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < arrangedWidgets.length; rightIndex += 1) {
        expect(widgetsOverlap(arrangedWidgets[leftIndex], arrangedWidgets[rightIndex])).toBe(false);
      }
    }
  });

  it('keeps workbench tidy actions out of background-mode canvas menus', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 1,
      revision: 1,
      updated_at_unix_ms: 100,
      widgets: [
        runtimeWidget('widget-files-1', 'redeven.files', 1, 123),
      ],
      widget_states: [],
      sticky_notes: [],
      annotations: [],
      background_layers: [],
    });

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const menuItems = surfaceApiMocks.lastSurfaceProps.resolveContextMenuItems({
      menu: {
        clientX: 200,
        clientY: 200,
        worldX: 0,
        worldY: 0,
        target: { kind: 'canvas', mode: 'background' },
      },
      items: [
        {
          id: 'create-background-region',
          kind: 'action',
          label: 'Add Region',
          icon: () => null,
          onSelect: vi.fn(),
        },
      ],
      widgets: surfaceApiMocks.lastStateAccessor().widgets,
      widget: null,
      closeMenu: vi.fn(),
    });

    expect(menuItems.map((item: any) => item.id)).toEqual(['create-background-region']);
  });

  it('enters overview mode when the shell issues a workbench overview request', async () => {
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

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    setWorkbenchOverviewEntry({
      requestId: 'overview-1',
      reason: 'mode_switch',
    });
    setWorkbenchOverviewEntrySeq((value) => value + 1);
    await flushMicrotasks();

    expect(surfaceApiMocks.enterOverview).toHaveBeenCalledTimes(1);
    expect(contextMocks.consumeWorkbenchOverviewEntry).toHaveBeenCalledWith('overview-1');
  });

  it('waits for runtime layout readiness before entering overview mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const snapshotLoad = deferred<any>();
    layoutApiMocks.getWorkbenchLayoutSnapshot.mockReturnValue(snapshotLoad.promise);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    setWorkbenchOverviewEntry({
      requestId: 'overview-pending',
      reason: 'mode_switch',
    });
    setWorkbenchOverviewEntrySeq((value) => value + 1);
    await flushMicrotasks();

    expect(surfaceApiMocks.enterOverview).not.toHaveBeenCalled();

    snapshotLoad.resolve({
      seq: 1,
      revision: 1,
      updated_at_unix_ms: 100,
      widgets: [],
      widget_states: [],
    });
    await flushMicrotasks();

    expect(surfaceApiMocks.enterOverview).toHaveBeenCalledTimes(1);
    expect(contextMocks.consumeWorkbenchOverviewEntry).toHaveBeenCalledWith('overview-pending');
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
          theme: 'default',
        };
      }
      return null;
    }) as any);

    mount(() => <EnvWorkbenchPage />, host);
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

    mount(() => <EnvWorkbenchPage />, host);
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
      sticky_notes: [],
      annotations: [],
      background_layers: [],
    });
    expect(layoutApiMocks.putWorkbenchLayout.mock.calls[0]?.[0]).not.toHaveProperty('mode');
    expect(layoutApiMocks.putWorkbenchLayout.mock.calls[0]?.[0]).not.toHaveProperty('activeTool');
    expect(layoutApiMocks.putWorkbenchLayout.mock.calls[0]?.[0]).not.toHaveProperty('selectedObject');

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

  it('defers remote layout acks during cross-widget owner handoff', async () => {
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
          z_index: 2,
          created_at_unix_ms: 123,
        },
        {
          widget_id: 'widget-terminal-1',
          widget_type: 'redeven.terminal',
          x: 1080,
          y: 180,
          width: 760,
          height: 560,
          z_index: 1,
          created_at_unix_ms: 124,
        },
      ],
      widget_states: [],
    });
    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123:local_state') {
        return {
          version: 1,
          viewport: { x: 80, y: 60, scale: 1 },
          locked: false,
          filters: {
            'redeven.terminal': true,
            'redeven.files': true,
            'redeven.preview': true,
          },
          selectedWidgetId: 'widget-files-1',
          theme: 'default',
          legacyLayoutMigrated: true,
        };
      }
      return null;
    }) as any);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    surfaceApiMocks.lastSetState((previous: any) => ({
      ...previous,
      selectedWidgetId: 'widget-terminal-1',
      widgets: previous.widgets.map((widget: any) => (
        widget.id === 'widget-terminal-1'
          ? { ...widget, z_index: 3 }
          : widget
      )),
    }));

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
            x: 320,
            y: 180,
            width: 760,
            height: 560,
            z_index: 2,
            created_at_unix_ms: 123,
          },
          {
            widget_id: 'widget-terminal-1',
            widget_type: 'redeven.terminal',
            x: 1080,
            y: 180,
            width: 760,
            height: 560,
            z_index: 1,
            created_at_unix_ms: 124,
          },
        ],
        widget_states: [],
      },
    });
    await flushMicrotasks();

    const surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement;
    expect(surface.dataset.selectedWidgetId).toBe('widget-terminal-1');
    expect(surface.dataset.topWidgetId).toBe('widget-terminal-1');
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

    mount(() => <EnvWorkbenchPage />, host);
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
      sticky_notes: [],
      annotations: [],
      background_layers: [],
    });
  });

  it('marks the workbench as layout-interacting until the visual settle window ends', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const page = host.querySelector('[data-testid="redeven-workbench-page"]') as HTMLElement | null;
    expect(page).toBeTruthy();
    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('false');
    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionStart();
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');
    expect(page?.classList.contains('is-layout-interacting')).toBe(true);
    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionEnd();
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');
    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();

    vi.advanceTimersByTime(89);
    await flushMicrotasks();
    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');
    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();

    vi.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('false');
    expect(page?.classList.contains('is-layout-interacting')).toBe(false);
    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();
  });

  it('keeps projected-surface drag interactions out of render transactions', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const page = host.querySelector('[data-testid="redeven-workbench-page"]') as HTMLElement | null;
    expect(page).toBeTruthy();
    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionStart('widget_drag');
    surfaceApiMocks.lastSetState((previous: any) => ({
      ...previous,
      widgets: previous.widgets,
      viewport: {
        ...previous.viewport,
        x: previous.viewport.x + 24,
        y: previous.viewport.y + 12,
      },
    }));
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');
    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionEnd('widget_drag');
    vi.advanceTimersByTime(90);
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('false');
    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();
  });

  it('opens a short render transaction only when the workbench composition mode changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const page = host.querySelector('[data-testid="redeven-workbench-page"]') as HTMLElement | null;
    expect(page).toBeTruthy();
    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();

    surfaceApiMocks.lastSetState((previous: any) => ({
      ...previous,
      mode: 'annotation',
    }));
    await flushMicrotasks();

    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBe('mode');

    vi.advanceTimersByTime(16);
    await flushMicrotasks();

    expect(page?.getAttribute('data-redeven-workbench-render-transaction')).toBeNull();
  });

  it('keeps registered workbench terminal cores live during layout interactions', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const beginVisualSuspend = vi.fn(() => ({ dispose: vi.fn() }));

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
            session_ids: ['session-1'],
          },
        },
      ],
    });
    widgetBodyMocks.renderTerminalBody = (bodyProps: any) => {
      const workbench = useEnvWorkbenchInstancesContext();
      createEffect(() => {
        const surface = document.createElement('div');
        Object.defineProperty(surface, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 320,
            bottom: 180,
            width: 320,
            height: 180,
            toJSON: () => ({}),
          }),
        });
        document.body.appendChild(surface);
        workbench.registerTerminalSurface(bodyProps.widgetId, 'session-1', surface);
        workbench.registerTerminalCore(bodyProps.widgetId, 'session-1', { beginVisualSuspend } as any);
      });
      return null;
    };

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionStart('widget_drag');
    await flushMicrotasks();

    expect(beginVisualSuspend).not.toHaveBeenCalled();

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionEnd('widget_drag');
    await flushMicrotasks();

    expect(beginVisualSuspend).not.toHaveBeenCalled();
  });

  it('keeps overlapping terminal layout interactions isolated without suspending live terminals', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const beginVisualSuspend = vi.fn(() => ({ dispose: vi.fn() }));

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
            session_ids: ['session-1'],
          },
        },
      ],
    });
    widgetBodyMocks.renderTerminalBody = (bodyProps: any) => {
      const workbench = useEnvWorkbenchInstancesContext();
      createEffect(() => {
        const surface = document.createElement('div');
        Object.defineProperty(surface, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 320,
            bottom: 180,
            width: 320,
            height: 180,
            toJSON: () => ({}),
          }),
        });
        document.body.appendChild(surface);
        workbench.registerTerminalSurface(bodyProps.widgetId, 'session-1', surface);
        workbench.registerTerminalCore(bodyProps.widgetId, 'session-1', { beginVisualSuspend } as any);
      });
      return null;
    };
    surfaceApiMocks.runViewportTransition.mockImplementation((action: () => unknown) => {
      surfaceApiMocks.lastSurfaceProps.onViewportInteractionStart('widget_maximize');
      surfaceApiMocks.viewportTransitionReleases.push(() => {
        surfaceApiMocks.lastSurfaceProps.onViewportInteractionEnd('widget_maximize');
      });
      return action();
    });

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionStart('widget_drag');
    stableSurfaceApi.runViewportTransition(() => undefined, { interactionKind: 'widget_maximize' });
    await flushMicrotasks();

    expect(beginVisualSuspend).not.toHaveBeenCalled();
    const page = host.querySelector('[data-testid="redeven-workbench-page"]') as HTMLElement | null;
    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');

    surfaceApiMocks.viewportTransitionReleases.pop()?.();
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');

    surfaceApiMocks.lastSurfaceProps.onLayoutInteractionEnd('widget_drag');
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');
    vi.advanceTimersByTime(90);
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('false');
    expect(beginVisualSuspend).not.toHaveBeenCalled();
  });

  it('marks the workbench as layout-interacting when the canvas viewport changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const page = host.querySelector('[data-testid="redeven-workbench-page"]') as HTMLElement | null;
    expect(page).toBeTruthy();
    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('false');

    surfaceApiMocks.lastSetState((previous: any) => ({
      ...previous,
      viewport: {
        ...previous.viewport,
        x: previous.viewport.x + 24,
      },
    }));
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');
    expect(page?.classList.contains('is-layout-interacting')).toBe(true);

    vi.advanceTimersByTime(89);
    await flushMicrotasks();
    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');

    vi.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('false');
    expect(page?.classList.contains('is-layout-interacting')).toBe(false);
  });

  it('marks the workbench as layout-interacting when the surface reports a viewport interaction pulse', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    const page = host.querySelector('[data-testid="redeven-workbench-page"]') as HTMLElement | null;
    expect(page).toBeTruthy();
    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('false');

    surfaceApiMocks.lastSurfaceProps.onViewportInteractionPulse();
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('true');
    expect(page?.classList.contains('is-layout-interacting')).toBe(true);

    vi.advanceTimersByTime(90);
    await flushMicrotasks();

    expect(page?.dataset.redevenWorkbenchLayoutInteracting).toBe('false');
    expect(page?.classList.contains('is-layout-interacting')).toBe(false);
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

    mount(() => <EnvWorkbenchPage />, host);
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

    mount(() => <EnvWorkbenchPage />, host);
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

  it('creates anchored terminal widgets and waits for runtime layout ack before opening a tab', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const terminalWidget = persistedWidget('widget-terminal-new', 'redeven.terminal', 'Terminal', 5, 500);
    surfaceApiMocks.createWidget.mockImplementation((_type: string, _options?: any) => {
      surfaceApiMocks.lastSetState((previous: any) => ({
        ...previous,
        widgets: [...previous.widgets, terminalWidget],
        selectedWidgetId: terminalWidget.id,
      }));
      return terminalWidget;
    });
    surfaceApiMocks.focusWidget.mockImplementation((widget: any) => widget);
    widgetBodyMocks.renderTerminalBody = (bodyProps: any) => {
      const workbench = useEnvWorkbenchInstancesContext();
      createEffect(() => {
        contextProbeState.terminalOpenRequest = workbench.terminalOpenRequest(bodyProps.widgetId);
      });
      return null;
    };

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();
    setMockCanvasFrameRect(host, 1000, 720);

    setWorkbenchSurfaceActivation({
      requestId: 'request-terminal-new',
      surfaceId: 'terminal',
      focus: true,
      ensureVisible: false,
      centerViewport: false,
      openStrategy: 'create_new',
      workbenchAnchor: { clientX: 260, clientY: 340 },
      terminalPayload: {
        workingDir: '/workspace/repo',
        preferredName: 'repo',
      },
    });
    setWorkbenchSurfaceActivationSeq((value) => value + 1);
    await flushMicrotasks();

    expect(surfaceApiMocks.createWidget).toHaveBeenCalledWith('redeven.terminal', {
      centerViewport: false,
      worldX: 180,
      worldY: 280,
    });
    expect(surfaceApiMocks.focusWidget).toHaveBeenCalledWith(terminalWidget, { centerViewport: false });
    expect(contextProbeState.terminalOpenRequest).toBeNull();
    await advanceTimersByTimeAndFlush(16);
    if (layoutApiMocks.putWorkbenchLayout.mock.calls.length === 0) {
      await advanceTimersByTimeAndFlush(16);
    }

    expect(layoutApiMocks.putWorkbenchLayout).toHaveBeenCalledWith({
      base_revision: 0,
      widgets: [
        expect.objectContaining({
          widget_id: 'widget-terminal-new',
          widget_type: 'redeven.terminal',
        }),
      ],
      sticky_notes: [],
      annotations: [],
      background_layers: [],
    });

    layoutApiMocks.lastStreamArgs.onEvent({
      seq: 2,
      type: 'layout.replaced',
      created_at_unix_ms: 600,
      payload: {
        seq: 2,
        revision: 2,
        updated_at_unix_ms: 600,
        widgets: [
          runtimeWidget('widget-terminal-new', 'redeven.terminal', 5, 500),
        ],
        widget_states: [],
      },
    });
    await flushMicrotasks();

    expect(contextProbeState.terminalOpenRequest).toMatchObject({
      requestId: 'request-terminal-new',
      widgetId: 'widget-terminal-new',
      workingDir: '/workspace/repo',
      preferredName: 'repo',
    });
    expect(contextMocks.consumeWorkbenchSurfaceActivation).toHaveBeenCalledWith('request-terminal-new');
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

    mount(() => <EnvWorkbenchPage />, host);
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

  it('focuses an existing workbench preview widget when the same file is requested again', async () => {
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
          theme: 'default',
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
    surfaceApiMocks.findWidgetById.mockReturnValue(existingWidget as any);
    layoutApiMocks.openWorkbenchPreview.mockResolvedValue(openPreviewResponse({
      requestId: 'request-preview-existing',
      widgetId: existingWidget.id,
      created: false,
      seq: 100,
      revision: 100,
      widgets: [
        {
          widget_id: existingWidget.id,
          widget_type: existingWidget.type,
          x: existingWidget.x,
          y: existingWidget.y,
          width: existingWidget.width,
          height: existingWidget.height,
          z_index: existingWidget.z_index,
          created_at_unix_ms: existingWidget.created_at_unix_ms,
        },
      ],
      item: {
        path: '/workspace/demo.txt',
        name: 'demo.txt',
        size: 12,
      },
    }));

    mount(() => <EnvWorkbenchPage />, host);
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

    expect(surfaceApiMocks.createWidget).not.toHaveBeenCalled();
    expect(layoutApiMocks.openWorkbenchPreview).toHaveBeenCalledWith(expect.objectContaining({
      request_id: 'request-preview-existing',
      open_strategy: 'same_file_or_create',
      item: expect.objectContaining({
        path: '/workspace/demo.txt',
        name: 'demo.txt',
        size: 12,
      }),
      viewport: expect.objectContaining({
        default_width: 900,
        default_height: 620,
      }),
    }));
    expect(surfaceApiMocks.focusWidget).toHaveBeenCalledWith(existingWidget, { centerViewport: true });
    expect(surfaceApiMocks.updateWidgetTitle).toHaveBeenCalledWith(existingWidget.id, 'Preview · demo.txt');
    expect(contextMocks.consumeWorkbenchFilePreviewActivation).toHaveBeenCalledWith('request-preview-existing');
  });

  it('opens a new workbench preview widget through the runtime command for a different file by default', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const existingWidget = persistedWidget('widget-preview-existing', 'redeven.preview', 'Preview · demo.txt', 7, 456);
    const newWidget = persistedWidget('widget-preview-new', 'redeven.preview', 'Preview', 8, 500);

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
          theme: 'default',
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
    surfaceApiMocks.findWidgetById.mockImplementation((widgetId: unknown) => (
      String(widgetId) === existingWidget.id ? existingWidget : (
        String(widgetId) === newWidget.id ? newWidget : null
      )
    ));
    layoutApiMocks.openWorkbenchPreview.mockResolvedValue(openPreviewResponse({
      requestId: 'request-preview-other',
      widgetId: newWidget.id,
      created: true,
      seq: 100,
      revision: 100,
      widgets: [
        {
          widget_id: existingWidget.id,
          widget_type: existingWidget.type,
          x: existingWidget.x,
          y: existingWidget.y,
          width: existingWidget.width,
          height: existingWidget.height,
          z_index: existingWidget.z_index,
          created_at_unix_ms: existingWidget.created_at_unix_ms,
        },
        {
          widget_id: newWidget.id,
          widget_type: newWidget.type,
          x: newWidget.x,
          y: newWidget.y,
          width: newWidget.width,
          height: newWidget.height,
          z_index: newWidget.z_index,
          created_at_unix_ms: newWidget.created_at_unix_ms,
        },
      ],
      item: {
        path: '/workspace/other.txt',
        name: 'other.txt',
        size: 18,
      },
    }));
    const previewBodyObservations: Array<{ item: any; request: any }> = [];
    widgetBodyMocks.renderPreviewBody = (bodyProps: any) => {
      const workbench = useEnvWorkbenchInstancesContext();
      createEffect(() => {
        const item = workbench.previewItem(bodyProps.widgetId);
        const request = workbench.previewOpenRequest(bodyProps.widgetId);
        if (bodyProps.widgetId === newWidget.id) {
          previewBodyObservations.push({ item, request });
        }
        contextProbeState.previewItem = item;
        contextProbeState.previewOpenRequest = request;
      });
      return null;
    };

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();
    setMockCanvasFrameRect(host, 1400, 900);

    setWorkbenchFilePreviewActivation({
      requestId: 'request-preview-other',
      item: {
        id: '/workspace/other.txt',
        type: 'file',
        name: 'other.txt',
        path: '/workspace/other.txt',
        size: 18,
      },
      focus: true,
      ensureVisible: true,
    });
    setWorkbenchFilePreviewActivationSeq((value) => value + 1);
    await flushMicrotasks();

    expect(surfaceApiMocks.createWidget).not.toHaveBeenCalled();
    expect(layoutApiMocks.openWorkbenchPreview).toHaveBeenCalledWith(expect.objectContaining({
      request_id: 'request-preview-other',
      open_strategy: 'same_file_or_create',
      item: expect.objectContaining({
        path: '/workspace/other.txt',
        name: 'other.txt',
        size: 18,
      }),
      viewport: expect.objectContaining({
        center_x: 620,
        center_y: 390,
        default_width: 900,
        default_height: 620,
      }),
    }));
    expect(surfaceApiMocks.focusWidget).toHaveBeenCalledWith(newWidget, { centerViewport: true });
    expect(surfaceApiMocks.updateWidgetTitle).toHaveBeenCalledWith(newWidget.id, 'Preview · other.txt');
    expect(host.querySelector('[data-testid="env-workbench-surface"]')?.getAttribute('data-widget-ids')).toBe(
      'widget-preview-existing,widget-preview-new',
    );
    expect(contextProbeState.previewOpenRequest).toMatchObject({
      requestId: 'request-preview-other',
      widgetId: newWidget.id,
      item: {
        path: '/workspace/other.txt',
        name: 'other.txt',
      },
    });
    expect(contextProbeState.previewItem).toMatchObject({
      path: '/workspace/other.txt',
      name: 'other.txt',
    });
    expect(previewBodyObservations.length).toBeGreaterThan(0);
    expect(previewBodyObservations[0]?.request).toMatchObject({
      requestId: 'request-preview-other',
      widgetId: newWidget.id,
    });
    expect(previewBodyObservations[0]?.item).toMatchObject({
      path: '/workspace/other.txt',
      name: 'other.txt',
    });
  });

  it('can still reuse the latest workbench preview widget when explicitly requested', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const latestWidget = persistedWidget('widget-preview-latest', 'redeven.preview', 'Preview · demo.txt', 7, 456);

    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123') {
        return {
          version: 1,
          widgets: [latestWidget],
          viewport: { x: 80, y: 60, scale: 1 },
          locked: false,
          filters: {
            'redeven.terminal': true,
            'redeven.files': true,
            'redeven.preview': true,
          },
          selectedWidgetId: latestWidget.id,
          theme: 'default',
        };
      }
      if (key === 'workbench:env-123:instances') {
        return {
          version: 2,
          latestWidgetIdByType: {
            'redeven.preview': latestWidget.id,
          },
          terminalPanelsByWidgetId: {},
          previewItemsByWidgetId: {
            [latestWidget.id]: {
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
    surfaceApiMocks.findWidgetById.mockImplementation((widgetId: unknown) => (
      String(widgetId) === latestWidget.id ? latestWidget : null
    ));
    layoutApiMocks.openWorkbenchPreview.mockResolvedValue(openPreviewResponse({
      requestId: 'request-preview-reuse-latest',
      widgetId: latestWidget.id,
      created: false,
      seq: 100,
      revision: 100,
      widgets: [
        {
          widget_id: latestWidget.id,
          widget_type: latestWidget.type,
          x: latestWidget.x,
          y: latestWidget.y,
          width: latestWidget.width,
          height: latestWidget.height,
          z_index: latestWidget.z_index,
          created_at_unix_ms: latestWidget.created_at_unix_ms,
        },
      ],
      item: {
        path: '/workspace/other.txt',
        name: 'other.txt',
        size: 18,
      },
      stateRevision: 2,
    }));

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    setWorkbenchFilePreviewActivation({
      requestId: 'request-preview-reuse-latest',
      item: {
        id: '/workspace/other.txt',
        type: 'file',
        name: 'other.txt',
        path: '/workspace/other.txt',
        size: 18,
      },
      focus: true,
      ensureVisible: true,
      openStrategy: 'focus_latest_or_create',
    });
    setWorkbenchFilePreviewActivationSeq((value) => value + 1);
    await flushMicrotasks();

    expect(surfaceApiMocks.createWidget).not.toHaveBeenCalled();
    expect(layoutApiMocks.openWorkbenchPreview).toHaveBeenCalledWith(expect.objectContaining({
      request_id: 'request-preview-reuse-latest',
      open_strategy: 'focus_latest_or_create',
      item: expect.objectContaining({
        path: '/workspace/other.txt',
      }),
    }));
    expect(surfaceApiMocks.focusWidget).toHaveBeenCalledWith(latestWidget, { centerViewport: true });
    expect(surfaceApiMocks.updateWidgetTitle).toHaveBeenCalledWith(latestWidget.id, 'Preview · other.txt');
  });

  it('falls back to the previous focused widget when the selected widget is closed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const filesWidget = persistedWidget('widget-files-1', 'redeven.files', 'Files', 1, 100);
    const previewWidget = persistedWidget('widget-preview-1', 'redeven.preview', 'Preview', 2, 110);
    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123') {
        return {
          version: 1,
          widgets: [filesWidget, previewWidget],
          viewport: { x: 80, y: 60, scale: 1 },
          locked: false,
          filters: {
            'redeven.terminal': true,
            'redeven.files': true,
            'redeven.preview': true,
          },
          selectedWidgetId: filesWidget.id,
          theme: 'default',
        };
      }
      return null;
    }) as any);
    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 1,
      revision: 1,
      updated_at_unix_ms: 120,
      widgets: [
        runtimeWidget('widget-files-1', 'redeven.files', 1, 100),
        runtimeWidget('widget-preview-1', 'redeven.preview', 2, 110),
      ],
      widget_states: [],
    });

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    surfaceApiMocks.lastSetState((previous: any) => ({
      ...previous,
      selectedWidgetId: previewWidget.id,
    }));
    await flushMicrotasks();

    surfaceApiMocks.lastSurfaceProps.onRequestDelete(previewWidget.id);
    await flushMicrotasks();

    const surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement | null;
    expect(surface?.dataset.selectedWidgetId).toBe(previewWidget.id);
    expect(surface?.dataset.widgetIds).toBe(`${filesWidget.id},${previewWidget.id}`);
    vi.advanceTimersByTime(48);
    await flushMicrotasks();

    expect(surface?.dataset.selectedWidgetId).toBe(filesWidget.id);
    expect(surface?.dataset.widgetIds).toBe(filesWidget.id);
    expect(surface?.dataset.viewportX).toBe('80');
    expect(surface?.dataset.viewportY).toBe('60');
    expect(surface?.dataset.viewportScale).toBe('1');
  });

  it('does not revive an older widget that was closed before the current widget', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const filesWidget = persistedWidget('widget-files-1', 'redeven.files', 'Files', 1, 100);
    const previewWidget = persistedWidget('widget-preview-1', 'redeven.preview', 'Preview', 2, 110);
    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123') {
        return {
          version: 1,
          widgets: [filesWidget, previewWidget],
          viewport: { x: 80, y: 60, scale: 1 },
          locked: false,
          filters: {
            'redeven.terminal': true,
            'redeven.files': true,
            'redeven.preview': true,
          },
          selectedWidgetId: filesWidget.id,
          theme: 'default',
        };
      }
      return null;
    }) as any);
    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 1,
      revision: 1,
      updated_at_unix_ms: 120,
      widgets: [
        runtimeWidget('widget-files-1', 'redeven.files', 1, 100),
        runtimeWidget('widget-preview-1', 'redeven.preview', 2, 110),
      ],
      widget_states: [],
    });

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    surfaceApiMocks.lastSetState((previous: any) => ({
      ...previous,
      selectedWidgetId: previewWidget.id,
    }));
    await flushMicrotasks();

    surfaceApiMocks.lastSurfaceProps.onRequestDelete(filesWidget.id);
    await flushMicrotasks();

    let surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement | null;
    expect(surface?.dataset.widgetIds).toBe(`${filesWidget.id},${previewWidget.id}`);
    vi.advanceTimersByTime(48);
    await flushMicrotasks();

    expect(surface?.dataset.selectedWidgetId).toBe(previewWidget.id);
    expect(surface?.dataset.widgetIds).toBe(previewWidget.id);

    surfaceApiMocks.lastSurfaceProps.onRequestDelete(previewWidget.id);
    await flushMicrotasks();

    surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement | null;
    expect(surface?.dataset.widgetIds).toBe(previewWidget.id);
    vi.advanceTimersByTime(48);
    await flushMicrotasks();

    expect(surface?.dataset.selectedWidgetId).toBe('');
    expect(surface?.dataset.widgetIds).toBe('');
  });

  it('uses focus history when a runtime layout projection removes the selected widget', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const filesWidget = persistedWidget('widget-files-1', 'redeven.files', 'Files', 1, 100);
    const previewWidget = persistedWidget('widget-preview-1', 'redeven.preview', 'Preview', 2, 110);
    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123') {
        return {
          version: 1,
          widgets: [filesWidget, previewWidget],
          viewport: { x: 80, y: 60, scale: 1 },
          locked: false,
          filters: {
            'redeven.terminal': true,
            'redeven.files': true,
            'redeven.preview': true,
          },
          selectedWidgetId: filesWidget.id,
          theme: 'default',
        };
      }
      return null;
    }) as any);
    layoutApiMocks.getWorkbenchLayoutSnapshot.mockResolvedValue({
      seq: 1,
      revision: 1,
      updated_at_unix_ms: 120,
      widgets: [
        runtimeWidget('widget-files-1', 'redeven.files', 1, 100),
        runtimeWidget('widget-preview-1', 'redeven.preview', 2, 110),
      ],
      widget_states: [],
    });

    mount(() => <EnvWorkbenchPage />, host);
    await flushMicrotasks();

    surfaceApiMocks.lastSetState((previous: any) => ({
      ...previous,
      selectedWidgetId: previewWidget.id,
    }));
    await flushMicrotasks();
    vi.runOnlyPendingTimers();
    await flushMicrotasks();

    layoutApiMocks.lastStreamArgs.onEvent({
      seq: 2,
      type: 'layout.replaced',
      created_at_unix_ms: 130,
      payload: {
        seq: 2,
        revision: 2,
        updated_at_unix_ms: 130,
        widgets: [
          runtimeWidget('widget-files-1', 'redeven.files', 1, 100),
        ],
        widget_states: [],
      },
    });
    await flushMicrotasks();

    const surface = host.querySelector('[data-testid="env-workbench-surface"]') as HTMLElement | null;
    expect(surface?.dataset.selectedWidgetId).toBe(filesWidget.id);
    expect(surface?.dataset.viewportX).toBe('80');
    expect(surface?.dataset.viewportY).toBe('60');
  });
});
