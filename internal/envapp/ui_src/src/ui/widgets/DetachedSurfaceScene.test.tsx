// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetachedSurfaceScene } from './DetachedSurfaceScene';

const openAskFlowerComposer = vi.fn();
const requestDesktopAskFlowerMainWindowHandoff = vi.hoisted(() => vi.fn(() => false));
const shouldRequireDesktopAskFlowerMainWindowHandoff = vi.hoisted(() => vi.fn(() => false));
const closeDesktopWindow = vi.hoisted(() => vi.fn<() => Promise<unknown>>(async () => null));
const notificationError = vi.hoisted(() => vi.fn());
const openPreview = vi.fn(async () => undefined);
const closePreview = vi.fn();
const downloadCurrent = vi.fn(async () => undefined);
const beginEditing = vi.fn();
const updateDraft = vi.fn();
const updateSelection = vi.fn();
const saveCurrent = vi.fn(async () => true);
const revertCurrent = vi.fn();
const writeTextToClipboard = vi.hoisted(() => vi.fn(async () => undefined));
const createDebugConsoleControllerMock = vi.hoisted(() => vi.fn(() => ({
  enabled: () => true,
  minimized: () => false,
  open: () => true,
  show: vi.fn(),
  restore: vi.fn(),
  minimize: vi.fn(),
  loading: () => false,
  refreshing: () => false,
  runtimeEnabled: () => true,
  collectUIMetrics: () => true,
  uiMetricsCollecting: () => true,
  snapshotError: () => null,
  streamConnected: () => true,
  streamError: () => null,
  stateDir: () => '/tmp/redeven',
  lastSnapshotAt: () => '2026-03-27T10:00:03Z',
  lastEventAt: () => '',
  captureCutoffAt: () => '',
  serverEvents: () => [],
  stats: () => ({ total_events: 0, agent_events: 0, desktop_events: 0, slow_events: 0, trace_count: 0 }),
  slowSummary: () => [],
  traces: () => [],
  performanceSnapshot: () => ({
    collecting: true,
    supported: { longtask: true, layout_shift: true, paint: true, navigation: true, memory: false, mutation_observer: true, interaction_latency: true },
    fps: { current: 60, average: 60, low: 60, samples: 1 },
    frame_timing: { long_frame_count: 0, max_frame_ms: 0, last_frame_ms: 0 },
    interactions: { count: 0, max_paint_delay_ms: 0 },
    dom_activity: { mutation_batches: 0, mutation_records: 0, nodes_added: 0, nodes_removed: 0, attributes_changed: 0, text_changed: 0, max_batch_records: 0 },
    long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
    layout_shift: { count: 0, total_score: 0, max_score: 0 },
    paints: {},
    navigation: {},
    recent_events: [],
  }),
  exporting: () => false,
  lastExportAt: () => '',
  refresh: vi.fn(async () => undefined),
  clear: vi.fn(async () => undefined),
  closeConsole: vi.fn(async () => undefined),
  resetRuntimeState: vi.fn(),
  exportBundle: vi.fn(async () => ({
    exported_at: '2026-03-27T10:00:05Z',
    ui_state: { visible: true, minimized: false },
    runtime: { diagnostics_enabled: true, ui_metrics_enabled: true, stream_connected: true },
    diagnostics: {
      enabled: true,
      exported_at: '2026-03-27T10:00:05Z',
      snapshot: {
        recent_events: [],
        slow_summary: [],
        stats: { total_events: 0, agent_events: 0, desktop_events: 0, slow_events: 0, trace_count: 0 },
      },
      agent_events: [],
      desktop_events: [],
    },
    ui_performance: {
      collecting: true,
      supported: { longtask: true, layout_shift: true, paint: true, navigation: true, memory: false, mutation_observer: true, interaction_latency: true },
      fps: { current: 60, average: 60, low: 60, samples: 1 },
      frame_timing: { long_frame_count: 0, max_frame_ms: 0, last_frame_ms: 0 },
      interactions: { count: 0, max_paint_delay_ms: 0 },
      dom_activity: { mutation_batches: 0, mutation_records: 0, nodes_added: 0, nodes_removed: 0, attributes_changed: 0, text_changed: 0, max_batch_records: 0 },
      long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
      layout_shift: { count: 0, total_score: 0, max_score: 0 },
      paints: {},
      navigation: {},
      recent_events: [],
    },
  })),
})));
const protocolState: {
  status: () => string;
  client: () => Record<string, never> | null;
} = {
  status: () => 'connected',
  client: () => ({}),
};

