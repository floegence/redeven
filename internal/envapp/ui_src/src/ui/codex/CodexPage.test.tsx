// @vitest-environment jsdom

import { createEffect } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvContext } from '../pages/EnvContext';
import { CodexPage } from './CodexPage';
import { CodexProvider, useCodexContext } from './CodexProvider';

const fetchCodexStatusMock = vi.fn();
const fetchCodexCapabilitiesMock = vi.fn();
const listCodexThreadsMock = vi.fn();
const openCodexThreadMock = vi.fn();
const startCodexThreadMock = vi.fn();
const startCodexTurnMock = vi.fn();
const steerCodexTurnMock = vi.fn();
const archiveCodexThreadMock = vi.fn();
const unarchiveCodexThreadMock = vi.fn();
const forkCodexThreadMock = vi.fn();
const interruptCodexTurnMock = vi.fn();
const startCodexReviewMock = vi.fn();
const respondToCodexRequestMock = vi.fn();
const connectCodexEventStreamMock = vi.fn();
const markCodexThreadReadMock = vi.fn(async (args: any) => ({
  is_unread: false,
  snapshot: {
    updated_at_unix_s: Math.max(0, Math.floor(Number(args?.snapshot?.updated_at_unix_s ?? 0) || 0)),
    activity_signature: String(args?.snapshot?.activity_signature ?? '').trim() || undefined,
  },
  read_state: {
    last_read_updated_at_unix_s: Math.max(0, Math.floor(Number(args?.snapshot?.updated_at_unix_s ?? 0) || 0)),
    last_seen_activity_signature: String(args?.snapshot?.activity_signature ?? '').trim() || undefined,
  },
}));
const rpcMocks = {
  fs: {
    list: vi.fn(),
  },
};
const notification = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};
const MockCodexGatewayError = vi.hoisted(() => class MockCodexGatewayError extends Error {
  errorCode: string;
  status: number;

  constructor(message: string, errorCode = '', status = 400) {
    super(message);
    this.name = 'CodexGatewayError';
    this.errorCode = errorCode;
    this.status = status;
  }
});
const fileBrowserSurfaceState = vi.hoisted(() => ({
  openBrowser: vi.fn(async () => undefined),
  open: vi.fn(() => false),
}));
const desktopStorageState = new Map<string, string>();
let lastDirectoryPickerProps: any = null;

if (typeof window !== 'undefined') {
  window.redevenDesktopStateStorage = {
    getItem: (key) => desktopStorageState.get(String(key ?? '')) ?? null,
    setItem: (key, value) => {
      desktopStorageState.set(String(key ?? ''), String(value ?? ''));
    },
    removeItem: (key) => {
      desktopStorageState.delete(String(key ?? ''));
    },
    keys: () => Array.from(desktopStorageState.keys()).sort((left, right) => left.localeCompare(right)),
  };
}

type ResizeObserverRecord = {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
};

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
  useLayout: () => ({
    sidebarActiveTab: () => 'codex',
    isMobile: () => false,
  }),
  useNotification: () => notification,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Activity: Icon,
    Code: Icon,
    FileText: Icon,
    Folder: Icon,
    Refresh: Icon,
    Send: Icon,
    Terminal: Icon,
    Trash: Icon,
  };
});

vi.mock('solid-motionone', () => ({
  Motion: {
    div: (props: any) => <div>{props.children}</div>,
  },
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => <div>{props.message}</div>,
}));

vi.mock('../chat/blocks/MarkdownBlock', () => ({
  MarkdownBlock: (props: any) => <div class={props.class}>{props.content}</div>,
}));

vi.mock('../chat/blocks/ShellBlock', () => ({
  ShellBlock: (props: any) => <div class={props.class}>{props.command}{props.output}</div>,
}));

vi.mock('../chat/blocks/ThinkingBlock', () => ({
  ThinkingBlock: (props: any) => <div class={props.class}>{props.content}</div>,
}));

vi.mock('../primitives/Tooltip', () => ({
  Tooltip: (props: any) => <div data-testid="tooltip" data-content={String(props.content ?? '')}>{props.children}</div>,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button
      type={props.type ?? 'button'}
      class={props.class}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props['aria-label']}
      title={props.title}
    >
      {props.children}
    </button>
  ),
  Card: (props: any) => <div class={props.class}>{props.children}</div>,
  CardContent: (props: any) => <div class={props.class}>{props.children}</div>,
  CardDescription: (props: any) => <p class={props.class}>{props.children}</p>,
  CardFooter: (props: any) => <div class={props.class}>{props.children}</div>,
  CardHeader: (props: any) => <div class={props.class}>{props.children}</div>,
  CardTitle: (props: any) => <div class={props.class}>{props.children}</div>,
  HighlightBlock: (props: any) => (
    <div class={`highlight-block highlight-block-${props.variant ?? 'note'} ${props.class ?? ''}`.trim()}>
      <div class="highlight-block-header">
        <span class="highlight-block-title">{props.title}</span>
      </div>
      <div class="highlight-block-content">{props.children}</div>
    </div>
  ),
  DirectoryPicker: (props: any) => (
    ((lastDirectoryPickerProps = props), props.open)
      ? (
        <div
          data-testid="directory-picker"
          data-title={props.title}
          data-initial-path={props.initialPath}
          data-home-path={props.homePath}
        >
          <button
            type="button"
            data-testid="directory-picker-select"
            onClick={() => props.onSelect?.('/ui')}
          >
            Select /ui
          </button>
          <button
            type="button"
            data-testid="directory-picker-close"
            onClick={() => props.onOpenChange?.(false)}
          >
            Close
          </button>
        </div>
      )
      : null
  ),
  Input: (props: any) => (
    <input
      type={props.type}
      class={props.class}
      value={props.value ?? ''}
      disabled={props.disabled}
      placeholder={props.placeholder}
      onInput={(event) => props.onInput?.(event)}
    />
  ),
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
  Select: (props: any) => (
    <select
      class={props.class}
      value={props.value ?? ''}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.(event.currentTarget.value)}
      aria-label={props['aria-label']}
    >
      <option value="">{props.placeholder ?? ''}</option>
      {(props.options ?? []).map((option: any) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
  Textarea: (props: any) => (
    <textarea
      class={props.class}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      rows={props.rows}
      onInput={(event) => props.onInput?.(event)}
      onKeyDown={(event) => props.onKeyDown?.(event)}
      onCompositionStart={(event) => props.onCompositionStart?.(event)}
      onCompositionEnd={(event) => props.onCompositionEnd?.(event)}
    />
  ),
  ProcessingIndicator: (props: any) => <div class={props.class}>{props.status}</div>,
}));

vi.mock('./api', () => ({
  CodexGatewayError: MockCodexGatewayError,
  fetchCodexStatus: (...args: any[]) => fetchCodexStatusMock(...args),
  fetchCodexCapabilities: (...args: any[]) => fetchCodexCapabilitiesMock(...args),
  listCodexThreads: (...args: any[]) => listCodexThreadsMock(...args),
  openCodexThread: (...args: any[]) => openCodexThreadMock(...args),
  startCodexThread: (...args: any[]) => startCodexThreadMock(...args),
  startCodexTurn: (...args: any[]) => startCodexTurnMock(...args),
  steerCodexTurn: (...args: any[]) => steerCodexTurnMock(...args),
  archiveCodexThread: (...args: any[]) => archiveCodexThreadMock(...args),
  unarchiveCodexThread: (...args: any[]) => unarchiveCodexThreadMock(...args),
  forkCodexThread: (...args: any[]) => forkCodexThreadMock(...args),
  interruptCodexTurn: (...args: any[]) => interruptCodexTurnMock(...args),
  startCodexReview: (...args: any[]) => startCodexReviewMock(...args),
  markCodexThreadRead: (args: any) => markCodexThreadReadMock(args),
  respondToCodexRequest: (...args: any[]) => respondToCodexRequestMock(...args),
  connectCodexEventStream: (...args: any[]) => connectCodexEventStreamMock(...args),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => rpcMocks,
}));

vi.mock('../widgets/FileBrowserSurfaceContext', () => ({
  useFileBrowserSurfaceContext: () => ({
    controller: {
      open: fileBrowserSurfaceState.open,
    },
    openBrowser: fileBrowserSurfaceState.openBrowser,
    closeBrowser: vi.fn(),
  }),
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (typeof window.requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const handle = window.requestAnimationFrame(() => finish());
      window.setTimeout(() => {
        if (!settled && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(handle);
        }
        finish();
      }, 0);
    });
  }
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushOpenThreadRequests(): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pending = openCodexThreadMock.mock.results
      .map((result) => result.value)
      .filter((value): value is Promise<unknown> => Boolean(value) && typeof (value as Promise<unknown>).then === 'function');
    if (pending.length > 0) {
      await Promise.allSettled(pending);
      await flushAsync();
      return;
    }
    await flushAsync();
  }
}

async function waitForCondition(
  condition: () => boolean,
  label: string,
  attempts = 12,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await flushAsync();
    await flushOpenThreadRequests();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function clickFab(button: HTMLButtonElement): void {
  (button as any).setPointerCapture = vi.fn();
  (button as any).releasePointerCapture = vi.fn();

  const pointerDown = new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
  const pointerUp = new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(pointerUp, 'pointerId', { value: 1 });

  button.dispatchEvent(pointerDown);
  button.dispatchEvent(pointerUp);
}

function createRafHarness() {
  const queue = new Map<number, FrameRequestCallback>();
  let nextID = 1;
  let nextTimestamp = 16;
  const flushOne = (timestamp = nextTimestamp): void => {
    const first = queue.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!first) return;
    const [id, callback] = first;
    queue.delete(id);
    callback(timestamp);
    nextTimestamp = timestamp + 16;
  };
  const flushAll = (): void => {
    while (queue.size > 0) {
      flushOne();
    }
  };

  return {
    requestAnimationFrame(callback: FrameRequestCallback): number {
      const id = nextID;
      nextID += 1;
      queue.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      queue.delete(id);
    },
    flushOne,
    flushAll,
  };
}

