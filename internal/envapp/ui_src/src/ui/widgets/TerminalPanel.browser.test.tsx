import { For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TerminalPanel } from './TerminalPanel';

const layoutState = vi.hoisted(() => ({
  mobile: false,
}));

const terminalPrefsState = vi.hoisted(() => ({
  userTheme: 'system',
  fontSize: 12,
  fontFamilyId: 'iosevka',
  mobileInputMode: 'floe' as 'floe' | 'system',
  workIndicatorEnabled: true,
}));

const rpcFsMocks = vi.hoisted(() => ({
  getPathContext: vi.fn().mockResolvedValue({ agentHomePathAbs: '/workspace' }),
  list: vi.fn().mockResolvedValue({ entries: [] }),
  readFile: vi.fn().mockResolvedValue({ content: '{"scripts":{}}' }),
}));

const transportMocks = vi.hoisted(() => ({
  sendInput: vi.fn().mockResolvedValue(undefined),
  resize: vi.fn().mockResolvedValue(undefined),
  attach: vi.fn().mockResolvedValue(undefined),
  history: vi.fn().mockResolvedValue([]),
  historyPage: vi.fn().mockResolvedValue({
    chunks: [],
    nextStartSeq: 0,
    hasMore: false,
    firstSequence: 0,
    lastSequence: 0,
    coveredBytes: 0,
    totalBytes: 0,
  }),
  getSessionStats: vi.fn().mockResolvedValue({ history: { totalBytes: 0 } }),
  clear: vi.fn().mockResolvedValue(undefined),
}));

const terminalEventSourceState = vi.hoisted(() => ({
  dataHandlers: new Map<string, Set<(event: {
    sessionId: string;
    data: Uint8Array;
    sequence?: number;
  }) => void>>(),
  nameHandlers: new Map<string, Set<(event: {
    sessionId: string;
    newName: string;
    workingDir: string;
  }) => void>>(),
}));

const terminalCoreState = vi.hoisted(() => ({
  instances: [] as Array<{ write: ReturnType<typeof vi.fn> }>,
}));

const terminalSessionsState = vi.hoisted(() => ({
  sessions: [
    {
      id: 'session-1',
      name: 'Terminal 1',
      workingDir: '/workspace',
      createdAtMs: 1,
      isActive: true,
      lastActiveAtMs: 10,
    },
    {
      id: 'session-2',
      name: 'Terminal 2',
      workingDir: '/workspace/repo',
      createdAtMs: 2,
      isActive: false,
      lastActiveAtMs: 5,
    },
  ] as Array<{
    id: string;
    name: string;
    workingDir: string;
    createdAtMs: number;
    isActive: boolean;
    lastActiveAtMs: number;
  }>,
  subscribers: [] as Array<(value: Array<{
    id: string;
    name: string;
    workingDir: string;
    createdAtMs: number;
    isActive: boolean;
    lastActiveAtMs: number;
  }>) => void>,
}));

const sessionsCoordinatorMocks = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  updateSessionMeta: vi.fn(),
  subscribe: (callback: (value: typeof terminalSessionsState.sessions) => void) => {
    terminalSessionsState.subscribers.push(callback);
    callback(terminalSessionsState.sessions);
    return () => {
      terminalSessionsState.subscribers = terminalSessionsState.subscribers.filter((entry) => entry !== callback);
    };
  },
}));

vi.mock('@floegence/floe-webapp-core', async () => {
  const actual = await vi.importActual<typeof import('@floegence/floe-webapp-core')>('@floegence/floe-webapp-core');
  return {
    ...actual,
    cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
    useCurrentWidgetId: () => null,
    useLayout: () => ({
      isMobile: () => layoutState.mobile,
    }),
    useNotification: () => ({
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
    }),
    useResolvedFloeConfig: () => ({
      persist: {
        load: (_key: string, fallback: any) => fallback,
        debouncedSave: vi.fn(),
      },
    }),
    useTheme: () => ({
      resolvedTheme: () => 'dark',
    }),
    useViewActivation: () => ({
      active: () => true,
    }),
  };
});