const previewItem = {
  id: '/workspace/demo.txt',
  name: 'demo.txt',
  path: '/workspace/demo.txt',
  type: 'file' as const,
};

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => ({
    error: notificationError,
  }),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" class={props.class} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => protocolState,
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    openAskFlowerComposer,
  }),
}));

vi.mock('../services/desktopAskFlowerBridge', () => ({
  requestDesktopAskFlowerMainWindowHandoff,
  shouldRequireDesktopAskFlowerMainWindowHandoff,
}));

vi.mock('../services/desktopShellBridge', () => ({
  closeDesktopWindow,
}));

vi.mock('../utils/clipboard', () => ({
  writeTextToClipboard,
}));

vi.mock('./DesktopDetachedWindowFrame', () => ({
  DesktopDetachedWindowFrame: (props: any) => (
    <div
      data-testid="desktop-detached-window-frame"
      data-title={props.title}
      data-subtitle={props.subtitle ?? ''}
    >
      <div data-testid="detached-frame-banner">{props.banner}</div>
      <div data-testid="detached-frame-actions">{props.headerActions}</div>
      <div data-testid="detached-frame-body">{props.children}</div>
      <div data-testid="detached-frame-footer">{props.footer}</div>
    </div>
  ),
}));

vi.mock('../debugConsole/createDebugConsoleController', () => ({
  createDebugConsoleController: createDebugConsoleControllerMock,
}));

vi.mock('../debugConsole/DebugConsoleWindow', () => ({
  DebugConsolePanel: (props: any) => (
    <div data-testid="detached-debug-console-panel" data-close-label={props.closeLabel ?? ''}>
      debug console panel
      <button type="button" onClick={props.onClose}>Close</button>
    </div>
  ),
  DebugConsoleFooter: () => <div data-testid="detached-debug-console-footer">debug console footer</div>,
}));

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    controller: {
      openPreview,
      closePreview,
      downloadCurrent,
      beginEditing,
      updateDraft,
      updateSelection,
      saveCurrent,
      revertCurrent,
      item: () => previewItem,
      descriptor: () => ({ mode: 'text', textPresentation: 'plain', wrapText: true }),
      text: () => 'selected line',
      draftText: () => 'selected line',
      editing: () => false,
      dirty: () => false,
      saving: () => false,
      saveError: () => null,
      selectedText: () => 'selected from controller',
      canEdit: () => true,
      closeConfirmOpen: () => false,
      closeConfirmMessage: () => '',
      message: () => '',
      objectUrl: () => '',
      bytes: () => null,
      truncated: () => false,
      loading: () => false,
      error: () => null,
      xlsxSheetName: () => '',
      xlsxRows: () => [],
      downloadLoading: () => false,
    },
  }),
}));

vi.mock('./FilePreviewContent', () => ({
  FilePreviewContent: (props: any) => (
    <div
      data-testid="preview-content"
      data-show-header={String(props.showHeader !== false)}
      data-can-edit={String(Boolean(props.canEdit))}
      data-editing={String(Boolean(props.editing))}
      data-has-copy-path={String(typeof props.onCopyPath === 'function')}
      ref={props.contentRef}
    >
      {props.item?.path}
    </div>
  ),
}));

