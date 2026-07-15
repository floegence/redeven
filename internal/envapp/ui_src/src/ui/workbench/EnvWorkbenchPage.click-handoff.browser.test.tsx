import { page } from 'vitest/browser';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvWorkbenchPage } from './EnvWorkbenchPage';

const storageMocks = vi.hoisted(() => ({
  createUIStorageAdapter: vi.fn(() => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    keys: () => [],
  })),
  isDesktopStateStorageAvailable: vi.fn(() => false),
  readUIStorageItem: vi.fn(() => null),
  writeUIStorageItem: vi.fn(),
  readUIStorageJSON: vi.fn(() => null),
  writeUIStorageJSON: vi.fn(),
  removeUIStorageItem: vi.fn(),
  rendererScopedUIStorageKey: vi.fn((key: string) => key),
  readRendererScopedUIStorageItem: vi.fn(() => null),
  writeRendererScopedUIStorageItem: vi.fn(),
  removeRendererScopedUIStorageItem: vi.fn(),
  readRendererScopedUIStorageJSON: vi.fn((_key: string, fallback: unknown) => fallback),
  writeRendererScopedUIStorageJSON: vi.fn(),
}));

const layoutApiState = vi.hoisted(() => ({
  lastStreamArgs: null as any,
  clicks: [] as string[],
}));

const layoutApiMocks = vi.hoisted(() => ({
  getWorkbenchLayoutSnapshot: vi.fn(async (): Promise<any> => ({
    seq: 1,
    revision: 1,
    updated_at_unix_ms: 100,
    widgets: [
      {
        widget_id: 'widget-files-1',
        widget_type: 'redeven.files',
        x: 80,
        y: 80,
        width: 360,
        height: 240,
        z_index: 2,
        created_at_unix_ms: 101,
      },
      {
        widget_id: 'widget-terminal-1',
        widget_type: 'redeven.terminal',
        x: 520,
        y: 80,
        width: 360,
        height: 240,
        z_index: 1,
        created_at_unix_ms: 102,
      },
    ],
    widget_states: [],
  })),
  putWorkbenchLayout: vi.fn(async (input: any): Promise<any> => ({
    seq: Math.max(2, Number(input?.base_revision ?? 0) + 1),
    revision: Math.max(2, Number(input?.base_revision ?? 0) + 1),
    updated_at_unix_ms: 200,
    widgets: input?.widgets ?? [],
    widget_states: [],
  })),
  putWorkbenchWidgetState: vi.fn(),
  openWorkbenchPreview: vi.fn(),
  createWorkbenchTerminalSession: vi.fn(),
  deleteWorkbenchTerminalSession: vi.fn(),
  closeWorkbenchTerminalWidgetSessions: vi.fn().mockResolvedValue({ closed_session_ids: [] }),
  connectWorkbenchLayoutEventStream: vi.fn(async (args: any) => {
    layoutApiState.lastStreamArgs = args;
    await new Promise<void>((resolve) => {
      args.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }),
}));

const envContextState = vi.hoisted(() => ({
  envId: 'env-123',
  workbenchSurfaceActivationSeq: 0,
  workbenchSurfaceActivation: null as any,
  consumeWorkbenchSurfaceActivation: vi.fn(),
}));

const browserProtocolState = vi.hoisted(() => ({
  client: { id: 'browser-client' },
}));

async function flushWork() {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  await Promise.resolve();
  await Promise.resolve();
}

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    env_id: () => envContextState.envId,
    env: Object.assign(
      () => ({ permissions: { can_write: true, can_execute: true } }),
      { state: 'ready' },
    ),
    connectionOverlayVisible: () => false,
    connectionOverlayMessage: () => 'Connecting to runtime...',
    workbenchOverviewEntrySeq: () => 0,
    workbenchOverviewEntry: () => null,
    workbenchSurfaceActivationSeq: () => envContextState.workbenchSurfaceActivationSeq,
    workbenchSurfaceActivation: () => envContextState.workbenchSurfaceActivation,
    workbenchFilePreviewActivationSeq: () => 0,
    workbenchFilePreviewActivation: () => null,
    consumeWorkbenchOverviewEntry: vi.fn(),
    consumeWorkbenchSurfaceActivation: envContextState.consumeWorkbenchSurfaceActivation,
    consumeWorkbenchFilePreviewActivation: vi.fn(),
  }),
}));