vi.mock('@floegence/floe-webapp-core/icons', async () => {
  const actual = await vi.importActual<typeof import('@floegence/floe-webapp-core/icons')>('@floegence/floe-webapp-core/icons');
  const Icon = (props: any) => <span class={props.class} />;
  return {
    ...actual,
    Check: Icon,
    Copy: Icon,
    ExternalLink: Icon,
    Folder: Icon,
    Sparkles: Icon,
    Terminal: Icon,
    Trash: Icon,
    X: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
  Sidebar: (props: any) => <aside class={props.class}>{props.children}</aside>,
  SidebarContent: (props: any) => <div class={props.class}>{props.children}</div>,
  SidebarItemList: (props: any) => {
    const { children, class: className, ...rest } = props;
    return <div {...rest} class={className}>{children}</div>;
  },
  SidebarSection: (props: any) => (
    <section class={props.class}>
      <div>
        <span>{props.title}</span>
        {props.actions}
      </div>
      <div>{props.children}</div>
    </section>
  ),
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (props.visible ? <div>{props.message}</div> : null),
}));

vi.mock('@floegence/floe-webapp-core/ui', async () => {
  const actual = await vi.importActual<typeof import('@floegence/floe-webapp-core/ui')>('@floegence/floe-webapp-core/ui');
  return {
    ...actual,
    Button: (props: any) => (
      <button
        type="button"
        data-testid={props['data-testid']}
        onClick={props.onClick}
        disabled={props.disabled}
        title={props.title}
      >
        {props.children}
      </button>
    ),
    Dropdown: (props: any) => (
      <div>
        <div>{props.trigger}</div>
        <For each={props.items}>
          {(item: any) => (
            <button type="button" data-testid={`dropdown-item-${item.id}`} onClick={() => props.onSelect(item.id)}>
              {item.label}
            </button>
          )}
        </For>
      </div>
    ),
    Input: (props: any) => <input ref={props.ref} value={props.value} placeholder={props.placeholder} onInput={props.onInput} />,
    NumberInput: (props: any) => (
      <input
        value={props.value}
        onInput={(event) => props.onChange(Number((event.currentTarget as HTMLInputElement).value))}
      />
    ),
    MobileKeyboard: (props: any) => <div ref={props.ref} aria-hidden={!props.visible} />,
    Tabs: (props: any) => (
      <div role="tablist">
        {props.items.map((item: any) => (
          <button
            type="button"
            role="tab"
            aria-selected={item.id === props.activeId}
            onClick={() => props.onChange?.(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        {props.showAdd ? <button type="button" onClick={props.onAdd}>Add</button> : null}
      </div>
    ),
    TabPanel: (props: any) => (props.active || props.keepMounted ? <div>{props.children}</div> : null),
    Dialog: (props: any) => (
      <Show when={props.open}>
        <div>{props.children}</div>
      </Show>
    ),
  };
});

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    client: () => ({ id: 'protocol-client' }),
    status: () => 'connected',
  }),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    fs: rpcFsMocks,
  }),
}));

