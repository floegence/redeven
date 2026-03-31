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
const archiveCodexThreadMock = vi.fn();
const respondToCodexRequestMock = vi.fn();
const connectCodexEventStreamMock = vi.fn();
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

type ResizeObserverRecord = {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
};

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
  useLayout: () => ({
    sidebarActiveTab: () => 'codex',
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
    props.open
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
}));

vi.mock('./api', () => ({
  fetchCodexStatus: (...args: any[]) => fetchCodexStatusMock(...args),
  fetchCodexCapabilities: (...args: any[]) => fetchCodexCapabilitiesMock(...args),
  listCodexThreads: (...args: any[]) => listCodexThreadsMock(...args),
  openCodexThread: (...args: any[]) => openCodexThreadMock(...args),
  startCodexThread: (...args: any[]) => startCodexThreadMock(...args),
  startCodexTurn: (...args: any[]) => startCodexTurnMock(...args),
  archiveCodexThread: (...args: any[]) => archiveCodexThreadMock(...args),
  respondToCodexRequest: (...args: any[]) => respondToCodexRequestMock(...args),
  connectCodexEventStream: (...args: any[]) => connectCodexEventStreamMock(...args),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => rpcMocks,
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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
    listCodexThreadsMock.mockResolvedValue([]);
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
            status: 'completed',
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

    await flushAsync();
    await flushAsync();

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
    expect(host.textContent).toContain('Effort');
    expect(host.textContent).toContain('Approval');
    expect(host.textContent).toContain('Sandbox');
    expect(host.querySelector('.codex-chat-input-controls')).toBeNull();
    expect(host.querySelector('.codex-chat-input-meta')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Send to Codex"]')).not.toBeNull();
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

    await flushAsync();
    await flushAsync();
    await flushAsync();

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

    await flushAsync();
    await flushAsync();

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

    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(connectCodexEventStreamMock).toHaveBeenCalledTimes(1);
    expect(connectCodexEventStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadID: 'thread_1',
        afterSeq: 4,
      }),
    );
    expect(host.textContent).toContain('Stream update');
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

  it('resumes bottom follow after a paused scroll when the user sends a new turn', async () => {
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
      expect(scrollRegion?.scrollTop).toBeGreaterThan(40);
      expect(scrollRegion?.scrollTop).toBeLessThan(expectedTranscriptBottomScrollTop(360));
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

    await flushAsync();
    await flushAsync();
    await flushAsync();

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