vi.mock('@floegence/floe-webapp-protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@floegence/floe-webapp-protocol')>()),
  useProtocol: () => ({
    client: () => browserProtocolState.client,
    status: () => 'connected',
  }),
}));

vi.mock('../services/uiStorage', () => ({
  createUIStorageAdapter: storageMocks.createUIStorageAdapter,
  isDesktopStateStorageAvailable: storageMocks.isDesktopStateStorageAvailable,
  readUIStorageItem: storageMocks.readUIStorageItem,
  writeUIStorageItem: storageMocks.writeUIStorageItem,
  readUIStorageJSON: storageMocks.readUIStorageJSON,
  writeUIStorageJSON: storageMocks.writeUIStorageJSON,
  removeUIStorageItem: storageMocks.removeUIStorageItem,
  rendererScopedUIStorageKey: storageMocks.rendererScopedUIStorageKey,
  readRendererScopedUIStorageItem: storageMocks.readRendererScopedUIStorageItem,
  writeRendererScopedUIStorageItem: storageMocks.writeRendererScopedUIStorageItem,
  removeRendererScopedUIStorageItem: storageMocks.removeRendererScopedUIStorageItem,
  readRendererScopedUIStorageJSON: storageMocks.readRendererScopedUIStorageJSON,
  writeRendererScopedUIStorageJSON: storageMocks.writeRendererScopedUIStorageJSON,
}));

vi.mock('../services/workbenchLayoutApi', () => ({
  getWorkbenchLayoutSnapshot: layoutApiMocks.getWorkbenchLayoutSnapshot,
  putWorkbenchLayout: layoutApiMocks.putWorkbenchLayout,
  putWorkbenchWidgetState: layoutApiMocks.putWorkbenchWidgetState,
  openWorkbenchPreview: layoutApiMocks.openWorkbenchPreview,
  createWorkbenchTerminalSession: layoutApiMocks.createWorkbenchTerminalSession,
  deleteWorkbenchTerminalSession: layoutApiMocks.deleteWorkbenchTerminalSession,
  closeWorkbenchTerminalWidgetSessions: layoutApiMocks.closeWorkbenchTerminalWidgetSessions,
  connectWorkbenchLayoutEventStream: layoutApiMocks.connectWorkbenchLayoutEventStream,
  WorkbenchLayoutConflictError: class WorkbenchLayoutConflictError extends Error {},
  WorkbenchWidgetStateConflictError: class WorkbenchWidgetStateConflictError extends Error {},
}));