vi.mock('@floegence/floeterm-terminal-web', async () => {
  const actual = await vi.importActual<typeof import('@floegence/floeterm-terminal-web')>('@floegence/floeterm-terminal-web');

  class MockTerminalCore {
    container: HTMLDivElement;
    config: any;
    handlers: any;

    constructor(container: HTMLDivElement, config?: any, handlers?: any) {
      this.container = container;
      this.config = config ?? {};
      this.handlers = handlers ?? {};
      const input = document.createElement('textarea');
      input.setAttribute('aria-label', 'Terminal input');
      this.container.appendChild(input);
      terminalCoreState.instances.push(this);
    }

    initialize = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn();
    setTheme = vi.fn();
    setAppearance = vi.fn();
    forceResize = vi.fn();
    getDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
    startHistoryReplay = vi.fn();
    endHistoryReplay = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    setFontSize = vi.fn();
    setFontFamily = vi.fn();
    setPresentationScale = vi.fn();
    registerLinkProvider = vi.fn();
    setSearchResultsCallback = vi.fn();
    clearSearch = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
    clear = vi.fn();
    getSelectionText = vi.fn(() => '');
    hasSelection = vi.fn(() => false);
    copySelection = vi.fn(async (source: 'shortcut' | 'command' | 'copy_event' = 'command') => ({
      copied: false as const,
      reason: 'empty_selection' as const,
      source,
    }));
  }

  return {
    ...actual,
    TerminalCore: MockTerminalCore,
    getDefaultTerminalConfig: vi.fn((_theme: string, overrides?: any) => overrides ?? {}),
    getThemeColors: vi.fn(() => ({ background: '#111111', foreground: '#eeeeee' })),
  };
});

vi.mock('../services/terminalTransport', () => ({
  createRedevenTerminalTransport: () => transportMocks,
  createRedevenTerminalEventSource: () => ({
    onTerminalData: (sessionId: string, handler: any) => {
      const current = terminalEventSourceState.dataHandlers.get(sessionId) ?? new Set();
      current.add(handler);
      terminalEventSourceState.dataHandlers.set(sessionId, current);
      return () => {
        terminalEventSourceState.dataHandlers.get(sessionId)?.delete(handler);
      };
    },
    onTerminalNameUpdate: (sessionId: string, handler: any) => {
      const current = terminalEventSourceState.nameHandlers.get(sessionId) ?? new Set();
      current.add(handler);
      terminalEventSourceState.nameHandlers.set(sessionId, current);
      return () => {
        terminalEventSourceState.nameHandlers.get(sessionId)?.delete(handler);
      };
    },
  }),
  getOrCreateTerminalConnId: () => 'conn-1',
}));

vi.mock('../services/terminalSessions', () => ({
  disposeRedevenTerminalSessionsCoordinator: vi.fn(),
  getRedevenTerminalSessionsCoordinator: () => sessionsCoordinatorMocks,
}));

vi.mock('../services/terminalPreferences', () => ({
  ensureTerminalPreferencesInitialized: vi.fn(),
  TERMINAL_MIN_FONT_SIZE: 10,
  TERMINAL_MAX_FONT_SIZE: 20,
  DEFAULT_TERMINAL_THEME: 'dark',
  DEFAULT_TERMINAL_FONT_FAMILY_ID: 'monaco',
  useTerminalPreferences: () => ({
    userTheme: () => terminalPrefsState.userTheme,
    fontSize: () => terminalPrefsState.fontSize,
    fontFamilyId: () => terminalPrefsState.fontFamilyId,
    mobileInputMode: () => terminalPrefsState.mobileInputMode,
    workIndicatorEnabled: () => terminalPrefsState.workIndicatorEnabled,
    setUserTheme: vi.fn(),
    setFontSize: vi.fn(),
    setFontFamily: vi.fn(),
    setMobileInputMode: vi.fn(),
    setWorkIndicatorEnabled: vi.fn(),
  }),
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    env: Object.assign(
      () => ({
        permissions: {
          can_read: true,
          can_execute: true,
        },
      }),
      { state: 'ready' },
    ),
    viewMode: () => 'activity',
    openFlowerTurnLauncher: vi.fn(),
    openTerminalInDirectoryRequestSeq: () => 0,
    openTerminalInDirectoryRequest: () => null,
    openTerminalInDirectory: vi.fn(),
    openFileBrowserAtPath: vi.fn(async () => undefined),
    consumeOpenTerminalInDirectoryRequest: vi.fn(),
  }),
}));

