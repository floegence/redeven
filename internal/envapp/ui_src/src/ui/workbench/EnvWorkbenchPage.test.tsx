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

const surfaceApiMocks = vi.hoisted(() => ({
  ensureWidget: vi.fn(),
  createWidget: vi.fn(),
  focusWidget: vi.fn(),
  findWidgetById: vi.fn(() => null),
  updateWidgetTitle: vi.fn(),
  lastWidgetDefinitions: null as any,
}));

const stableSurfaceApi = vi.hoisted(() => ({
  ensureWidget: (type: any, options?: any) => surfaceApiMocks.ensureWidget(type, options),
  createWidget: (type: any, options?: any) => surfaceApiMocks.createWidget(type, options),
  focusWidget: (widget: any, options?: any) => surfaceApiMocks.focusWidget(widget, options),
  findWidgetByType: vi.fn(() => null),
  findWidgetById: (widgetId: any) => (surfaceApiMocks.findWidgetById as any)(widgetId),
  updateWidgetTitle: (widgetId: any, title: any) => (surfaceApiMocks.updateWidgetTitle as any)(widgetId, title),
}));

const contextMocks = vi.hoisted(() => ({
  consumeWorkbenchSurfaceActivation: vi.fn(),
}));

const [envId, setEnvId] = createSignal('env-123');
const [workbenchSurfaceActivationSeq, setWorkbenchSurfaceActivationSeq] = createSignal(0);
const [workbenchSurfaceActivation, setWorkbenchSurfaceActivation] = createSignal<any>(null);

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
    consumeWorkbenchSurfaceActivation: (requestId: string) => {
      contextMocks.consumeWorkbenchSurfaceActivation(requestId);
      setWorkbenchSurfaceActivation((current) => (
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
    props.onApiReady?.(stableSurfaceApi);
    return <div data-testid="env-workbench-surface" />;
  },
}));

describe('EnvWorkbenchPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setEnvId('env-123');
    setWorkbenchSurfaceActivation(null);
    setWorkbenchSurfaceActivationSeq(0);
    storageMocks.isDesktopStateStorageAvailable.mockReturnValue(false);
    storageMocks.readUIStorageJSON.mockReset();
    storageMocks.readUIStorageJSON.mockReturnValue(null);
    storageMocks.writeUIStorageJSON.mockReset();
    surfaceApiMocks.ensureWidget.mockReset();
    surfaceApiMocks.createWidget.mockReset();
    surfaceApiMocks.focusWidget.mockReset();
    surfaceApiMocks.findWidgetById.mockReset();
    surfaceApiMocks.findWidgetById.mockReturnValue(null);
    surfaceApiMocks.updateWidgetTitle.mockReset();
    surfaceApiMocks.lastWidgetDefinitions = null;
    contextMocks.consumeWorkbenchSurfaceActivation.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('hydrates and persists workbench state with the resolved workbench storage key', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <EnvWorkbenchPage />, host);
    await Promise.resolve();

    expect(storageMocks.readUIStorageJSON).toHaveBeenCalledWith('workbench:env-123', null);

    vi.advanceTimersByTime(120);

    expect(storageMocks.writeUIStorageJSON).toHaveBeenCalledWith(
      'workbench:env-123',
      expect.objectContaining({
        version: 1,
        viewport: expect.any(Object),
        widgets: expect.any(Array),
      }),
    );
  });

  it('routes workbench activation requests through the surface api and consumes the request', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const createdWidget = { id: 'widget-files-1', type: 'redeven.files' };
    surfaceApiMocks.createWidget.mockReturnValue(createdWidget);

    render(() => <EnvWorkbenchPage />, host);
    await Promise.resolve();

    setWorkbenchSurfaceActivation({
      requestId: 'request-files',
      surfaceId: 'files',
      focus: true,
      centerViewport: false,
    });
    setWorkbenchSurfaceActivationSeq((value) => value + 1);
    await Promise.resolve();

    expect(surfaceApiMocks.createWidget).toHaveBeenCalledWith('redeven.files', { centerViewport: false });
    expect(surfaceApiMocks.focusWidget).toHaveBeenCalledWith(createdWidget, { centerViewport: false });
    expect(contextMocks.consumeWorkbenchSurfaceActivation).toHaveBeenCalledWith('request-files');
    expect(surfaceApiMocks.lastWidgetDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'redeven.terminal', singleton: false }),
      expect.objectContaining({ type: 'redeven.files', singleton: false }),
    ]));
  });

  it('ensures a widget without focusing when the activation request disables focus', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    surfaceApiMocks.createWidget.mockReturnValue({ id: 'widget-terminal-1', type: 'redeven.terminal' });

    render(() => <EnvWorkbenchPage />, host);
    await Promise.resolve();

    setWorkbenchSurfaceActivation({
      requestId: 'request-terminal',
      surfaceId: 'terminal',
      focus: false,
      ensureVisible: true,
    });
    setWorkbenchSurfaceActivationSeq((value) => value + 1);
    await Promise.resolve();

    expect(surfaceApiMocks.createWidget).toHaveBeenCalledWith('redeven.terminal', { centerViewport: true });
    expect(surfaceApiMocks.focusWidget).not.toHaveBeenCalled();
    expect(contextMocks.consumeWorkbenchSurfaceActivation).toHaveBeenCalledWith('request-terminal');
  });

  it('reuses the latest persisted multi-instance widget before creating a new one', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const existingWidget = {
      id: 'widget-files-existing',
      type: 'redeven.files',
      title: 'Files · repo',
      x: 40,
      y: 40,
      width: 720,
      height: 520,
      z_index: 5,
      created_at_unix_ms: 123,
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
          },
          selectedWidgetId: existingWidget.id,
        };
      }
      if (key === 'workbench:env-123:instances') {
        return {
          version: 1,
          latestWidgetIdByType: {
            'redeven.files': existingWidget.id,
          },
          terminalPanelsByWidgetId: {},
        };
      }
      return null;
    }) as any);
    surfaceApiMocks.findWidgetById.mockReturnValue(existingWidget as any);

    render(() => <EnvWorkbenchPage />, host);
    await Promise.resolve();

    setWorkbenchSurfaceActivation({
      requestId: 'request-files-existing',
      surfaceId: 'files',
      focus: true,
      ensureVisible: true,
      openStrategy: 'focus_latest_or_create',
    });
    setWorkbenchSurfaceActivationSeq((value) => value + 1);
    await Promise.resolve();

    expect(surfaceApiMocks.findWidgetById).toHaveBeenCalled();
    expect(surfaceApiMocks.createWidget).not.toHaveBeenCalled();
    expect(surfaceApiMocks.focusWidget).toHaveBeenCalledWith(existingWidget, { centerViewport: true });
    expect(contextMocks.consumeWorkbenchSurfaceActivation).toHaveBeenCalledWith('request-files-existing');
  });
});