vi.mock('./redevenWorkbenchWidgets', () => ({
  redevenWorkbenchWidgets: [
    {
      type: 'redeven.files',
      label: 'Files',
      icon: () => null,
      body: (props: any) => (
        <div>
          <button
            type="button"
            data-testid="widget-files-button"
            data-selected={String(Boolean(props.selected))}
            onClick={() => layoutApiState.clicks.push(`files:${String(Boolean(props.selected))}`)}
          >
            Files
          </button>
          <input
            aria-label="Files input"
            data-testid="widget-files-input"
            data-selected={String(Boolean(props.selected))}
          />
        </div>
      ),
      defaultTitle: 'Files',
      defaultSize: { width: 360, height: 240 },
      singleton: false,
      renderMode: 'projected_surface',
    },
    {
      type: 'redeven.terminal',
      label: 'Terminal',
      icon: () => null,
      body: (props: any) => (
        <div>
          <button
            type="button"
            data-testid="widget-terminal-button"
            data-selected={String(Boolean(props.selected))}
            onClick={() => layoutApiState.clicks.push(`terminal:${String(Boolean(props.selected))}`)}
          >
            Terminal
          </button>
          <input
            aria-label="Terminal input"
            data-testid="widget-terminal-input"
            data-selected={String(Boolean(props.selected))}
          />
        </div>
      ),
      defaultTitle: 'Terminal',
      defaultSize: { width: 360, height: 240 },
      singleton: false,
      renderMode: 'projected_surface',
    },
    {
      type: 'redeven.preview',
      label: 'Preview',
      icon: () => null,
      body: () => null,
      defaultTitle: 'Preview',
      defaultSize: { width: 360, height: 240 },
      singleton: false,
    },
  ],
  localizedRedevenWorkbenchWidgets: (t: (key: string) => string) => [
    {
      type: 'redeven.files',
      label: t('workbench.widgets.files.label'),
      icon: () => null,
      body: (props: any) => (
        <div>
          <button
            type="button"
            data-testid="widget-files-button"
            data-selected={String(Boolean(props.selected))}
            onClick={() => layoutApiState.clicks.push(`files:${String(Boolean(props.selected))}`)}
          >
            Files
          </button>
          <input
            aria-label="Files input"
            data-testid="widget-files-input"
            data-selected={String(Boolean(props.selected))}
          />
        </div>
      ),
      defaultTitle: t('workbench.widgets.files.defaultTitle'),
      defaultSize: { width: 360, height: 240 },
      singleton: false,
      renderMode: 'projected_surface',
    },
    {
      type: 'redeven.terminal',
      label: t('workbench.widgets.terminal.label'),
      icon: () => null,
      body: (props: any) => (
        <div>
          <button
            type="button"
            data-testid="widget-terminal-button"
            data-selected={String(Boolean(props.selected))}
            onClick={() => layoutApiState.clicks.push(`terminal:${String(Boolean(props.selected))}`)}
          >
            Terminal
          </button>
          <input
            aria-label="Terminal input"
            data-testid="widget-terminal-input"
            data-selected={String(Boolean(props.selected))}
          />
        </div>
      ),
      defaultTitle: t('workbench.widgets.terminal.defaultTitle'),
      defaultSize: { width: 360, height: 240 },
      singleton: false,
      renderMode: 'projected_surface',
    },
    {
      type: 'redeven.preview',
      label: t('workbench.widgets.preview.label'),
      icon: () => null,
      body: () => null,
      defaultTitle: t('workbench.widgets.preview.defaultTitle'),
      defaultSize: { width: 360, height: 240 },
      singleton: false,
    },
  ],
  redevenWorkbenchFilterBarWidgetTypes: [],
  redevenWorkbenchInitialCanvasWidgetTypes: [],
}));