vi.mock('./FileBrowserSurfaceContext', () => ({
  useFileBrowserSurfaceContext: () => ({
    controller: {
      open: () => false,
    },
    openBrowser: vi.fn(),
    closeBrowser: vi.fn(),
  }),
}));

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    controller: {
      openPreview: vi.fn(),
    },
    openPreview: vi.fn(),
    closePreview: vi.fn(),
  }),
}));

vi.mock('../utils/permission', () => ({
  isPermissionDeniedError: () => false,
}));

vi.mock('../utils/clientId', () => ({
  createClientId: () => 'ask-flower-id',
}));

vi.mock('./PermissionEmptyState', () => ({
  PermissionEmptyState: () => <div>Permission denied</div>,
}));

vi.mock('../utils/askFlowerPath', async () => ({
  ...await vi.importActual<typeof import('../utils/askFlowerPath')>('../utils/askFlowerPath'),
  normalizeAbsolutePath: (value: string) => value,
  expandHomeDisplayPath: (value: string) => value,
  toHomeDisplayPath: (value: string) => value,
  resolveSuggestedWorkingDirAbsolute: ({ suggestedWorkingDirAbs }: { suggestedWorkingDirAbs?: string | null }) => suggestedWorkingDirAbs ?? '',
}));

vi.mock('../utils/clipboard', () => ({
  writeTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function settleTerminalPanel() {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function emitTerminalData(sessionId: string, data: string, sequence?: number) {
  const handlers = terminalEventSourceState.dataHandlers.get(sessionId);
  if (!handlers) return;
  const event = {
    sessionId,
    data: textEncoder.encode(data),
    sequence,
  };
  for (const handler of handlers) {
    handler(event);
  }
}

function decodeTerminalWrite(value: unknown): string {
  return value instanceof Uint8Array ? textDecoder.decode(value) : '';
}

function findTerminalTab(host: HTMLElement, label: string): HTMLElement | undefined {
  return Array.from(host.querySelectorAll<HTMLElement>('button[data-terminal-session-id]')).find((button) => button.textContent?.includes(label));
}

function findTerminalTabStatus(host: HTMLElement, label: string, status: 'running' | 'unread'): Element | null {
  return findTerminalTab(host, label)?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? null;
}

beforeEach(() => {
  layoutState.mobile = false;
  terminalPrefsState.userTheme = 'system';
  terminalPrefsState.fontSize = 12;
  terminalPrefsState.fontFamilyId = 'iosevka';
  terminalPrefsState.mobileInputMode = 'floe';
  terminalPrefsState.workIndicatorEnabled = true;
  terminalEventSourceState.dataHandlers = new Map();
  terminalEventSourceState.nameHandlers = new Map();
  terminalCoreState.instances = [];
  terminalSessionsState.sessions = [
    {
      id: 'session-1',
      name: 'Terminal 1',
      workingDir: '/workspace',
      createdAtMs: 1,
      isActive: true,
      lastActiveAtMs: 10,
    },
    {
      id: 'session-2',
      name: 'Terminal 2',
      workingDir: '/workspace/repo',
      createdAtMs: 2,
      isActive: false,
      lastActiveAtMs: 5,
    },
  ];
  terminalSessionsState.subscribers = [];
  Object.values(transportMocks).forEach((mock) => mock.mockClear());
  transportMocks.historyPage.mockResolvedValue({
    chunks: [],
    nextStartSeq: 0,
    hasMore: false,
    firstSequence: 0,
    lastSequence: 0,
    coveredBytes: 0,
    totalBytes: 0,
  });
  Object.values(rpcFsMocks).forEach((mock) => mock.mockClear());
  rpcFsMocks.getPathContext.mockResolvedValue({ agentHomePathAbs: '/workspace' });
  rpcFsMocks.list.mockResolvedValue({ entries: [] });
  rpcFsMocks.readFile.mockResolvedValue({ content: '{"scripts":{}}' });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TerminalPanel browser activity integration', () => {
  it('continues after sparse initial history without requesting a duplicate catchup', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportMocks.historyPage.mockResolvedValue({
      chunks: [
        { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-a ') },
        { sequence: 4, timestampMs: 20, data: textEncoder.encode('history-b') },
      ],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 2,
      lastSequence: 4,
      coveredBytes: 19,
      totalBytes: 19,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();
    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);

    emitTerminalData('session-1', 'live-c', 5);
    await settleTerminalPanel();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual([
      'history-a history-b',
      'live-c',
    ]);
  });

  it('adopts the first live sequence after empty activity history', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();

    emitTerminalData('session-1', 'continued-session', 37);
    await settleTerminalPanel();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual([
      'continued-session',
    ]);
  });

  it('deduplicates buffered live overlap after sparse activity history replay', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    let releaseHistoryPage: (page: Awaited<ReturnType<typeof transportMocks.historyPage>>) => void = () => {};
    const historyPage = new Promise<Awaited<ReturnType<typeof transportMocks.historyPage>>>((resolve) => {
      releaseHistoryPage = resolve;
    });
    transportMocks.historyPage.mockReturnValueOnce(historyPage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });
    emitTerminalData('session-1', 'duplicate-four', 4);
    emitTerminalData('session-1', 'fresh-five', 5);
    releaseHistoryPage({
      chunks: [
        { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-two ') },
        { sequence: 4, timestampMs: 20, data: textEncoder.encode('duplicate-four') },
      ],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 2,
      lastSequence: 4,
      coveredBytes: 26,
      totalBytes: 26,
    });
    await settleTerminalPanel();
    await vi.waitFor(() => {
      expect(terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toContain(
        'fresh-five',
      );
    });

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual([
      'history-two duplicate-four',
      'fresh-five',
    ]);
  });

  it('resumes gap-triggering live output when catchup history remains sparse', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportMocks.historyPage
      .mockResolvedValueOnce({
        chunks: [
          { sequence: 1, timestampMs: 5, data: textEncoder.encode('initial ') },
        ],
        nextStartSeq: 0,
        hasMore: false,
        firstSequence: 1,
        lastSequence: 1,
        coveredBytes: 8,
        totalBytes: 8,
      })
      .mockResolvedValue({
        chunks: [
          { sequence: 2, timestampMs: 10, data: textEncoder.encode('missing') },
        ],
        nextStartSeq: 0,
        hasMore: false,
        firstSequence: 2,
        lastSequence: 2,
        coveredBytes: 7,
        totalBytes: 7,
      });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreState.instances[0];
    core?.write.mockClear();
    emitTerminalData('session-1', 'after-gap', 5);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
      expect(core?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toContain('after-gap');
    });

    emitTerminalData('session-1', 'live-six', 6);
    await vi.waitFor(() => {
      expect(core?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toContain('live-six');
    });

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    expect(core?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual([
      'missing',
      'after-gap',
      'live-six',
    ]);
  });

  it('keeps a spinner for background interactive output while the command remains open', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    emitTerminalData('session-2', 'working...\n', 2);
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).toBeNull();

    await new Promise<void>((resolve) => setTimeout(resolve, 3_800));
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).toBeNull();
  });

  it('keeps session switching responsive while a background session is receiving heavy live output', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    for (let index = 0; index < 120; index += 1) {
      emitTerminalData('session-2', `chunk-${index}\n`, index + 2);
    }
    await settleTerminalPanel();

    const terminal2TabBeforeSwitch = findTerminalTab(host, 'Terminal 2');
    expect(terminal2TabBeforeSwitch?.dataset.terminalSessionActive).toBe('false');
    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();

    terminal2TabBeforeSwitch?.click();
    await settleTerminalPanel();

    const terminal2TabAfterSwitch = findTerminalTab(host, 'Terminal 2');
    expect(terminal2TabAfterSwitch?.dataset.terminalSessionActive).toBe('true');
    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).toBeNull();
  });
});