function installResizeObserverHarness() {
  const records: ResizeObserverRecord[] = [];
  class MockResizeObserver {
    private readonly record: ResizeObserverRecord;

    constructor(callback: ResizeObserverCallback) {
      this.record = {
        callback,
        targets: new Set<Element>(),
      };
      records.push(this.record);
    }

    observe(target: Element) {
      this.record.targets.add(target);
    }

    disconnect() {
      this.record.targets.clear();
    }

    unobserve(target: Element) {
      this.record.targets.delete(target);
    }
  }

  vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);

  return {
    notify(target: Element) {
      for (const record of records) {
        if (!record.targets.has(target)) continue;
        record.callback([
          {
            target,
            contentRect: target.getBoundingClientRect(),
            contentBoxSize: [{ inlineSize: target.getBoundingClientRect().width, blockSize: target.getBoundingClientRect().height }],
          } as unknown as ResizeObserverEntry,
        ], {} as ResizeObserver);
      }
    },
  };
}

function installTranscriptScrollMetrics(args: {
  getScrollHeight: () => number;
  clientHeight?: number;
}) {
  const clientHeight = args.clientHeight ?? 120;
  const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).getAttribute('data-codex-transcript-scroll-region') === 'true'
        ? args.getScrollHeight()
        : 0;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).getAttribute('data-codex-transcript-scroll-region') === 'true'
        ? clientHeight
        : 0;
    },
  });

  return () => {
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
    } else {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    } else {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  };
}

function expectedTranscriptBottomScrollTop(scrollHeight: number, clientHeight = 120): number {
  return Math.max(0, scrollHeight - clientHeight);
}

function installScrollContainerRect(container: HTMLElement, top: number, height: number): void {
  container.getBoundingClientRect = () => ({
    x: 0,
    y: top,
    width: 320,
    height,
    top,
    bottom: top + height,
    left: 0,
    right: 320,
    toJSON() {
      return {};
    },
  } as DOMRect);
}