describe('EnvWorkbenchPage click handoff', () => {
  beforeEach(() => {
    layoutApiState.lastStreamArgs = null;
    layoutApiState.clicks = [];
    envContextState.workbenchSurfaceActivationSeq = 0;
    envContextState.workbenchSurfaceActivation = null;
    envContextState.consumeWorkbenchSurfaceActivation.mockReset();
    envContextState.consumeWorkbenchSurfaceActivation.mockImplementation((requestId: string) => {
      if (envContextState.workbenchSurfaceActivation?.requestId === requestId) {
        envContextState.workbenchSurfaceActivation = null;
      }
    });
    storageMocks.readUIStorageJSON.mockReset();
    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:local_preferences:env-123') {
        return {
          version: 1,
          viewport: { x: 0, y: 0, scale: 1 },
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
  });

  beforeEach(async () => {
    await page.viewport(1400, 900);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the first cross-widget click alive when a runtime layout ack lands mid-handoff', async () => {
    const host = document.createElement('div');
    host.style.width = '1400px';
    host.style.height = '900px';
    document.body.appendChild(host);

    render(() => <EnvWorkbenchPage />, host);
    await flushWork();

    const terminalButton = host.querySelector('[data-testid="widget-terminal-button"]') as HTMLButtonElement | null;
    expect(terminalButton).toBeTruthy();

    terminalButton!.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 7,
      pointerType: 'mouse',
    }));

    layoutApiState.lastStreamArgs.onEvent({
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
            x: 80,
            y: 80,
            width: 360,
            height: 240,
            z_index: 2,
            created_at_unix_ms: 101,
          },
          {
            widget_id: 'widget-terminal-1',
            widget_type: 'redeven.terminal',
            x: 520,
            y: 80,
            width: 360,
            height: 240,
            z_index: 1,
            created_at_unix_ms: 102,
          },
        ],
        widget_states: [],
      },
    });
    await flushWork();

    terminalButton!.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 7,
      pointerType: 'mouse',
    }));
    terminalButton!.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
    await flushWork();

    expect(terminalButton!.dataset.selected).toBe('true');
    expect(layoutApiState.clicks).toEqual(['terminal:true']);
  });

  it('keeps input focus after cross-widget z-index layout acks reorder runtime widgets', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => <EnvWorkbenchPage />, host);
    await flushWork();

    const filesInput = host.querySelector('[data-testid="widget-files-input"]') as HTMLInputElement | null;
    const terminalInput = host.querySelector('[data-testid="widget-terminal-input"]') as HTMLInputElement | null;
    expect(filesInput).toBeTruthy();
    expect(terminalInput).toBeTruthy();

    await page.elementLocator(terminalInput!).click();
    await flushWork();
    expect(document.activeElement).toBe(terminalInput);

    await page.elementLocator(filesInput!).click();
    await flushWork();

    expect(document.activeElement).toBe(filesInput);
    expect(filesInput!.dataset.selected).toBe('true');
  });

  it('keeps widget input focus when the min-scale HUD shortcut is clicked', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => <EnvWorkbenchPage />, host);
    await flushWork();

    const filesInput = host.querySelector('[data-testid="widget-files-input"]') as HTMLInputElement | null;
    const minButton = document.querySelector('[aria-label="Scale canvas to minimum"]') as HTMLButtonElement | null;
    expect(filesInput).toBeTruthy();
    expect(minButton).toBeTruthy();

    await page.elementLocator(filesInput!).click();
    await flushWork();
    expect(document.activeElement).toBe(filesInput);

    await page.elementLocator(minButton!).click();
    await flushWork();

    expect(document.activeElement).toBe(filesInput);
    expect(filesInput!.dataset.selected).toBe('true');
  });

  it('keeps the viewport transform stable when activating an already visible terminal widget', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);
    envContextState.workbenchSurfaceActivationSeq = 1;
    envContextState.workbenchSurfaceActivation = {
      requestId: 'request-visible-terminal',
      surfaceId: 'terminal',
      focus: true,
      ensureVisible: true,
    };

    render(() => <EnvWorkbenchPage />, host);
    await flushWork();

    const viewport = host.querySelector('.floe-infinite-canvas__viewport') as HTMLElement | null;
    const terminalWidget = host.querySelector('[data-floe-workbench-widget-id="widget-terminal-1"]') as HTMLElement | null;
    expect(viewport).toBeTruthy();
    expect(terminalWidget).toBeTruthy();
    const viewportTransform = getComputedStyle(viewport!).transform;
    const terminalTransform = getComputedStyle(terminalWidget!).transform;

    await flushWork();
    await flushWork();

    expect(getComputedStyle(viewport!).transform).toBe(viewportTransform);
    expect(getComputedStyle(terminalWidget!).transform).toBe(terminalTransform);
    expect(envContextState.consumeWorkbenchSurfaceActivation).toHaveBeenCalledTimes(1);
    expect(envContextState.consumeWorkbenchSurfaceActivation).toHaveBeenCalledWith('request-visible-terminal');
  });
});
