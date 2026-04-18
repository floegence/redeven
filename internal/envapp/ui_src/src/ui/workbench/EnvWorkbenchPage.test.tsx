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
  focusWidget: vi.fn(),
  lastWidgetDefinitions: null as any,
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
    consumeWorkbenchSurfaceActivation: contextMocks.consumeWorkbenchSurfaceActivation,
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
      singleton: true,
    },
    {
      type: 'redeven.files',
      label: 'Files',
      icon: () => null,
      body: () => null,
      defaultTitle: 'Files',
      defaultSize: { width: 720, height: 520 },
      singleton: true,
    },
  ],
}));

vi.mock('@floegence/floe-webapp-core/workbench', () => ({
  WorkbenchSurface: (props: any) => {
    surfaceApiMocks.lastWidgetDefinitions = props.widgetDefinitions;
    props.onApiReady?.({
      ensureWidget: surfaceApiMocks.ensureWidget,
      focusWidget: surfaceApiMocks.focusWidget,
      findWidgetByType: vi.fn(() => null),
    });
    return <div data-testid="env-workbench-surface" />;
  },
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
    surfaceApiMocks.focusWidget.mockReset();
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

    const ensuredWidget = { id: 'widget-files-1' };
    surfaceApiMocks.ensureWidget.mockReturnValue(ensuredWidget);

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

    expect(surfaceApiMocks.ensureWidget).toHaveBeenCalledWith('redeven.files', { centerViewport: false });
    expect(surfaceApiMocks.focusWidget).toHaveBeenCalledWith(ensuredWidget, { centerViewport: false });
    expect(contextMocks.consumeWorkbenchSurfaceActivation).toHaveBeenCalledWith('request-files');
    expect(surfaceApiMocks.lastWidgetDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'redeven.terminal', singleton: true }),
      expect.objectContaining({ type: 'redeven.files', singleton: true }),
    ]));
  });

  it('ensures a widget without focusing when the activation request disables focus', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    surfaceApiMocks.ensureWidget.mockReturnValue({ id: 'widget-terminal-1' });

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

    expect(surfaceApiMocks.ensureWidget).toHaveBeenCalledWith('redeven.terminal', { centerViewport: true });
    expect(surfaceApiMocks.focusWidget).not.toHaveBeenCalled();
    expect(contextMocks.consumeWorkbenchSurfaceActivation).toHaveBeenCalledWith('request-terminal');
  });
});
