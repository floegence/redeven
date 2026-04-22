import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvWorkbenchPage } from './EnvWorkbenchPage';

const storageMocks = vi.hoisted(() => ({
  isDesktopStateStorageAvailable: vi.fn(() => false),
  readUIStorageJSON: vi.fn(() => null),
  writeUIStorageJSON: vi.fn(),
  removeUIStorageItem: vi.fn(),
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
  createWorkbenchTerminalSession: vi.fn(),
  deleteWorkbenchTerminalSession: vi.fn(),
  connectWorkbenchLayoutEventStream: vi.fn(async (args: any) => {
    layoutApiState.lastStreamArgs = args;
    await new Promise<void>((resolve) => {
      args.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }),
}));

const envContextState = vi.hoisted(() => ({
  envId: 'env-123',
}));

async function flushWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: () => null,
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    env_id: () => envContextState.envId,
    connectionOverlayVisible: () => false,
    connectionOverlayMessage: () => 'Connecting to runtime...',
    workbenchSurfaceActivationSeq: () => 0,
    workbenchSurfaceActivation: () => null,
    workbenchFilePreviewActivationSeq: () => 0,
    workbenchFilePreviewActivation: () => null,
    consumeWorkbenchSurfaceActivation: vi.fn(),
    consumeWorkbenchFilePreviewActivation: vi.fn(),
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
  createWorkbenchTerminalSession: layoutApiMocks.createWorkbenchTerminalSession,
  deleteWorkbenchTerminalSession: layoutApiMocks.deleteWorkbenchTerminalSession,
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
        <button
          type="button"
          data-testid="widget-files-button"
          data-selected={String(Boolean(props.selected))}
          onClick={() => layoutApiState.clicks.push(`files:${String(Boolean(props.selected))}`)}
        >
          Files
        </button>
      ),
      defaultTitle: 'Files',
      defaultSize: { width: 360, height: 240 },
      singleton: false,
    },
    {
      type: 'redeven.terminal',
      label: 'Terminal',
      icon: () => null,
      body: (props: any) => (
        <button
          type="button"
          data-testid="widget-terminal-button"
          data-selected={String(Boolean(props.selected))}
          onClick={() => layoutApiState.clicks.push(`terminal:${String(Boolean(props.selected))}`)}
        >
          Terminal
        </button>
      ),
      defaultTitle: 'Terminal',
      defaultSize: { width: 360, height: 240 },
      singleton: false,
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
  redevenWorkbenchFilterBarWidgetTypes: [],
}));

describe('EnvWorkbenchPage click handoff', () => {
  beforeEach(() => {
    layoutApiState.lastStreamArgs = null;
    layoutApiState.clicks = [];
    storageMocks.readUIStorageJSON.mockReset();
    storageMocks.readUIStorageJSON.mockImplementation(((key: string) => {
      if (key === 'workbench:env-123:local_state') {
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
          legacyLayoutMigrated: true,
        };
      }
      return null;
    }) as any);
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
});