function installTranscriptRowRect(
  row: HTMLElement,
  container: HTMLElement,
  metrics: Readonly<{ top: () => number; height: () => number }>,
): void {
  row.getBoundingClientRect = () => {
    const containerRect = container.getBoundingClientRect();
    const top = containerRect.top + metrics.top() - container.scrollTop;
    const height = metrics.height();
    return {
      x: 0,
      y: top,
      width: 320,
      height,
      top,
      bottom: top + height,
      left: 0,
      right: 320,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
}

function renderPage(host: HTMLDivElement) {
  render(() => (
    <EnvContext.Provider
      value={{
        env_id: () => 'env_1',
        env: (() => null) as any,
        localRuntime: () => null,
        connect: async () => undefined,
        connecting: () => false,
        connectError: () => null,
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
        goTab: () => undefined,
        filesSidebarOpen: () => false,
        setFilesSidebarOpen: () => undefined,
        toggleFilesSidebar: () => undefined,
        settingsSeq: () => 1,
        bumpSettingsSeq: () => undefined,
        openSettings: () => undefined,
        debugConsoleEnabled: () => false,
        setDebugConsoleEnabled: () => undefined,
        openDebugConsole: () => undefined,
        settingsFocusSeq: () => 0,
        settingsFocusSection: () => null,
        askFlowerIntentSeq: () => 0,
        askFlowerIntent: () => null,
        injectAskFlowerIntent: () => undefined,
        openAskFlowerComposer: () => undefined,
        openTerminalInDirectoryRequestSeq: () => 0,
        openTerminalInDirectoryRequest: () => null,
        openTerminalInDirectory: () => undefined,
        consumeOpenTerminalInDirectoryRequest: () => undefined,
        aiThreadFocusSeq: () => 0,
        aiThreadFocusId: () => null,
        focusAIThread: () => undefined,
      }}
    >
      <CodexProvider>
        <CodexPage />
      </CodexProvider>
    </EnvContext.Provider>
  ), host);
}

function CodexHarness(props: { onReady: (codex: ReturnType<typeof useCodexContext>) => void }) {
  const codex = useCodexContext();
  createEffect(() => {
    if (codex.statusLoading()) return;
    props.onReady(codex);
  });
  return null;
}

function renderProviderHarness(
  host: HTMLDivElement,
  onReady: (codex: ReturnType<typeof useCodexContext>) => void,
) {
  render(() => (
    <EnvContext.Provider
      value={{
        env_id: () => 'env_1',
        env: (() => null) as any,
        localRuntime: () => null,
        connect: async () => undefined,
        connecting: () => false,
        connectError: () => null,
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
        goTab: () => undefined,
        filesSidebarOpen: () => false,
        setFilesSidebarOpen: () => undefined,
        toggleFilesSidebar: () => undefined,
        settingsSeq: () => 1,
        bumpSettingsSeq: () => undefined,
        openSettings: () => undefined,
        debugConsoleEnabled: () => false,
        setDebugConsoleEnabled: () => undefined,
        openDebugConsole: () => undefined,
        settingsFocusSeq: () => 0,
        settingsFocusSection: () => null,
        askFlowerIntentSeq: () => 0,
        askFlowerIntent: () => null,
        injectAskFlowerIntent: () => undefined,
        openAskFlowerComposer: () => undefined,
        openTerminalInDirectoryRequestSeq: () => 0,
        openTerminalInDirectoryRequest: () => null,
        openTerminalInDirectory: () => undefined,
        consumeOpenTerminalInDirectoryRequest: () => undefined,
        aiThreadFocusSeq: () => 0,
        aiThreadFocusId: () => null,
        focusAIThread: () => undefined,
      }}
    >
      <CodexProvider>
        <CodexHarness onReady={onReady} />
      </CodexProvider>
    </EnvContext.Provider>
  ), host);
}

function renderPageWithHarness(
  host: HTMLDivElement,
  onReady: (codex: ReturnType<typeof useCodexContext>) => void,
) {
  render(() => (
    <EnvContext.Provider
      value={{
        env_id: () => 'env_1',
        env: (() => null) as any,
        localRuntime: () => null,
        connect: async () => undefined,
        connecting: () => false,
        connectError: () => null,
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
        goTab: () => undefined,
        filesSidebarOpen: () => false,
        setFilesSidebarOpen: () => undefined,
        toggleFilesSidebar: () => undefined,
        settingsSeq: () => 1,
        bumpSettingsSeq: () => undefined,
        openSettings: () => undefined,
        debugConsoleEnabled: () => false,
        setDebugConsoleEnabled: () => undefined,
        openDebugConsole: () => undefined,
        settingsFocusSeq: () => 0,
        settingsFocusSection: () => null,
        askFlowerIntentSeq: () => 0,
        askFlowerIntent: () => null,
        injectAskFlowerIntent: () => undefined,
        openAskFlowerComposer: () => undefined,
        openTerminalInDirectoryRequestSeq: () => 0,
        openTerminalInDirectoryRequest: () => null,
        openTerminalInDirectory: () => undefined,
        consumeOpenTerminalInDirectoryRequest: () => undefined,
        aiThreadFocusSeq: () => 0,
        aiThreadFocusId: () => null,
        focusAIThread: () => undefined,
      }}
    >
      <CodexProvider>
        <CodexPage />
        <CodexHarness onReady={onReady} />
      </CodexProvider>
    </EnvContext.Provider>
  ), host);
}

afterEach(() => {
  document.body.innerHTML = '';
  desktopStorageState.clear();
  lastDirectoryPickerProps = null;
  fileBrowserSurfaceState.openBrowser.mockReset();
  fileBrowserSurfaceState.open.mockReset();
  fileBrowserSurfaceState.open.mockReturnValue(false);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  rpcMocks.fs.list.mockReset();
});

describe('CodexPage', () => {
  it('shows host diagnostics inside the Codex chat shell when the host binary is missing', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: false,
      ready: false,
      agent_home_dir: '/workspace',
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_stop_after_send',
        name: 'Stop after send',
        preview: 'Stop after send',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();

    expect(host.querySelector('[data-codex-surface="page-shell"]')).not.toBeNull();
    expect(host.textContent).toContain('Host diagnostics');
    expect(host.textContent).toContain('Install Codex on the host');
    expect(host.textContent).toContain('There is no separate in-app Codex runtime toggle to manage here');
    expect(host.textContent).toContain('Redeven does not install Codex for you');
    expect(host.querySelector('.highlight-block-warning')).not.toBeNull();
    expect(host.querySelector('.codex-empty-ornament')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Send to Codex"]')).not.toBeNull();
    expect(host.querySelector('.codex-chat-input-controls')).toBeNull();
    expect(host.querySelector('.codex-chat-input-meta')).not.toBeNull();
    expect(host.querySelector('button[title="Add attachments"]')).not.toBeNull();
    expect(host.querySelector('.codex-page-toolbar')).toBeNull();
  });

  it('keeps the new-chat welcome state inside the transcript viewport shell', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([]);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();

    const transcriptRoot = host.querySelector('[data-codex-surface="transcript"]') as HTMLDivElement | null;
    const emptyState = host.querySelector('[data-codex-surface="empty-state"]') as HTMLDivElement | null;

    expect(transcriptRoot).not.toBeNull();
    expect(transcriptRoot?.className).toContain('codex-transcript-shell');
    expect(transcriptRoot?.getAttribute('data-codex-transcript-mode')).toBe('empty');
    expect(emptyState).not.toBeNull();
    expect(emptyState?.className).toContain('codex-transcript-state');
    expect(emptyState?.textContent).toContain('Start a Codex conversation with a prompt');
    expect(host.querySelector('.codex-transcript-shell-feed')).toBeNull();
  });

  it('opens the shared working-directory file browser from the Codex transcript FAB', async () => {
    (window as any).PointerEvent = window.MouseEvent;

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([]);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();

    expect(host.querySelector('.codex-page-transcript-main .codex-page-file-browser-fab')).toBeNull();
    expect(host.querySelector('.codex-page-transcript-overlay-track .codex-page-file-browser-fab')).not.toBeNull();
    expect(host.querySelector('[data-codex-transcript-overlay-track="true"]')).not.toBeNull();

    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    clickFab(button!);
    await flushAsync();

    expect(fileBrowserSurfaceState.openBrowser).toHaveBeenCalledWith({
      path: '/workspace/ui',
      homePath: '/workspace',
    });
  });

  it('shows the transcript FAB when only the working directory is available', async () => {
    (window as any).PointerEvent = window.MouseEvent;
    fetchCodexStatusMock.mockResolvedValue({
      available: false,
      ready: false,
      error: 'host codex binary not found on PATH',
      agent_home_dir: '/workspace',
    });
    listCodexThreadsMock.mockResolvedValue([]);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();

    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    clickFab(button!);
    await flushAsync();

    expect(fileBrowserSurfaceState.openBrowser).toHaveBeenCalledWith({
      path: '/workspace',
      homePath: '/workspace',
    });
  });

  it('keeps the Codex transcript FAB visible while the shared browser surface is already open', async () => {
    fileBrowserSurfaceState.open.mockReturnValue(true);
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([]);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();

    const button = host.querySelector('button[title="Browse files"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
  });

  it('disables host-backed composer controls while Codex is unavailable', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: false,
      ready: false,
      error: 'host codex binary not found on PATH',
      agent_home_dir: '/workspace',
    });
    listCodexThreadsMock.mockResolvedValue([]);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await flushAsync();

    const textarea = host.querySelector('textarea');
    const workingDirButton = host.querySelector('button[aria-label="Select working directory"]');
    const attachmentButton = host.querySelector('button[title="Add attachments"]');
    const sendButton = host.querySelector('button[aria-label="Send to Codex"]');

    expect(textarea?.hasAttribute('disabled')).toBe(true);
    expect(workingDirButton?.hasAttribute('disabled')).toBe(true);
    expect(attachmentButton?.hasAttribute('disabled')).toBe(true);
    expect(sendButton?.hasAttribute('disabled')).toBe(true);
    expect(host.textContent).toContain('host codex binary not found on PATH');
  });

  it('exposes stop, review, and fork actions for an active thread', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      effective_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      },
      operations: [
        'thread_archive',
        'thread_fork',
        'turn_interrupt',
        'review_start',
      ],
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Gateway parity review',
        preview: 'Review the current workspace changes',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 5,
        status: 'running',
        cwd: '/workspace',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Gateway parity review',
        preview: 'Review the current workspace changes',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 5,
        status: 'running',
        cwd: '/workspace',
        turns: [
          {
            id: 'turn_1',
            status: 'in_progress',
            items: [],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      },
      pending_requests: [],
      last_applied_seq: 2,
      active_status: 'running',
      active_status_flags: [],
    });
    interruptCodexTurnMock.mockResolvedValue(undefined);
    startCodexReviewMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Gateway parity review',
        preview: 'Review the current workspace changes',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 6,
        status: 'running',
        cwd: '/workspace',
        turns: [
          {
            id: 'turn_review',
            status: 'in_progress',
            items: [],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      },
      pending_requests: [],
      last_applied_seq: 3,
      active_status: 'running',
      active_status_flags: [],
    });
    forkCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_forked',
        name: 'Forked parity review',
        preview: 'Forked review thread',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 7,
        updated_at_unix_s: 7,
        status: 'running',
        cwd: '/workspace',
        turns: [
          {
            id: 'turn_fork',
            status: 'in_progress',
            items: [],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      },
      pending_requests: [],
      last_applied_seq: 1,
      active_status: 'running',
      active_status_flags: [],
    });
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await waitForCondition(
      () => Boolean(host.querySelector('button[aria-label="Stop active Codex turn"]')),
      'active thread actions',
    );

    const queryStopButton = () => host.querySelector('button[aria-label="Stop active Codex turn"]') as HTMLButtonElement | null;
    const queryReviewButton = () => host.querySelector('button[aria-label="Review current workspace changes"]') as HTMLButtonElement | null;
    const queryForkButton = () => host.querySelector('button[aria-label="Fork Codex thread"]') as HTMLButtonElement | null;
    const sendButton = host.querySelector('button[aria-label="Send to Codex"]') as HTMLButtonElement | null;

    const stopButton = queryStopButton();
    const reviewButton = queryReviewButton();
    const forkButton = queryForkButton();

    expect(stopButton).toBeTruthy();
    expect(reviewButton).toBeTruthy();
    expect(forkButton).toBeTruthy();
    expect(sendButton).toBeTruthy();

    stopButton?.click();
    await flushAsync();
    expect(interruptCodexTurnMock).toHaveBeenCalledWith({
      thread_id: 'thread_1',
      turn_id: 'turn_1',
    });

    queryReviewButton()?.click();
    await flushAsync();
    expect(startCodexReviewMock).toHaveBeenCalledWith({
      thread_id: 'thread_1',
      target: 'uncommitted_changes',
    });

    queryForkButton()?.click();
    await flushAsync();
    expect(forkCodexThreadMock).toHaveBeenCalledWith({
      thread_id: 'thread_1',
      model: 'gpt-5.4',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
      approvals_reviewer: '',
    });
  });

  it('renders the conversation shell, transcript rows, and runtime flags for the active Codex thread', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['low', 'medium', 'high'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request', 'never'],
        allowed_sandbox_modes: ['workspace-write', 'danger-full-access'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Codex page polish review',
        preview: 'Align the Codex workbench with the selected review shell',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Codex page polish review',
        preview: 'Align the Codex workbench with the selected review shell',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [
          {
            id: 'turn_1',
            status: 'in_progress',
            items: [
              {
                id: 'item_1',
                type: 'userMessage',
                text: 'Please align the Codex shell with the selected Artifact Review direction.',
              },
              {
                id: 'item_2',
                type: 'agentMessage',
                text: 'I will split the work into navigator polish, artifact hierarchy, and composer cleanup.',
              },
              {
                id: 'item_3',
                type: 'fileChange',
                changes: [
                  {
                    path: 'src/ui/codex/CodexPage.tsx',
                    kind: 'update',
                    diff: '+ review shell\n- generic shell',
                  },
                ],
              },
              {
                id: 'item_4',
                type: 'commandExecution',
                cwd: '/workspace/ui',
                command: 'pnpm test',
                status: 'completed',
                exit_code: 0,
                aggregated_output: 'PASS CodexPage.test.tsx',
              },
            ],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      token_usage: {
        total: {
          total_tokens: 6400,
          input_tokens: 4200,
          cached_input_tokens: 600,
          output_tokens: 1100,
          reasoning_output_tokens: 300,
        },
        last: {
          total_tokens: 1200,
          input_tokens: 800,
          cached_input_tokens: 200,
          output_tokens: 150,
          reasoning_output_tokens: 50,
        },
        model_context_window: 128000,
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: ['finalizing'],
    });
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await flushOpenThreadRequests();
    await waitForCondition(
      () => (
        host.textContent?.includes('Codex page polish review') === true &&
        host.textContent?.includes('Loading the selected Codex thread.') !== true
      ),
      'active thread load completion',
    );

    expect(host.querySelector('[data-codex-surface="transcript"]')).not.toBeNull();
    expect(host.innerHTML).not.toContain('radial-gradient(circle_at_top');
    expect(host.querySelector('.codex-page-transcript-divider')).toBeNull();
    expect(host.textContent).toContain('Codex page polish review');
    expect(host.textContent).toContain('src/ui/codex/CodexPage.tsx');
    expect(host.textContent).not.toContain('Command evidence');
    expect(host.textContent).toContain('Finalizing...');
    expect(host.textContent).not.toContain('Prompt ideas');
    expect(host.textContent).not.toContain('Review recent changes');
    expect(host.textContent).not.toContain('Dedicated Codex review shell with isolated thread state.');
    expect(host.textContent).not.toContain('Host ready');
    expect(host.textContent).not.toContain('Updated');
    expect(host.textContent).not.toContain('Responses');
    expect(host.textContent).toContain('GPT-5.4');
    expect(host.textContent).not.toContain('Effort');
    expect(host.textContent).not.toContain('Approval');
    expect(host.textContent).not.toContain('Sandbox');
    expect(host.querySelector('.codex-chat-input-controls')).toBeNull();
    expect(host.querySelector('.codex-chat-input-meta')).not.toBeNull();
    expect(host.querySelector('.codex-chat-input-meta-group-context')).not.toBeNull();
    expect(host.querySelector('.codex-chat-input-meta-group-strategy')).not.toBeNull();
    expect(host.querySelector('.codex-page-bottom-support-lane')).not.toBeNull();
    expect(host.querySelector('.codex-page-bottom-support-track')).not.toBeNull();
    expect(host.querySelector('.codex-page-bottom-support-content')).not.toBeNull();
    expect(host.querySelector('.codex-page-bottom-support-track-page')).not.toBeNull();
    expect(host.querySelector('.codex-page-bottom-support-content-page')).not.toBeNull();
    expect(host.querySelector('.codex-chat-input-meta-subgroup-values')).not.toBeNull();
    expect(host.querySelector('.codex-chat-input-meta-subgroup-policies')).not.toBeNull();
    expect(host.querySelectorAll('.codex-chat-input-meta-subgroup-values [data-codex-select-variant="value"]').length).toBe(2);
    expect(host.querySelectorAll('.codex-chat-input-meta-subgroup-policies [data-codex-select-variant="policy"]').length).toBe(2);
    expect(host.querySelectorAll('.codex-chat-input-meta-group-strategy [data-codex-select-collapsed="true"]').length).toBe(4);
    expect(host.querySelector('.codex-chat-draft-objects')).toBeNull();
    expect(host.querySelector('button[aria-label="Send to Codex"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Queue next Codex turn"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Stop active Codex turn"]')).not.toBeNull();
    expect(host.textContent).toContain('Queue next starts a new turn after this run finishes');
    expect(host.querySelector('button[title="Add attachments"]')).not.toBeNull();
    expect(host.querySelector('.codex-chat-markdown-block')).not.toBeNull();
    expect(host.querySelector('.codex-page-toolbar')).toBeNull();
    expect(host.querySelector('.codex-page-header-context')).not.toBeNull();
    expect(host.textContent).toContain('95% context left');
    expect(host.querySelector('button[aria-label="Refresh Codex thread"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Archive Codex thread"]')).not.toBeNull();
    const workingDirChip = host.querySelector('button[aria-label="Working directory locked"]') as HTMLButtonElement | null;
    expect(workingDirChip?.textContent).toContain('~/ui');
    expect(workingDirChip?.className).toContain('codex-chat-working-dir-chip-locked');
    workingDirChip?.click();
    await flushAsync();
    expect(host.querySelector('[data-testid="directory-picker"]')).toBeNull();
  });

  it('resolves concrete approval and sandbox defaults when the runtime config leaves them empty', async () => {
    const startedDetail = {
      thread: {
        id: 'thread_default_policy',
        name: 'Default policy thread',
        preview: 'Default policy thread',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'never',
        sandbox_mode: 'danger-full-access',
        reasoning_effort: 'medium',
      },
      token_usage: null,
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    };
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request', 'never'],
        allowed_sandbox_modes: ['workspace-write', 'danger-full-access'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([]);
    openCodexThreadMock.mockResolvedValue(startedDetail);
    startCodexThreadMock.mockResolvedValue(startedDetail);
    startCodexTurnMock.mockResolvedValue(undefined);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);
    let codex!: ReturnType<typeof useCodexContext>;

    renderPageWithHarness(host, (value) => {
      codex = value;
    });

    await flushAsync();
    await flushAsync();

    expect(codex.approvalPolicyDraft()).toBe('never');
    expect(codex.sandboxModeDraft()).toBe('danger-full-access');
    expect(host.textContent).toContain('Never');
    expect(host.textContent).toContain('Full access');

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = host.querySelector('button[aria-label="Send to Codex"]') as HTMLButtonElement | null;
    if (!textarea || !sendButton) throw new Error('composer controls not found');

    textarea.value = 'Use resolved defaults';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    sendButton.click();

    await flushAsync();
    await flushAsync();

    expect(startCodexThreadMock).toHaveBeenCalledWith(expect.objectContaining({
      approval_policy: 'never',
      sandbox_mode: 'danger-full-access',
    }));
  });

  it('keeps send primary and steers the active regular turn while exposing queue and stop', async () => {
    const startedDetail = {
      thread: {
        id: 'thread_stop_after_send',
        name: 'Stop after send',
        preview: 'Stop after send',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [
          {
            id: 'turn_stop_after_send',
            kind: 'regular',
            accepts_steer: true,
            status: 'in_progress',
            items: [],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'never',
        sandbox_mode: 'danger-full-access',
        reasoning_effort: 'medium',
      },
      token_usage: null,
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    };
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
      },
      operations: [
        'thread_archive',
        'thread_fork',
        'turn_steer',
        'turn_interrupt',
        'review_start',
      ],
      requirements: {
        allowed_approval_policies: ['never'],
        allowed_sandbox_modes: ['danger-full-access'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_stop_after_send',
        name: 'Stop after send',
        preview: 'Stop after send',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue(startedDetail);
    steerCodexTurnMock.mockResolvedValue(undefined);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await waitForCondition(
      () => Boolean(host.querySelector('.codex-chat-input-send-slot button[aria-label="Queue next Codex turn"]')),
      'composer queue action',
    );

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = host.querySelector('.codex-chat-input-send-slot button[aria-label="Send to Codex"]') as HTMLButtonElement | null;
    const queueButton = host.querySelector('.codex-chat-input-send-slot button[aria-label="Queue next Codex turn"]') as HTMLButtonElement | null;
    const stopButton = host.querySelector('.codex-chat-input-send-slot button[aria-label="Stop active Codex turn"]') as HTMLButtonElement | null;
    if (!textarea || !sendButton || !queueButton || !stopButton) throw new Error('composer controls not found');

    textarea.value = 'Need a visible stop action';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(queueButton.textContent).toContain('Queue next');
    expect(stopButton.textContent).toContain('Stop');
    expect(host.textContent).toContain('Send now appends to the current turn');

    sendButton.click();

    await flushAsync();
    await flushAsync();

    expect(steerCodexTurnMock).toHaveBeenCalledWith({
      thread_id: 'thread_stop_after_send',
      expected_turn_id: 'turn_stop_after_send',
      inputs: [
        {
          type: 'text',
          text: 'Need a visible stop action',
        },
      ],
    });
    expect(startCodexTurnMock).not.toHaveBeenCalled();
  });

  it('queues the current draft when steer is rejected as non-steerable', async () => {
    const startedDetail = {
      thread: {
        id: 'thread_queue_after_reject',
        name: 'Queue after reject',
        preview: 'Queue after reject',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [
          {
            id: 'turn_queue_after_reject',
            kind: 'regular',
            status: 'in_progress',
            items: [],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'never',
        sandbox_mode: 'danger-full-access',
        reasoning_effort: 'medium',
      },
      token_usage: null,
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    };
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
      },
      operations: [
        'thread_archive',
        'thread_fork',
        'turn_steer',
        'turn_interrupt',
        'review_start',
      ],
      requirements: {
        allowed_approval_policies: ['never'],
        allowed_sandbox_modes: ['danger-full-access'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_queue_after_reject',
        name: 'Queue after reject',
        preview: 'Queue after reject',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue(startedDetail);
    steerCodexTurnMock.mockRejectedValue(new MockCodexGatewayError(
      'Active turn rejected steer',
      'activeTurnNotSteerable',
      400,
    ));
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await waitForCondition(
      () => Boolean(host.querySelector('button[aria-label="Queue next Codex turn"]')),
      'composer queue action',
    );

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = host.querySelector('button[aria-label="Send to Codex"]') as HTMLButtonElement | null;
    if (!textarea || !sendButton) throw new Error('composer send controls not found');

    textarea.value = 'Queue this when steer is rejected';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    sendButton.click();

    await waitForCondition(
      () => steerCodexTurnMock.mock.calls.length === 1 && Boolean(host.textContent?.includes('Queued follow-ups')),
      'queued follow-up fallback',
    );

    expect(steerCodexTurnMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Queued follow-ups');
    expect(host.textContent).toContain('Queue this when steer is rejected');
    expect(notification.info).toHaveBeenCalledWith(
      'Queued for later',
      'The current turn could not accept same-turn input, so your message was queued as the next turn.',
    );
  });

  it('auto-sends the next queued follow-up after the active thread becomes idle', async () => {
    let streamOnEvent: ((event: unknown) => void) | undefined;

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'never',
        sandbox_mode: 'danger-full-access',
        reasoning_effort: 'medium',
      },
      operations: [
        'thread_archive',
        'thread_fork',
        'turn_steer',
        'turn_interrupt',
        'review_start',
      ],
      requirements: {
        allowed_approval_policies: ['never'],
        allowed_sandbox_modes: ['danger-full-access'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Queued follow-up thread',
        preview: 'Queue next',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Queued follow-up thread',
        preview: 'Queue next',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [
          {
            id: 'turn_1',
            status: 'in_progress',
            items: [],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'never',
        sandbox_mode: 'danger-full-access',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: 1,
      active_status: 'running',
      active_status_flags: [],
    });
    connectCodexEventStreamMock.mockImplementation(async (args: any) => {
      streamOnEvent = args.onEvent;
    });
    startCodexTurnMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await waitForCondition(
      () => Boolean(host.querySelector('button[aria-label="Queue next Codex turn"]')),
      'queue action',
    );

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    const queueButton = host.querySelector('button[aria-label="Queue next Codex turn"]') as HTMLButtonElement | null;
    if (!textarea || !queueButton) throw new Error('queue controls not found');

    textarea.value = 'Send this after the current turn finishes';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    queueButton.click();

    await flushAsync();
    await flushAsync();

    expect(host.textContent).toContain('Queued follow-ups');
    expect(host.textContent).toContain('Send this after the current turn finishes');

    streamOnEvent?.({
      seq: 2,
      type: 'turn_completed',
      thread_id: 'thread_1',
      turn: {
        id: 'turn_1',
        status: 'completed',
        items: [],
      },
    });
    streamOnEvent?.({
      seq: 3,
      type: 'thread_status_changed',
      thread_id: 'thread_1',
      status: 'completed',
      flags: ['idle'],
    });

    await waitForCondition(
      () => startCodexTurnMock.mock.calls.length > 0,
      'queued follow-up auto send',
    );

    expect(startCodexTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      threadID: 'thread_1',
      inputText: 'Send this after the current turn finishes',
      model: 'gpt-5.4',
      effort: 'medium',
      approval_policy: 'never',
      sandbox_mode: 'danger-full-access',
    }));
  });

  it('restores the composer send action once the active turn completes', async () => {
    let streamOnEvent: ((event: unknown) => void) | undefined;

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium'],
        },
      ],
      effective_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
      operations: ['turn_interrupt'],
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Active Codex run',
        preview: 'Running now',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Active Codex run',
        preview: 'Running now',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace',
        turns: [
          {
            id: 'turn_1',
            status: 'in_progress',
            items: [],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      },
      pending_requests: [],
      last_applied_seq: 1,
      active_status: 'running',
      active_status_flags: [],
    });
    connectCodexEventStreamMock.mockImplementation(async (args: any) => {
      streamOnEvent = args.onEvent;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await flushAsync();
    await flushAsync();

    expect(host.querySelector('button[aria-label="Stop active Codex turn"]')).not.toBeNull();

    streamOnEvent?.({
      seq: 2,
      type: 'turn_completed',
      thread_id: 'thread_1',
      turn: {
        id: 'turn_1',
        status: 'completed',
        items: [],
      },
    });
    await flushAsync();

    expect(host.querySelector('button[aria-label="Stop active Codex turn"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Send to Codex"]')).not.toBeNull();
  });

  it('renders stream disconnect failures with the shared highlight block styling', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Codex stream retry',
        preview: 'Reconnect after network hiccups',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Codex stream retry',
        preview: 'Reconnect after network hiccups',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    });
    connectCodexEventStreamMock.mockRejectedValue(new Error('network error'));

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await waitForCondition(
      () => Boolean(host.querySelector('.highlight-block-error')),
      'stream error banner',
    );

    const streamError = host.querySelector('.highlight-block-error');
    expect(streamError).not.toBeNull();
    expect(streamError?.textContent).toContain('Live event stream');
    expect(streamError?.textContent).toContain('Live event stream disconnected: network error');
  });

  it('applies a new-chat working-dir selection to the first send', async () => {
    const startedDetail = {
      thread: {
        id: 'thread_new',
        name: 'New chat',
        preview: 'Working dir change',
        ephemeral: false,
        model_provider: 'openai',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      token_usage: null,
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    };

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium', 'high'],
        },
      ],
      effective_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([]);
    openCodexThreadMock.mockResolvedValue(startedDetail);
    startCodexThreadMock.mockResolvedValue(startedDetail);
    startCodexTurnMock.mockResolvedValue(undefined);
    connectCodexEventStreamMock.mockResolvedValue(undefined);
    rpcMocks.fs.list.mockResolvedValue({
      entries: [
        {
          name: 'ui',
          path: '/workspace/ui',
          isDirectory: true,
          size: 0,
          modifiedAt: 1,
          createdAt: 1,
        },
      ],
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    let codex!: ReturnType<typeof useCodexContext>;

    renderPageWithHarness(host, (value) => {
      codex = value;
    });

    await flushAsync();
    await flushAsync();

    codex.setWorkingDirDraft('/workspace/ui');
    await flushAsync();

    const workingDirButton = host.querySelector('button[aria-label="Select working directory"]') as HTMLButtonElement | null;
    if (!workingDirButton) {
      throw new Error('working directory button not found');
    }
    expect(workingDirButton.textContent).toContain('~/ui');

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) {
      throw new Error('textarea not found');
    }
    textarea.value = 'Review this folder';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const sendButton = host.querySelector('button[aria-label="Send to Codex"]') as HTMLButtonElement | null;
    if (!sendButton) {
      throw new Error('send button not found');
    }
    sendButton.click();

    await flushAsync();
    await flushAsync();

    expect(startCodexThreadMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace/ui',
      model: 'gpt-5.4',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
    }));
    expect(startCodexTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      threadID: 'thread_new',
      inputText: 'Review this folder',
      cwd: '/workspace/ui',
    }));
  });

  it('wires the working-directory picker through the shared async path loader', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      effective_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      },
    });
    listCodexThreadsMock.mockResolvedValue([]);
    connectCodexEventStreamMock.mockResolvedValue(undefined);
    rpcMocks.fs.list.mockImplementation(async ({ path }: { path: string }) => {
      if (path === '/workspace') {
        return {
          entries: [
            { name: 'ui', path: '/workspace/ui', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1 },
          ],
        };
      }
      if (path === '/workspace/ui') {
        return {
          entries: [
            { name: 'src', path: '/workspace/ui/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1 },
          ],
        };
      }
      return { entries: [] };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    renderPage(host);
    await flushAsync();
    await flushAsync();

    const workingDirButton = host.querySelector('button[aria-label="Select working directory"]') as HTMLButtonElement | null;
    if (!workingDirButton) {
      throw new Error('working directory button not found');
    }
    workingDirButton.click();

    await flushAsync();
    await flushAsync();

    expect(lastDirectoryPickerProps?.open).toBe(true);
    expect(typeof lastDirectoryPickerProps?.onExpand).toBe('function');
    expect(typeof lastDirectoryPickerProps?.ensurePath).toBe('function');

    const result = await lastDirectoryPickerProps.ensurePath('/ui/src', { reason: 'path-input' });

    expect(result).toEqual({
      status: 'ready',
      resolvedPath: '/ui/src',
    });
    expect(rpcMocks.fs.list).toHaveBeenCalledWith({ path: '/workspace', showHidden: false });
    expect(rpcMocks.fs.list).toHaveBeenCalledWith({ path: '/workspace/ui', showHidden: false });
  });

  it('submits slash-selected model changes through the existing thread and turn requests', async () => {
    const startedDetail = {
      thread: {
        id: 'thread_new',
        name: 'Workspace review',
        preview: 'Review this folder',
        ephemeral: false,
        model_provider: 'gpt-5.5',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'active',
        cwd: '/workspace/ui',
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.5',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'high',
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'idle',
      active_status_flags: [],
    };

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium', 'high'],
        },
        {
          id: 'gpt-5.5',
          display_name: 'GPT-5.5',
          description: 'Higher reasoning ceiling',
          supports_image_input: true,
          supported_reasoning_efforts: ['high'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([]);
    openCodexThreadMock.mockResolvedValue(startedDetail);
    startCodexThreadMock.mockResolvedValue(startedDetail);
    startCodexTurnMock.mockResolvedValue(undefined);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await flushAsync();
    await flushAsync();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('textarea not found');

    textarea.focus();
    textarea.value = '/model';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.setSelectionRange(6, 6);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    await flushAsync();

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushAsync();

    const option = Array.from(host.querySelectorAll('.codex-chat-popup-item')).find((node) => (
      node.textContent?.includes('GPT-5.5')
    )) as HTMLButtonElement | undefined;
    if (!option) throw new Error('model option not found');
    option.click();
    await flushAsync();
    await flushAsync();

    expect((host.querySelector('select[aria-label="Model"]') as HTMLSelectElement | null)?.value).toBe('gpt-5.5');
    expect((host.querySelector('select[aria-label="Effort"]') as HTMLSelectElement | null)?.value).toBe('high');

    textarea.value = 'Review this folder';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const sendButton = host.querySelector('button[aria-label="Send to Codex"]') as HTMLButtonElement | null;
    if (!sendButton) throw new Error('send button not found');
    sendButton.click();

    await flushAsync();
    await flushAsync();

    expect(startCodexThreadMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace/ui',
      model: 'gpt-5.5',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
    }));
    expect(startCodexTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      threadID: 'thread_new',
      inputText: 'Review this folder',
      cwd: '/workspace/ui',
      model: 'gpt-5.5',
      effort: 'high',
    }));
  });

  it('renders pending request cards inside the Codex dock support lane', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [],
      effective_config: {
        cwd: '/workspace/ui',
      },
      requirements: {
        allowed_approval_policies: ['on-request', 'never'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Approval queue',
        preview: 'Wait for command approval',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'waiting_approval',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Approval queue',
        preview: 'Wait for command approval',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'waiting_approval',
        cwd: '/workspace/ui',
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      },
      pending_requests: [
        {
          id: 'req_1',
          type: 'command_approval',
          thread_id: 'thread_1',
          turn_id: 'turn_1',
          item_id: 'item_approval',
          reason: 'Need approval to run pnpm lint',
          command: 'pnpm lint',
          cwd: '/workspace/ui',
          available_decisions: ['accept', 'decline'],
        },
      ],
      last_applied_seq: 0,
      active_status: 'waiting_approval',
      active_status_flags: [],
    });
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await waitForCondition(
      () => Boolean(host.querySelector('[data-codex-surface="pending-requests"]')),
      'pending request panel',
    );

    expect(host.querySelector('[data-codex-surface="pending-requests"]')).not.toBeNull();
    expect(host.textContent).toContain('Pending Codex requests');
    expect(host.textContent).toContain('Need approval to run pnpm lint');
    expect(host.textContent).toContain('Approve once');
    expect(host.textContent).toContain('Decline');
  });

  it('subscribes once per loaded thread and resumes from the latest known event sequence', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [],
      effective_config: {
        cwd: '/workspace/ui',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Stable stream thread',
        preview: 'Keep the Codex stream stable',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Stable stream thread',
        preview: 'Keep the Codex stream stable',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: 4,
      active_status: 'running',
      active_status_flags: [],
    });
    let delivered = false;
    connectCodexEventStreamMock.mockImplementation(async (args: { onEvent: (event: unknown) => void }) => {
      if (!delivered) {
        delivered = true;
        args.onEvent({
          seq: 5,
          type: 'agent_message_delta',
          thread_id: 'thread_1',
          item_id: 'item_live',
          delta: 'Stream update',
        });
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);
    await waitForCondition(
      () => connectCodexEventStreamMock.mock.calls.length > 0,
      'stream subscription bootstrap',
    );

    expect(connectCodexEventStreamMock.mock.calls.some((call) => (
      call[0]?.threadID === 'thread_1' && call[0]?.afterSeq === 4
    ))).toBe(true);
  });

  it('resumes a cached thread from the latest live-applied sequence after switching away and back', async () => {
    let codexContext!: ReturnType<typeof useCodexContext>;
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [],
      effective_config: {
        cwd: '/workspace/ui',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Stable stream thread',
        preview: 'Keep the Codex stream stable',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 20,
        status: 'running',
        cwd: '/workspace/ui',
      },
      {
        id: 'thread_2',
        name: 'Secondary thread',
        preview: 'Switch away and back',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 2,
        updated_at_unix_s: 10,
        status: 'completed',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockImplementation(async (threadID: string) => ({
      thread: {
        id: threadID,
        name: threadID === 'thread_1' ? 'Stable stream thread' : 'Secondary thread',
        preview: threadID === 'thread_1' ? 'Keep the Codex stream stable' : 'Switch away and back',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: threadID === 'thread_1' ? 1 : 2,
        updated_at_unix_s: threadID === 'thread_1' ? 20 : 10,
        status: threadID === 'thread_1' ? 'running' : 'completed',
        cwd: '/workspace/ui',
        turns: [
          {
            id: `${threadID}_turn_1`,
            status: 'completed',
            items: [
              {
                id: `${threadID}_item_user`,
                type: 'userMessage',
                text: `Open ${threadID}`,
              },
              {
                id: `${threadID}_item_agent`,
                type: 'agentMessage',
                text: `Loaded ${threadID}`,
                status: threadID === 'thread_1' ? 'inProgress' : 'completed',
              },
            ],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: threadID === 'thread_1' ? 4 : 2,
      active_status: threadID === 'thread_1' ? 'running' : 'completed',
      active_status_flags: [],
    }));
    let deliveredThreadOneUpdate = false;
    connectCodexEventStreamMock.mockImplementation(async (args: { threadID: string; onEvent: (event: unknown) => void }) => {
      if (args.threadID === 'thread_1' && !deliveredThreadOneUpdate) {
        deliveredThreadOneUpdate = true;
        args.onEvent({
          seq: 5,
          type: 'agent_message_delta',
          thread_id: 'thread_1',
          item_id: 'thread_1_item_agent',
          delta: ' with live update',
        });
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPageWithHarness(host, (codex) => {
      codexContext = codex;
    });

    await waitForCondition(
      () => connectCodexEventStreamMock.mock.calls.length > 0 && Boolean(host.textContent?.includes('Loaded thread_1 with live update')),
      'initial thread stream bootstrap',
    );

    expect(connectCodexEventStreamMock.mock.calls.some((call) => (
      call[0]?.threadID === 'thread_1' && call[0]?.afterSeq === 4
    ))).toBe(true);
    expect(host.textContent).toContain('Loaded thread_1 with live update');

    codexContext.selectThread('thread_2');
    await waitForCondition(
      () => connectCodexEventStreamMock.mock.calls.some((call) => (
        call[0]?.threadID === 'thread_2' && call[0]?.afterSeq === 2
      )),
      'secondary thread stream bootstrap',
    );

    codexContext.selectThread('thread_1');
    await waitForCondition(
      () => connectCodexEventStreamMock.mock.calls.some((call) => (
        call[0]?.threadID === 'thread_1' && call[0]?.afterSeq === 5
      )),
      'resumed thread stream bootstrap',
    );
  });

  it('keeps the transcript pinned to the bottom while live Codex output appends', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const resizeObserverHarness = installResizeObserverHarness();

    let transcriptScrollHeight = 240;
    const restoreScrollMetrics = installTranscriptScrollMetrics({
      getScrollHeight: () => transcriptScrollHeight,
    });

    try {
      fetchCodexStatusMock.mockResolvedValue({
        available: true,
        ready: true,
        binary_path: '/usr/local/bin/codex',
        agent_home_dir: '/workspace',
      });
      fetchCodexCapabilitiesMock.mockResolvedValue({
        models: [
          {
            id: 'gpt-5.4',
            display_name: 'GPT-5.4',
            supports_image_input: true,
            supported_reasoning_efforts: ['medium'],
          },
        ],
        effective_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        requirements: {
          allowed_approval_policies: ['on-request'],
          allowed_sandbox_modes: ['workspace-write'],
        },
      });
      listCodexThreadsMock.mockResolvedValue([
        {
          id: 'thread_1',
          name: 'Pinned transcript',
          preview: 'Keep Codex transcript pinned while streaming',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'running',
          cwd: '/workspace/ui',
        },
      ]);
      openCodexThreadMock.mockResolvedValue({
        thread: {
          id: 'thread_1',
          name: 'Pinned transcript',
          preview: 'Keep Codex transcript pinned while streaming',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'running',
          cwd: '/workspace/ui',
          turns: [
            {
              id: 'turn_1',
              status: 'running',
              items: [
                {
                  id: 'item_live',
                  type: 'agentMessage',
                  text: 'Streaming output',
                  status: 'inProgress',
                },
              ],
            },
          ],
        },
        runtime_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        pending_requests: [],
        last_applied_seq: 4,
        active_status: 'running',
        active_status_flags: ['planning'],
      });

      let streamOnEvent: (event: unknown) => void = () => {
        throw new Error('expected event stream subscription to be registered');
      };
      connectCodexEventStreamMock.mockImplementation(async (args: { onEvent: (event: unknown) => void }) => {
        streamOnEvent = args.onEvent;
      });

      const host = document.createElement('div');
      document.body.appendChild(host);

      renderPage(host);

      await flushAsync();
      await flushAsync();

      const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
      const transcriptRoot = host.querySelector('[data-codex-surface="transcript"]') as HTMLDivElement | null;
      expect(scrollRegion).not.toBeNull();
      expect(transcriptRoot).not.toBeNull();
      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(transcriptScrollHeight));

      transcriptScrollHeight = 360;
      streamOnEvent({
        seq: 5,
        type: 'agent_message_delta',
        thread_id: 'thread_1',
        item_id: 'item_live',
        delta: ' keeps growing',
      });

      await flushAsync();
      await flushAsync();
      if (transcriptRoot) {
        resizeObserverHarness.notify(transcriptRoot);
      }
      await flushAsync();

      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(transcriptScrollHeight));
    } finally {
      restoreScrollMetrics();
    }
  });

  it('pauses bottom follow immediately when the user first scrolls upward in a working thread', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const resizeObserverHarness = installResizeObserverHarness();

    let transcriptScrollHeight = 240;
    const restoreScrollMetrics = installTranscriptScrollMetrics({
      getScrollHeight: () => transcriptScrollHeight,
    });

    try {
      fetchCodexStatusMock.mockResolvedValue({
        available: true,
        ready: true,
        binary_path: '/usr/local/bin/codex',
        agent_home_dir: '/workspace',
      });
      fetchCodexCapabilitiesMock.mockResolvedValue({
        models: [
          {
            id: 'gpt-5.4',
            display_name: 'GPT-5.4',
            supports_image_input: true,
            supported_reasoning_efforts: ['medium'],
          },
        ],
        effective_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        requirements: {
          allowed_approval_policies: ['on-request'],
          allowed_sandbox_modes: ['workspace-write'],
        },
      });
      listCodexThreadsMock.mockResolvedValue([
        {
          id: 'thread_1',
          name: 'Working thread',
          preview: 'Do not snap back after the first upward scroll',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'running',
          cwd: '/workspace/ui',
        },
      ]);
      openCodexThreadMock.mockResolvedValue({
        thread: {
          id: 'thread_1',
          name: 'Working thread',
          preview: 'Do not snap back after the first upward scroll',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'running',
          cwd: '/workspace/ui',
          turns: [
            {
              id: 'turn_1',
              status: 'running',
              items: [
                {
                  id: 'item_live',
                  type: 'agentMessage',
                  text: 'Streaming output',
                  status: 'inProgress',
                },
              ],
            },
          ],
        },
        runtime_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        pending_requests: [],
        last_applied_seq: 4,
        active_status: 'running',
        active_status_flags: ['planning'],
      });

      let streamOnEvent: (event: unknown) => void = () => {
        throw new Error('expected event stream subscription to be registered');
      };
      connectCodexEventStreamMock.mockImplementation(async (args: { onEvent: (event: unknown) => void }) => {
        streamOnEvent = args.onEvent;
      });

      const host = document.createElement('div');
      document.body.appendChild(host);

      renderPage(host);

      await flushAsync();
      await flushAsync();

      const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
      const transcriptRoot = host.querySelector('[data-codex-surface="transcript"]') as HTMLDivElement | null;
      expect(scrollRegion).not.toBeNull();
      expect(transcriptRoot).not.toBeNull();
      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(transcriptScrollHeight));

      if (!scrollRegion) {
        throw new Error('scroll region not found');
      }

      scrollRegion.dispatchEvent(new Event('wheel'));
      scrollRegion.scrollTop = 104;
      scrollRegion.dispatchEvent(new Event('scroll'));
      await flushAsync();

      expect(scrollRegion.scrollTop).toBe(104);

      transcriptScrollHeight = 320;
      streamOnEvent({
        seq: 5,
        type: 'agent_message_delta',
        thread_id: 'thread_1',
        item_id: 'item_live',
        delta: ' continues',
      });

      await flushAsync();
      await flushAsync();
      resizeObserverHarness.notify(transcriptRoot!);
      await flushAsync();

      expect(scrollRegion.scrollTop).toBe(104);
    } finally {
      restoreScrollMetrics();
    }
  });

  it('switches to an existing thread bottom and stays pinned through late transcript growth', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const resizeObserverHarness = installResizeObserverHarness();

    let transcriptScrollHeight = 240;
    const restoreScrollMetrics = installTranscriptScrollMetrics({
      getScrollHeight: () => transcriptScrollHeight,
    });

    try {
      let codexContext!: ReturnType<typeof useCodexContext>;

      fetchCodexStatusMock.mockResolvedValue({
        available: true,
        ready: true,
        binary_path: '/usr/local/bin/codex',
        agent_home_dir: '/workspace',
      });
      fetchCodexCapabilitiesMock.mockResolvedValue({
        models: [
          {
            id: 'gpt-5.4',
            display_name: 'GPT-5.4',
            supports_image_input: true,
            supported_reasoning_efforts: ['medium'],
          },
        ],
        effective_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        requirements: {
          allowed_approval_policies: ['on-request'],
          allowed_sandbox_modes: ['workspace-write'],
        },
      });
      listCodexThreadsMock.mockResolvedValue([
        {
          id: 'thread_1',
          name: 'Thread one',
          preview: 'First thread preview',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 11,
          status: 'completed',
          cwd: '/workspace/ui',
        },
        {
          id: 'thread_2',
          name: 'Thread two',
          preview: 'Second thread preview',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 2,
          updated_at_unix_s: 10,
          status: 'completed',
          cwd: '/workspace/ui',
        },
      ]);
      openCodexThreadMock.mockImplementation(async (threadID: string) => ({
        thread: {
          id: threadID,
          name: threadID === 'thread_1' ? 'Thread one' : 'Thread two',
          preview: threadID === 'thread_1' ? 'First thread preview' : 'Second thread preview',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: threadID === 'thread_1' ? 1 : 2,
          updated_at_unix_s: threadID === 'thread_1' ? 11 : 12,
          status: 'completed',
          cwd: '/workspace/ui',
          turns: [
            {
              id: `${threadID}_turn_1`,
              status: 'completed',
              items: [
                {
                  id: `${threadID}_item_user`,
                  type: 'userMessage',
                  text: `Open ${threadID}`,
                },
                {
                  id: `${threadID}_item_agent`,
                  type: 'agentMessage',
                  text: `Loaded ${threadID}`,
                  status: 'completed',
                },
              ],
            },
          ],
        },
        runtime_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        pending_requests: [],
        last_applied_seq: 4,
        active_status: 'completed',
        active_status_flags: [],
      }));
      connectCodexEventStreamMock.mockImplementation(async () => undefined);

      const host = document.createElement('div');
      document.body.appendChild(host);

      renderPageWithHarness(host, (codex) => {
        codexContext = codex;
      });

      await flushAsync();
      await flushAsync();
      await flushAsync();

      const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
      const transcriptRoot = host.querySelector('[data-codex-surface="transcript"]') as HTMLDivElement | null;

      expect(scrollRegion).not.toBeNull();
      expect(transcriptRoot).not.toBeNull();
      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(240));

      transcriptScrollHeight = 300;
      codexContext.selectThread('thread_2');
      await flushAsync();
      await flushAsync();
      await flushAsync();

      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(300));

      transcriptScrollHeight = 420;
      if (transcriptRoot) {
        resizeObserverHarness.notify(transcriptRoot);
      }
      await flushAsync();

      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(420));
    } finally {
      restoreScrollMetrics();
    }
  });

  it('re-pins to the bottom immediately when the user sends a new turn from a paused scroll position', async () => {
    const raf = createRafHarness();
    vi.stubGlobal('requestAnimationFrame', raf.requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', raf.cancelAnimationFrame);
    installResizeObserverHarness();

    let transcriptScrollHeight = 240;
    const restoreScrollMetrics = installTranscriptScrollMetrics({
      getScrollHeight: () => transcriptScrollHeight,
    });

    try {
      let codexContext!: ReturnType<typeof useCodexContext>;

      fetchCodexStatusMock.mockResolvedValue({
        available: true,
        ready: true,
        binary_path: '/usr/local/bin/codex',
        agent_home_dir: '/workspace',
      });
      fetchCodexCapabilitiesMock.mockResolvedValue({
        models: [
          {
            id: 'gpt-5.4',
            display_name: 'GPT-5.4',
            supports_image_input: true,
            supported_reasoning_efforts: ['medium'],
          },
        ],
        effective_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        requirements: {
          allowed_approval_policies: ['on-request'],
          allowed_sandbox_modes: ['workspace-write'],
        },
      });
      listCodexThreadsMock.mockResolvedValue([
        {
          id: 'thread_1',
          name: 'Send test',
          preview: 'Resume follow after send',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'completed',
          cwd: '/workspace/ui',
        },
      ]);
      openCodexThreadMock.mockResolvedValue({
        thread: {
          id: 'thread_1',
          name: 'Send test',
          preview: 'Resume follow after send',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'completed',
          cwd: '/workspace/ui',
          turns: [
            {
              id: 'turn_1',
              status: 'completed',
              items: [
                {
                  id: 'item_user',
                  type: 'userMessage',
                  text: 'First prompt',
                },
                {
                  id: 'item_agent',
                  type: 'agentMessage',
                  text: 'First answer',
                  status: 'completed',
                },
              ],
            },
          ],
        },
        runtime_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        pending_requests: [],
        last_applied_seq: 4,
        active_status: 'completed',
        active_status_flags: [],
      });
      startCodexTurnMock.mockResolvedValue(undefined);
      connectCodexEventStreamMock.mockImplementation(async () => undefined);

      const host = document.createElement('div');
      document.body.appendChild(host);

      renderPageWithHarness(host, (codex) => {
        codexContext = codex;
      });

      await flushAsync();
      await flushAsync();
      await flushAsync();
      raf.flushAll();

      const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
      expect(scrollRegion).not.toBeNull();
      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(240));

      if (scrollRegion) {
        scrollRegion.dispatchEvent(new Event('wheel'));
        scrollRegion.scrollTop = 40;
        scrollRegion.dispatchEvent(new Event('scroll'));
      }
      await flushAsync();

      transcriptScrollHeight = 360;
      codexContext.setComposerText('Please continue.');
      await codexContext.sendTurn();
      await flushAsync();
      await flushAsync();

      expect(startCodexTurnMock).toHaveBeenCalledTimes(1);
      expect(scrollRegion?.scrollTop).toBe(40);
      raf.flushOne();
      expect(scrollRegion?.scrollTop).toBe(40);
      raf.flushOne();
      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(360));
      raf.flushAll();
      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(360));
    } finally {
      restoreScrollMetrics();
    }
  });

  it('preserves a paused transcript viewport across async transcript growth above the visible rows', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const resizeObserverHarness = installResizeObserverHarness();

    let transcriptScrollHeight = 300;
    const restoreScrollMetrics = installTranscriptScrollMetrics({
      getScrollHeight: () => transcriptScrollHeight,
    });

    try {
      fetchCodexStatusMock.mockResolvedValue({
        available: true,
        ready: true,
        binary_path: '/usr/local/bin/codex',
        agent_home_dir: '/workspace',
      });
      fetchCodexCapabilitiesMock.mockResolvedValue({
        models: [
          {
            id: 'gpt-5.4',
            display_name: 'GPT-5.4',
            supports_image_input: true,
            supported_reasoning_efforts: ['medium'],
          },
        ],
        effective_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        requirements: {
          allowed_approval_policies: ['on-request'],
          allowed_sandbox_modes: ['workspace-write'],
        },
      });
      listCodexThreadsMock.mockResolvedValue([
        {
          id: 'thread_1',
          name: 'Paused viewport',
          preview: 'Keep anchor stable while loading more content',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'completed',
          cwd: '/workspace/ui',
        },
      ]);
      openCodexThreadMock.mockResolvedValue({
        thread: {
          id: 'thread_1',
          name: 'Paused viewport',
          preview: 'Keep anchor stable while loading more content',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'completed',
          cwd: '/workspace/ui',
          turns: [
            {
              id: 'turn_1',
              status: 'completed',
              items: [
                {
                  id: 'item_user_1',
                  type: 'userMessage',
                  text: 'First prompt',
                },
                {
                  id: 'item_agent_1',
                  type: 'agentMessage',
                  text: 'First answer',
                  status: 'completed',
                },
                {
                  id: 'item_user_2',
                  type: 'userMessage',
                  text: 'Second prompt',
                },
              ],
            },
          ],
        },
        runtime_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        pending_requests: [],
        last_applied_seq: 4,
        active_status: 'completed',
        active_status_flags: [],
      });
      connectCodexEventStreamMock.mockImplementation(async () => undefined);

      const host = document.createElement('div');
      document.body.appendChild(host);

      renderPage(host);

      await flushAsync();
      await flushAsync();
      await flushAsync();

      const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
      const transcriptRoot = host.querySelector('[data-codex-surface="transcript"]') as HTMLDivElement | null;
      const transcriptRows = Array.from(host.querySelectorAll<HTMLElement>('.codex-transcript-row'));

      expect(scrollRegion).not.toBeNull();
      expect(transcriptRoot).not.toBeNull();
      expect(transcriptRows).toHaveLength(3);
      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(300));

      if (!scrollRegion) {
        throw new Error('scroll region not found');
      }

      installScrollContainerRect(scrollRegion, 100, 120);

      const rowMetricsByAnchorID = new Map<string, { top: number; height: number }>([
        ['item:item_user_1', { top: 0, height: 80 }],
        ['item:item_agent_1', { top: 80, height: 80 }],
        ['item:item_user_2', { top: 160, height: 80 }],
      ]);

      for (const row of transcriptRows) {
        const anchorID = String(row.getAttribute('data-follow-bottom-anchor-id') ?? '').trim();
        const metrics = rowMetricsByAnchorID.get(anchorID);
        if (!metrics) continue;
        installTranscriptRowRect(row, scrollRegion, {
          top: () => metrics.top,
          height: () => metrics.height,
        });
      }

      scrollRegion.dispatchEvent(new Event('wheel'));
      scrollRegion.scrollTop = 100;
      scrollRegion.dispatchEvent(new Event('scroll'));
      await flushAsync();

      transcriptScrollHeight = 340;
      rowMetricsByAnchorID.get('item:item_agent_1')!.top += 40;
      rowMetricsByAnchorID.get('item:item_user_2')!.top += 40;
      resizeObserverHarness.notify(transcriptRoot!);
      await flushAsync();

      expect(scrollRegion.scrollTop).toBe(140);
    } finally {
      restoreScrollMetrics();
    }
  });

  it('keeps landing on the latest output across repeated thread switches even after non-user scroll perturbations', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const resizeObserverHarness = installResizeObserverHarness();

    let transcriptScrollHeight = 240;
    const restoreScrollMetrics = installTranscriptScrollMetrics({
      getScrollHeight: () => transcriptScrollHeight,
    });

    try {
      let codexContext!: ReturnType<typeof useCodexContext>;

      fetchCodexStatusMock.mockResolvedValue({
        available: true,
        ready: true,
        binary_path: '/usr/local/bin/codex',
        agent_home_dir: '/workspace',
      });
      fetchCodexCapabilitiesMock.mockResolvedValue({
        models: [
          {
            id: 'gpt-5.4',
            display_name: 'GPT-5.4',
            supports_image_input: true,
            supported_reasoning_efforts: ['medium'],
          },
        ],
        effective_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        requirements: {
          allowed_approval_policies: ['on-request'],
          allowed_sandbox_modes: ['workspace-write'],
        },
      });
      listCodexThreadsMock.mockResolvedValue([
        {
          id: 'thread_1',
          name: 'Thread one',
          preview: 'First thread preview',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 11,
          status: 'completed',
          cwd: '/workspace/ui',
        },
        {
          id: 'thread_2',
          name: 'Thread two',
          preview: 'Second thread preview',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 2,
          updated_at_unix_s: 10,
          status: 'completed',
          cwd: '/workspace/ui',
        },
        {
          id: 'thread_3',
          name: 'Thread three',
          preview: 'Third thread preview',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 3,
          updated_at_unix_s: 9,
          status: 'completed',
          cwd: '/workspace/ui',
        },
      ]);
      openCodexThreadMock.mockImplementation(async (threadID: string) => ({
        thread: {
          id: threadID,
          name: threadID === 'thread_1' ? 'Thread one' : threadID === 'thread_2' ? 'Thread two' : 'Thread three',
          preview: threadID === 'thread_1' ? 'First thread preview' : threadID === 'thread_2' ? 'Second thread preview' : 'Third thread preview',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: threadID === 'thread_1' ? 1 : threadID === 'thread_2' ? 2 : 3,
          updated_at_unix_s: threadID === 'thread_1' ? 11 : threadID === 'thread_2' ? 12 : 13,
          status: 'completed',
          cwd: '/workspace/ui',
          turns: [
            {
              id: `${threadID}_turn_1`,
              status: 'completed',
              items: [
                {
                  id: `${threadID}_item_user`,
                  type: 'userMessage',
                  text: `Open ${threadID}`,
                },
                {
                  id: `${threadID}_item_agent`,
                  type: 'agentMessage',
                  text: `Loaded ${threadID}`,
                  status: 'completed',
                },
              ],
            },
          ],
        },
        runtime_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        pending_requests: [],
        last_applied_seq: 4,
        active_status: 'completed',
        active_status_flags: [],
      }));
      connectCodexEventStreamMock.mockImplementation(async () => undefined);

      const host = document.createElement('div');
      document.body.appendChild(host);

      renderPageWithHarness(host, (codex) => {
        codexContext = codex;
      });

      await flushAsync();
      await flushAsync();
      await flushAsync();

      const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
      const transcriptRoot = host.querySelector('[data-codex-surface="transcript"]') as HTMLDivElement | null;

      expect(scrollRegion).not.toBeNull();
      expect(transcriptRoot).not.toBeNull();
      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(240));

      transcriptScrollHeight = 320;
      codexContext.selectThread('thread_2');
      await flushAsync();
      await flushAsync();
      await flushAsync();

      expect(scrollRegion?.scrollTop).toBe(expectedTranscriptBottomScrollTop(320));

      if (!scrollRegion || !transcriptRoot) {
        throw new Error('transcript not rendered');
      }

      scrollRegion.scrollTop = 100;
      scrollRegion.dispatchEvent(new Event('scroll'));
      await flushAsync();

      expect(scrollRegion.scrollTop).toBe(expectedTranscriptBottomScrollTop(320));

      transcriptScrollHeight = 420;
      codexContext.selectThread('thread_3');
      await flushAsync();
      await flushAsync();
      await flushAsync();

      expect(scrollRegion.scrollTop).toBe(expectedTranscriptBottomScrollTop(420));

      transcriptScrollHeight = 520;
      resizeObserverHarness.notify(transcriptRoot);
      await flushAsync();
      expect(scrollRegion.scrollTop).toBe(expectedTranscriptBottomScrollTop(520));

      scrollRegion.scrollTop = 260;
      scrollRegion.dispatchEvent(new Event('scroll'));
      await flushAsync();
      expect(scrollRegion.scrollTop).toBe(expectedTranscriptBottomScrollTop(520));

      transcriptScrollHeight = 280;
      codexContext.selectThread('thread_1');
      await flushAsync();
      await flushAsync();
      await flushAsync();

      expect(scrollRegion.scrollTop).toBe(expectedTranscriptBottomScrollTop(280));
    } finally {
      restoreScrollMetrics();
    }
  });

  it('sends image attachments through the Codex-only turn contract', async () => {
    let streamOnEvent: ((event: any) => void) | null = null;
    const startedDetail = {
      thread: {
        id: 'thread_new',
        name: 'New chat',
        preview: 'Attachment review',
        ephemeral: false,
        model_provider: 'openai',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      token_usage: {
        total: {
          total_tokens: 6400,
          input_tokens: 4200,
          cached_input_tokens: 600,
          output_tokens: 1100,
          reasoning_output_tokens: 300,
        },
        last: {
          total_tokens: 1200,
          input_tokens: 800,
          cached_input_tokens: 200,
          output_tokens: 150,
          reasoning_output_tokens: 50,
        },
        model_context_window: 128000,
      },
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    };

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium', 'high'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([]);
    startCodexThreadMock.mockResolvedValue(startedDetail);
    openCodexThreadMock.mockResolvedValue(startedDetail);
    startCodexTurnMock.mockResolvedValue(undefined);
    connectCodexEventStreamMock.mockImplementation(async (args: any) => {
      streamOnEvent = args.onEvent;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();

    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fileInput) {
      throw new Error('attachment input not found');
    }
    const file = new File(['png'], 'screen.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await flushAsync();
    await flushAsync();

    const sendButton = host.querySelector('button[aria-label="Send to Codex"]') as HTMLButtonElement | null;
    if (!sendButton) {
      throw new Error('send button not found');
    }
    sendButton.click();

    await flushAsync();
    await flushAsync();

    expect(startCodexThreadMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace/ui',
      model: 'gpt-5.4',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
    }));
    expect(startCodexTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      threadID: 'thread_new',
      cwd: '/workspace/ui',
      model: 'gpt-5.4',
      effort: 'medium',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
      inputs: [
        expect.objectContaining({
          type: 'image',
          name: 'screen.png',
          url: expect.stringContaining('data:image/png;base64,'),
        }),
      ],
    }));
    expect(host.textContent).toContain('Working...');
    expect(host.textContent).toContain('95% context left');
    expect(host.textContent).not.toContain('Codex is working');
    expect(host.querySelector('[data-codex-working-state="true"]')).not.toBeNull();

    if (!streamOnEvent) {
      throw new Error('stream callback not captured');
    }
    const emitStreamEvent = streamOnEvent as (event: any) => void;
    emitStreamEvent({
      seq: 1,
      type: 'thread_name_updated',
      thread_id: 'thread_new',
      thread_name: 'Thread title from Codex',
    });
    await flushAsync();

    expect(host.textContent).toContain('Thread title from Codex');
  });

  it('sends selected file references as mention inputs and keeps optimistic text visible', async () => {
    const startedDetail = {
      thread: {
        id: 'thread_new',
        name: 'New chat',
        preview: 'Review',
        ephemeral: false,
        model_provider: 'openai',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      token_usage: null,
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    };

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium', 'high'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([]);
    startCodexThreadMock.mockResolvedValue(startedDetail);
    openCodexThreadMock.mockResolvedValue(startedDetail);
    startCodexTurnMock.mockResolvedValue(undefined);
    connectCodexEventStreamMock.mockResolvedValue(undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);
    let codex!: ReturnType<typeof useCodexContext>;
    renderProviderHarness(host, (value) => {
      codex = value;
    });

    await flushAsync();
    await flushAsync();

    codex.setComposerText('Review ');
    codex.addFileMentions([{
      name: 'CodexComposerShell.tsx',
      path: '/workspace/ui/src/ui/codex/CodexComposerShell.tsx',
      is_image: false,
    }]);
    await codex.sendTurn();
    await flushAsync();

    expect(startCodexTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      threadID: 'thread_new',
      inputText: 'Review ',
      inputs: [
        {
          type: 'mention',
          name: 'CodexComposerShell.tsx',
          path: '/workspace/ui/src/ui/codex/CodexComposerShell.tsx',
        },
      ],
    }));
    const optimisticTurn = codex.activeOptimisticUserTurns()[0];
    expect(optimisticTurn?.inputs).toEqual([
      { type: 'text', text: 'Review ' },
      {
        type: 'mention',
        name: 'CodexComposerShell.tsx',
        path: '/workspace/ui/src/ui/codex/CodexComposerShell.tsx',
      },
    ]);
  });

  it('locks the working directory for existing threads and omits cwd overrides on later turns', async () => {
    const openedDetail = {
      thread: {
        id: 'thread_1',
        name: 'Existing thread',
        preview: 'Keep cwd stable',
        ephemeral: false,
        model_provider: 'openai',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'completed',
        cwd: '/workspace/ui',
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      token_usage: null,
      last_applied_seq: 0,
      active_status: 'completed',
      active_status_flags: [],
    };

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supports_image_input: true,
          supported_reasoning_efforts: ['medium', 'high'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Existing thread',
        preview: 'Keep cwd stable',
        ephemeral: false,
        model_provider: 'openai',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'completed',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue(openedDetail);
    startCodexTurnMock.mockResolvedValue(undefined);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);
    let codex!: ReturnType<typeof useCodexContext>;

    renderProviderHarness(host, (value) => {
      codex = value;
    });

    await waitForCondition(
      () => Boolean(codex) && String(codex.activeThreadID() ?? '').trim() === 'thread_1',
      'existing thread activation',
    );

    expect(codex.workingDirDraft()).toBe('/workspace/ui');

    codex.setWorkingDirDraft('/workspace/override');
    await flushAsync();

    expect(codex.workingDirDraft()).toBe('/workspace/ui');

    codex.setComposerText('Continue with the same thread');
    await codex.sendTurn();
    await flushAsync();

    expect(startCodexTurnMock).toHaveBeenCalledTimes(1);
    expect(startCodexTurnMock.mock.calls[0]?.[0]?.threadID).toBe('thread_1');
    expect(startCodexTurnMock.mock.calls[0]?.[0]?.cwd).toBeUndefined();
  });

});