vi.mock('./RemoteFileBrowser', () => ({
  RemoteFileBrowser: (props: any) => (
    <div
      data-testid="detached-file-browser"
      data-state-scope={props.stateScope}
      data-initial-path={props.initialPathOverride}
      data-home-path={props.homePathOverride}
    />
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
  openAskFlowerComposer.mockReset();
  requestDesktopAskFlowerMainWindowHandoff.mockReset();
  requestDesktopAskFlowerMainWindowHandoff.mockReturnValue(false);
  shouldRequireDesktopAskFlowerMainWindowHandoff.mockReset();
  shouldRequireDesktopAskFlowerMainWindowHandoff.mockReturnValue(false);
  closeDesktopWindow.mockReset();
  closeDesktopWindow.mockResolvedValue(null);
  notificationError.mockReset();
  openPreview.mockClear();
  closePreview.mockClear();
  downloadCurrent.mockClear();
  beginEditing.mockClear();
  updateDraft.mockClear();
  updateSelection.mockClear();
  saveCurrent.mockClear();
  revertCurrent.mockClear();
  writeTextToClipboard.mockReset();
  writeTextToClipboard.mockResolvedValue(undefined);
  createDebugConsoleControllerMock.mockClear();
  protocolState.status = () => 'connected';
  protocolState.client = () => ({});
  vi.restoreAllMocks();
});

describe('DetachedSurfaceScene', () => {
  it('mounts a focused preview scene and routes actions through the shared preview controller', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_preview', path: '/workspace/demo.txt' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    expect(openPreview).toHaveBeenCalledWith(previewItem);
    expect(document.title).toBe('demo.txt - File Preview');
    expect(host.querySelector('[data-testid="desktop-detached-window-frame"]')?.getAttribute('data-title')).toBe('demo.txt');
    expect(host.querySelector('[data-testid="desktop-detached-window-frame"]')?.getAttribute('data-subtitle')).toBe('/workspace/demo.txt');
    expect(host.querySelector('[data-testid="preview-content"]')?.getAttribute('data-can-edit')).toBe('true');
    expect(host.querySelector('[data-testid="preview-content"]')?.getAttribute('data-show-header')).toBe('false');
    expect(host.querySelector('[data-testid="preview-content"]')?.getAttribute('data-has-copy-path')).toBe('false');

    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      toString: () => 'selected line',
      getRangeAt: () => ({ commonAncestorContainer: host.querySelector('[data-testid="preview-content"]') }) as unknown as Range,
    } as unknown as Selection);

    const buttons = Array.from(host.querySelectorAll('button'));
    buttons.find((button) => button.textContent?.includes('Edit'))?.click();
    buttons.find((button) => button.textContent?.includes('Ask Flower'))?.click();
    buttons.find((button) => button.textContent?.includes('Download'))?.click();

    expect(beginEditing).toHaveBeenCalledTimes(1);
    expect(openAskFlowerComposer).toHaveBeenCalledTimes(1);
    expect(openAskFlowerComposer).toHaveBeenCalledWith(expect.objectContaining({
      source: 'file_preview',
      contextItems: expect.arrayContaining([
        expect.objectContaining({
          path: '/workspace/demo.txt',
          selection: 'selected from controller',
        }),
      ]),
    }));
    expect(downloadCurrent).toHaveBeenCalledTimes(1);
  });

  it('copies the detached preview path through the shared clipboard helper', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_preview', path: '/workspace/demo.txt' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    const copyButton = host.querySelector('button[aria-label="Copy path"]') as HTMLButtonElement | null;
    copyButton?.click();
    await Promise.resolve();

    expect(writeTextToClipboard).toHaveBeenCalledWith('/workspace/demo.txt');
  });

  it('prefers the desktop main-window handoff before falling back to the local composer', () => {
    requestDesktopAskFlowerMainWindowHandoff.mockReturnValue(true);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_preview', path: '/workspace/demo.txt' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      toString: () => 'selected line',
      getRangeAt: () => ({ commonAncestorContainer: host.querySelector('[data-testid="preview-content"]') }) as unknown as Range,
    } as unknown as Selection);

    const askFlowerButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Ask Flower'));
    askFlowerButton?.click();

    expect(requestDesktopAskFlowerMainWindowHandoff).toHaveBeenCalledWith({
      source: 'file_preview',
      path: '/workspace/demo.txt',
      selectionText: 'selected from controller',
    });
    expect(openAskFlowerComposer).not.toHaveBeenCalled();
  });

  it('shows an error instead of opening a local composer when desktop handoff is required but unavailable', () => {
    shouldRequireDesktopAskFlowerMainWindowHandoff.mockReturnValue(true);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_preview', path: '/workspace/demo.txt' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      toString: () => 'selected line',
      getRangeAt: () => ({ commonAncestorContainer: host.querySelector('[data-testid="preview-content"]') }) as unknown as Range,
    } as unknown as Selection);

    const askFlowerButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Ask Flower'));
    askFlowerButton?.click();

    expect(requestDesktopAskFlowerMainWindowHandoff).toHaveBeenCalledWith({
      source: 'file_preview',
      path: '/workspace/demo.txt',
      selectionText: 'selected from controller',
    });
    expect(notificationError).toHaveBeenCalledWith(
      'Ask Flower unavailable',
      'Redeven Desktop could not route Ask Flower to the main window. Reopen the main window and try again.',
    );
    expect(openAskFlowerComposer).not.toHaveBeenCalled();
  });

  it('renders the detached file browser scene with isolated state scope', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_browser', path: '/workspace', homePath: '/Users/demo' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    const scene = host.querySelector('[data-testid="detached-file-browser"]');
    expect(scene?.getAttribute('data-state-scope')).toBe('detached-surface');
    expect(scene?.getAttribute('data-initial-path')).toBe('/workspace');
    expect(scene?.getAttribute('data-home-path')).toBe('/Users/demo');
    expect(host.querySelector('[data-testid="desktop-detached-window-frame"]')?.getAttribute('data-title')).toBe('File Browser');
    expect(host.querySelector('[data-testid="desktop-detached-window-frame"]')?.getAttribute('data-subtitle')).toBe('/workspace');
    expect(document.title).toBe('/workspace - File Browser');
  });

  it('waits for the shared protocol client before opening detached previews', () => {
    protocolState.status = () => 'connecting';
    protocolState.client = () => null;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_preview', path: '/workspace/demo.txt' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    expect(openPreview).not.toHaveBeenCalled();
  });

  it('hides preview actions while the access gate is blocking detached content', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'file_preview', path: '/workspace/demo.txt' }}
        accessGateVisible
        accessGatePanel={<div data-testid="detached-access-gate">gate</div>}
      />
    ), host);

    expect(host.querySelector('[data-testid="detached-access-gate"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="preview-content"]')).toBeNull();
    expect(host.querySelector('[data-testid="detached-frame-actions"]')?.textContent).toBe('');
    expect(host.querySelector('[data-testid="detached-frame-footer"]')?.textContent).toBe('');
  });

  it('renders Debug Console as a detached desktop scene', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'debug_console' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    expect(createDebugConsoleControllerMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="desktop-detached-window-frame"]')?.getAttribute('data-title')).toBe('Debug Console');
    expect(host.querySelector('[data-testid="desktop-detached-window-frame"]')?.getAttribute('data-subtitle')).toBe('Detached desktop diagnostics window');
    expect(host.querySelector('[data-testid="detached-debug-console-panel"]')?.getAttribute('data-close-label')).toBe('Close Window');
    expect(host.querySelector('[data-testid="detached-debug-console-footer"]')).toBeTruthy();
    expect(document.title).toBe('Debug Console');
  });

  it('prefers the desktop shell close bridge for detached debug console windows', async () => {
    closeDesktopWindow.mockResolvedValue({
      ok: true,
      performed: true,
      state: null,
      message: undefined,
    });
    const windowClose = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'debug_console' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    const closeButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Close');
    closeButton?.click();
    await Promise.resolve();

    expect(closeDesktopWindow).toHaveBeenCalledTimes(1);
    expect(windowClose).not.toHaveBeenCalled();
  });

  it('falls back to window.close when the desktop shell close bridge is unavailable', async () => {
    closeDesktopWindow.mockResolvedValue(null);
    const windowClose = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DetachedSurfaceScene
        surface={{ kind: 'debug_console' }}
        accessGateVisible={false}
        accessGatePanel={<div>gate</div>}
      />
    ), host);

    const closeButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Close');
    closeButton?.click();
    await Promise.resolve();

    expect(closeDesktopWindow).toHaveBeenCalledTimes(1);
    expect(windowClose).toHaveBeenCalledTimes(1);
  });
});
