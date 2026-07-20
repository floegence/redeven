import { For, Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { TerminalLiveErrorCode, TerminalLiveServerError } from '@floegence/floeterm-terminal-web/live';

import { EnvTerminalPage } from '../pages/EnvTerminalPage';
import { TerminalSessionCatalogContext } from '../services/terminalSessionCatalog';
import { TerminalPanel } from './TerminalPanel';

const layoutState = vi.hoisted(() => ({
  mobile: false,
}));

const browserWidgetState = vi.hoisted(() => ({
  currentWidgetId: null as string | null,
}));

const browserProtocolState = vi.hoisted(() => ({
  client: { id: 'protocol-client-1' } as object | null,
  setClient: null as ((client: object | null) => void) | null,
}));

function nearestRankP95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
}

function recordFixedTerminalPerformanceMetric(
  metric: string,
  durations: readonly number[],
  limitMs: number,
): void {
  const p95Ms = nearestRankP95(durations);
  console.info('[terminal-fixed-performance]', JSON.stringify({
    metric,
    samples_ms: durations,
    sample_count: durations.length,
    p95_ms: p95Ms,
    limit_ms: limitMs,
  }));
  if (import.meta.env.VITE_REDEVEN_FIXED_PERF_GATE === '1') {
    expect(p95Ms).toBeLessThanOrEqual(limitMs);
  }
}

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

const transportAttachState = vi.hoisted(() => ({ historyBoundarySequence: 0 }));

const transportMocks = vi.hoisted(() => {
  const attach = vi.fn().mockImplementation(async () => ({
    historyBoundarySequence: transportAttachState.historyBoundarySequence,
  }));
  return {
    sendInput: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    attach,
    attachWithHistoryBoundary: attach,
    history: vi.fn().mockResolvedValue([]),
    historyPage: vi.fn().mockResolvedValue({
      chunks: [],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 0,
      lastSequence: 0,
      coveredThroughSequence: 0,
      snapshotEndSequence: 0,
      firstRetainedSequence: 0,
      historyGeneration: 1,
      historyReset: false,
      historyTruncated: false,
      coveredBytes: 0,
      totalBytes: 0,
    }),
    getSessionStats: vi.fn().mockResolvedValue({ history: { totalBytes: 0 } }),
    clear: vi.fn().mockResolvedValue(undefined),
    forgetSession: vi.fn(),
    syncConnectionEpoch: vi.fn(),
    dispose: vi.fn(),
  };
});

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
  geometryHandlers: new Map<string, Set<(event: {
    sessionId: string;
    generation: number;
    outputSequenceBoundary: number;
    cols: number;
    rows: number;
  }) => void>>(),
}));

const terminalCoreState = vi.hoisted(() => ({
  instances: [] as Array<{
    write: ReturnType<typeof vi.fn>;
    setFixedDimensions: ReturnType<typeof vi.fn>;
    config: any;
  }>,
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
    foregroundCommand?: {
      phase: 'unknown' | 'idle' | 'running';
      displayName: string;
      revision: number;
      updatedAtMs: number;
    };
  }>,
  subscribers: [] as Array<(value: Array<{
    id: string;
    name: string;
    workingDir: string;
    createdAtMs: number;
    isActive: boolean;
    lastActiveAtMs: number;
    foregroundCommand?: {
      phase: 'unknown' | 'idle' | 'running';
      displayName: string;
      revision: number;
      updatedAtMs: number;
    };
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
    useCurrentWidgetId: () => browserWidgetState.currentWidgetId,
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
        aria-label={props['aria-label']}
        class={props.class}
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
    Input: (props: any) => (
      <input
        ref={props.ref}
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props['aria-label']}
        data-testid={props['data-testid']}
        class={props.class}
        onInput={props.onInput}
      />
    ),
    NumberInput: (props: any) => (
      <input
        value={props.value}
        onInput={(event) => props.onChange(Number((event.currentTarget as HTMLInputElement).value))}
      />
    ),
    MobileKeyboard: (props: any) => (
      <div ref={props.ref} data-testid="mobile-keyboard" aria-hidden={!props.visible} />
    ),
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

vi.mock('@floegence/floe-webapp-protocol', async () => ({
  ...await vi.importActual<typeof import('@floegence/floe-webapp-protocol')>('@floegence/floe-webapp-protocol'),
  useProtocol: () => {
    const [client, setClient] = createSignal(browserProtocolState.client);
    browserProtocolState.setClient = (nextClient) => {
      browserProtocolState.client = nextClient;
      setClient(nextClient);
    };
    return {
      client,
      status: () => client() ? 'connected' : 'disconnected',
    };
  },
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
    dispose = vi.fn(() => this.container.replaceChildren());
    setConnected = vi.fn();
    setTheme = vi.fn();
    setAppearance = vi.fn();
    forceResize = vi.fn();
    getDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
    startHistoryReplay = vi.fn();
    endHistoryReplay = vi.fn();
    write = vi.fn((_data: Uint8Array, callback?: () => void) => callback?.());
    writeFrame = vi.fn((data: Uint8Array, callback?: () => void) => this.write(data, callback));
    writeHistory = vi.fn((data: Uint8Array, callback?: () => void) => {
      this.write(data);
      callback?.();
    });
    focus = vi.fn();
    setFontSize = vi.fn();
    setFontFamily = vi.fn();
    setPresentationScale = vi.fn();
    setFixedDimensions = vi.fn();
    registerLinkProvider = vi.fn();
    setSearchResultsCallback = vi.fn();
    clearSearch = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
    clear = vi.fn();
    captureRestorableSnapshot = vi.fn((options?: { coveredThroughSequence?: number }) => ({
      version: 1 as const,
      data: 'browser snapshot',
      byteLength: 1024,
      partial: false,
      coveredThroughSequence: options?.coveredThroughSequence ?? 0,
      cols: 80,
      rows: 24,
      createdAtMs: Date.now(),
    }));
    restoreSnapshot = vi.fn().mockResolvedValue(true);
    getResourceEstimate = vi.fn(() => ({
      bufferBytes: 256 * 1024,
      cellCount: 2_000,
      estimatedBytes: 1024 * 1024,
      rendererType: 'webgl' as const,
    }));
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

vi.mock('../services/terminalTransport', async () => {
  const actual = await vi.importActual<typeof import('../services/terminalTransport')>('../services/terminalTransport');
  return {
  ...actual,
  createRedevenTerminalLiveBundle: () => ({ transport: transportMocks, eventSource: {
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
    onTerminalGeometry: (sessionId: string, handler: any) => {
      const current = terminalEventSourceState.geometryHandlers.get(sessionId) ?? new Set();
      current.add(handler);
      terminalEventSourceState.geometryHandlers.set(sessionId, current);
      return () => {
        terminalEventSourceState.geometryHandlers.get(sessionId)?.delete(handler);
      };
    },
  } }),
  createTerminalConnId: () => 'conn-1',
  };
});

vi.mock('../services/terminalSessions', () => ({
  createRedevenTerminalSessionsCoordinator: vi.fn(),
  disposeRedevenTerminalSessionsCoordinator: vi.fn(),
  getRedevenTerminalSessionsCoordinator: () => sessionsCoordinatorMocks,
  refreshRedevenTerminalSessionsCoordinator: vi.fn(),
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
    env_id: () => 'env-browser',
    env: Object.assign(
      () => ({
        permissions: {
          can_read: true,
          can_write: true,
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
    connectionOverlayVisible: () => false,
    connectionOverlayMessage: () => '',
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
  canLaunchProcess: () => true,
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

function publishTerminalForegroundCommand(
  sessionId: string,
  foregroundCommand: {
    phase: 'unknown' | 'idle' | 'running';
    displayName: string;
    revision: number;
    updatedAtMs: number;
  },
) {
  terminalSessionsState.sessions = terminalSessionsState.sessions.map((session) => (
    session.id === sessionId ? { ...session, foregroundCommand } : session
  ));
  for (const subscriber of terminalSessionsState.subscribers) subscriber(terminalSessionsState.sessions);
}

function emitTerminalGeometry(
  sessionId: string,
  generation: number,
  outputSequenceBoundary: number,
  cols: number,
  rows: number,
) {
  const handlers = terminalEventSourceState.geometryHandlers.get(sessionId);
  if (!handlers) return;
  for (const handler of handlers) {
    handler({ sessionId, generation, outputSequenceBoundary, cols, rows });
  }
}

function decodeTerminalWrite(value: unknown): string {
  return value instanceof Uint8Array ? textDecoder.decode(value) : '';
}

function withHistoryContract<T extends Record<string, unknown>>(pageValue: T): T & {
  coveredThroughSequence: number;
  snapshotEndSequence: number;
  firstRetainedSequence: number;
  historyGeneration: number;
  historyReset: boolean;
  historyTruncated: boolean;
} {
  const lastSequence = Number(pageValue.lastSequence ?? 0);
  return {
    coveredThroughSequence: lastSequence,
    snapshotEndSequence: lastSequence,
    firstRetainedSequence: 0,
    historyGeneration: 1,
    historyReset: false,
    historyTruncated: false,
    ...pageValue,
  };
}

function findTerminalTab(host: HTMLElement, label: string): HTMLElement | undefined {
  return Array.from(host.querySelectorAll<HTMLElement>('button[data-terminal-session-id]')).find((button) => button.textContent?.includes(label));
}

function findTerminalTabStatus(host: HTMLElement, label: string, status: 'running' | 'unread'): Element | null {
  return findTerminalTab(host, label)?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? null;
}

beforeEach(() => {
  sessionStorage.clear();
  layoutState.mobile = false;
  browserWidgetState.currentWidgetId = null;
  browserProtocolState.client = { id: 'protocol-client-1' };
  browserProtocolState.setClient = null;
  terminalPrefsState.userTheme = 'system';
  terminalPrefsState.fontSize = 12;
  terminalPrefsState.fontFamilyId = 'iosevka';
  terminalPrefsState.mobileInputMode = 'floe';
  terminalPrefsState.workIndicatorEnabled = true;
  terminalEventSourceState.dataHandlers = new Map();
  terminalEventSourceState.nameHandlers = new Map();
  terminalEventSourceState.geometryHandlers = new Map();
  transportAttachState.historyBoundarySequence = 0;
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
  transportMocks.attach.mockReset();
  transportMocks.attach.mockImplementation(async () => ({
    historyBoundarySequence: transportAttachState.historyBoundarySequence,
    runtimeAttachGeneration: 1,
  }));
  transportMocks.historyPage.mockResolvedValue(withHistoryContract({
    chunks: [],
    nextStartSeq: 0,
    hasMore: false,
    firstSequence: 0,
    lastSequence: 0,
    coveredBytes: 0,
    totalBytes: 0,
  }));
  Object.values(rpcFsMocks).forEach((mock) => mock.mockClear());
  rpcFsMocks.getPathContext.mockResolvedValue({ agentHomePathAbs: '/workspace' });
  rpcFsMocks.list.mockResolvedValue({ entries: [] });
  rpcFsMocks.readFile.mockResolvedValue({ content: '{"scripts":{}}' });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TerminalPanel browser activity integration', () => {
  it('presents the real eager catalog sidebar within the preloaded Activity interaction budget', async () => {
    const durations: number[] = [];

    for (let sampleIndex = 0; sampleIndex < 20; sampleIndex += 1) {
      const [active, setActive] = createSignal(false);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const catalog = {
        sessions: () => terminalSessionsState.sessions,
        hydrated: () => true,
        loading: () => false,
        stale: () => false,
        error: () => null,
        connectionEpoch: () => 1,
        coordinator: () => sessionsCoordinatorMocks,
        getCoordinator: () => sessionsCoordinatorMocks,
        refresh: async () => undefined,
        upsertSession: vi.fn(),
        removeSession: vi.fn(),
        updateSessionMeta: vi.fn(),
        clearForPermissionDenied: vi.fn(),
        requestPreparedHistory: async () => null,
        startHistoryWarmup: vi.fn(),
        invalidateHistory: vi.fn(),
        setSurfaceActive: vi.fn(),
      } as any;
      const dispose = render(() => (
        <TerminalSessionCatalogContext.Provider value={catalog}>
          <button type="button" data-activity-id="terminal" onClick={() => setActive(true)}>
            Terminal
          </button>
          <Show when={active()}>
            <EnvTerminalPage />
          </Show>
        </TerminalSessionCatalogContext.Provider>
      ), host);
      const startedAt = performance.now();

      host.querySelector<HTMLButtonElement>('[data-activity-id="terminal"]')?.click();
      await vi.waitFor(() => {
        expect(host.querySelectorAll('button[data-terminal-session-id]')).toHaveLength(2);
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      durations.push(performance.now() - startedAt);

      expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).toBeNull();
      expect(host.textContent).not.toContain('Loading sessions');
      dispose();
      host.remove();
    }

    recordFixedTerminalPerformanceMetric('terminal_activity_sidebar_presented', durations, 100);
  });

  it('renders the hydrated session directory in the first committed frame without loading flicker', async () => {
    const durations: number[] = [];
    for (let sampleIndex = 0; sampleIndex < 20; sampleIndex += 1) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const startedAt = performance.now();
      const dispose = render(() => <TerminalPanel variant="workbench" />, host);

      expect(host.querySelectorAll('button[data-terminal-session-id]')).toHaveLength(2);
      expect(host.textContent).not.toContain('Loading terminal sessions');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      durations.push(performance.now() - startedAt);
      expect(host.querySelectorAll('button[data-terminal-session-id]')).toHaveLength(2);
      expect(host.textContent).not.toContain('Loading terminal sessions');
      dispose();
      host.remove();
    }
    recordFixedTerminalPerformanceMetric('terminal_sidebar_presented', durations, 100);
  });

  it('paints a pending row before issuing the create RPC', async () => {
    let resolveCreate!: (value: typeof terminalSessionsState.sessions[number]) => void;
    sessionsCoordinatorMocks.createSession.mockReset();
    sessionsCoordinatorMocks.createSession.mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();
    performance.clearMarks();

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-sidebar-add-session"]')?.click();

    expect(findTerminalTab(host, 'Terminal 3')).toBeTruthy();
    expect(sessionsCoordinatorMocks.createSession).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

    expect(performance.getEntriesByName('redeven:terminal:pending-row-painted', 'mark')).toHaveLength(1);
    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledTimes(1);
    resolveCreate({
      id: 'session-3',
      name: 'Terminal 3',
      workingDir: '/workspace',
      createdAtMs: 3,
      isActive: true,
      lastActiveAtMs: 3,
    });
    await settleTerminalPanel();
  });

  it('keeps pending-row paint p95 within the fixed runner budget', async () => {
    sessionsCoordinatorMocks.createSession.mockReset();
    sessionsCoordinatorMocks.createSession.mockImplementation(() => new Promise(() => undefined));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const durations: number[] = [];
    for (let sampleIndex = 0; sampleIndex < 20; sampleIndex += 1) {
      const startedAt = performance.now();
      host.querySelector<HTMLButtonElement>('[data-testid="terminal-sidebar-add-session"]')?.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      durations.push(performance.now() - startedAt);
      expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledTimes(sampleIndex + 1);
    }

    recordFixedTerminalPerformanceMetric('terminal_pending_row_painted', durations, 32);
    dispose();
  });

  it('mounts only the final cold target during a rapid A to B to C switch', async () => {
    terminalSessionsState.sessions.push({
      id: 'session-3',
      name: 'Terminal 3',
      workingDir: '/workspace/logs',
      createdAtMs: 3,
      isActive: false,
      lastActiveAtMs: 3,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();
    transportMocks.attach.mockClear();

    findTerminalTab(host, 'Terminal 2')?.click();
    findTerminalTab(host, 'Terminal 3')?.click();

    expect(findTerminalTab(host, 'Terminal 3')?.dataset.terminalSessionActive).toBe('true');
    expect(terminalCoreState.instances).toHaveLength(1);
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    await vi.waitFor(() => expect(terminalCoreState.instances).toHaveLength(2));
    expect(transportMocks.attach.mock.calls.map((call) => call[0])).toEqual(['session-3']);
  });

  it('keeps one hundred dormant sessions metadata-only when no session is selected', async () => {
    terminalSessionsState.sessions = Array.from({ length: 100 }, (_, index) => ({
      id: `dormant-${index + 1}`,
      name: `Dormant ${index + 1}`,
      workingDir: `/workspace/${index + 1}`,
      createdAtMs: index + 1,
      isActive: false,
      lastActiveAtMs: 100 - index,
    }));
    const group = {
      sessionIds: terminalSessionsState.sessions.map((session) => session.id),
      activeSessionId: null,
    };
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TerminalPanel
        variant="workbench"
        sessionGroupState={group}
        onSessionGroupStateChange={() => undefined}
      />
    ), host);
    await settleTerminalPanel();

    expect(host.querySelectorAll('button[data-terminal-session-id]')).toHaveLength(100);
    expect(terminalCoreState.instances).toHaveLength(0);
    expect(transportMocks.attach).not.toHaveBeenCalled();
    expect(transportMocks.resize).not.toHaveBeenCalled();
    expect(transportMocks.historyPage).not.toHaveBeenCalled();
    expect(terminalEventSourceState.dataHandlers.size).toBe(0);
  });

  it('reconciles live_v1 session_not_found immediately without waiting for the poll interval', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportMocks.attach.mockRejectedValueOnce(new TerminalLiveServerError(
      TerminalLiveErrorCode.SessionNotFound,
      'terminal session not found',
    ));
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await vi.waitFor(() => expect(findTerminalTab(host, 'Terminal 1')).toBeUndefined());

    expect(transportMocks.forgetSession).toHaveBeenCalledWith('session-1');
    expect(sessionsCoordinatorMocks.refresh).toHaveBeenCalled();
  });

  it('continues after sparse initial history without requesting a duplicate catchup', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportAttachState.historyBoundarySequence = 4;
    transportMocks.historyPage.mockResolvedValue(withHistoryContract({
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
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();
    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(transportMocks.historyPage).toHaveBeenCalledWith(
      'session-1',
      0,
      -1,
      { snapshotEndSequence: 4, historyGeneration: undefined },
    );

    emitTerminalData('session-1', 'live-c', 5);
    await settleTerminalPanel();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual([
      'history-a history-b',
      'live-c',
    ]);
  });

  it('does not fetch unbounded history for a zero boundary and first live sequence', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();
    expect(transportMocks.historyPage).not.toHaveBeenCalled();

    emitTerminalData('session-1', 'first-live', 1);
    await settleTerminalPanel();

    expect(transportMocks.historyPage).not.toHaveBeenCalled();
    expect(terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual([
      'first-live',
    ]);
  });

  it('applies shared geometry exactly between the output sequences around its boundary', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();
    const core = terminalCoreState.instances[0]!;
    expect(core.config.responsive.reportHostDimensionsWithFixedGrid).toBe(true);

    emitTerminalData('session-1', 'old-size', 1);
    emitTerminalGeometry('session-1', 2, 1, 90, 28);
    emitTerminalData('session-1', 'new-size', 2);
    await settleTerminalPanel();

    expect(core.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual([
      'old-size',
      'new-size',
    ]);
    expect(core.setFixedDimensions).toHaveBeenCalledTimes(1);
    expect(core.setFixedDimensions).toHaveBeenCalledWith({ cols: 90, rows: 28 });
    expect(core.write.mock.invocationCallOrder[0]).toBeLessThan(core.setFixedDimensions.mock.invocationCallOrder[0]!);
    expect(core.setFixedDimensions.mock.invocationCallOrder[0]).toBeLessThan(core.write.mock.invocationCallOrder[1]!);
  });

  it('retains live output received during a delayed zero-boundary attach round trip', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    let releaseAttach!: (result: { historyBoundarySequence: number }) => void;
    const attachResult = new Promise<{ historyBoundarySequence: number }>((resolve) => {
      releaseAttach = resolve;
    });
    transportMocks.attachWithHistoryBoundary.mockReturnValueOnce(attachResult);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await expect.poll(() => transportMocks.attachWithHistoryBoundary.mock.calls.length).toBe(1);

    emitTerminalData('session-1', 'attach-rtt-live', 1);
    releaseAttach({ historyBoundarySequence: 0 });

    await expect.poll(() => (
      terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0])) ?? []
    )).toEqual(['attach-rtt-live']);
    expect(transportMocks.historyPage).not.toHaveBeenCalled();
  });

  it('adopts the first live sequence after empty activity history', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportMocks.historyPage.mockResolvedValue(withHistoryContract({
      chunks: [],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 0,
      lastSequence: 0,
      coveredThroughSequence: 36,
      snapshotEndSequence: 36,
      coveredBytes: 0,
      totalBytes: 0,
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();

    emitTerminalData('session-1', 'continued-session', 37);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
      expect(terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual([
        'continued-session',
      ]);
    });
  });

  it('deduplicates buffered live overlap after sparse activity history replay', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportAttachState.historyBoundarySequence = 4;
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
    emitTerminalData('session-1', 'raw-live-four', 4);
    emitTerminalData('session-1', 'fresh-five', 5);
    releaseHistoryPage(withHistoryContract({
      chunks: [
        { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-two ') },
        { sequence: 4, timestampMs: 20, data: textEncoder.encode('filtered-history-four') },
      ],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 2,
      lastSequence: 4,
      coveredBytes: 26,
      totalBytes: 26,
    }));
    await settleTerminalPanel();
    await vi.waitFor(() => {
      expect(terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toContain(
        'fresh-five',
      );
    });

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual([
      'history-two ',
      'raw-live-four',
      'fresh-five',
    ]);
  });

  it('retains post-boundary live output while sparse initial history is pending', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportAttachState.historyBoundarySequence = 4;
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

    const core = terminalCoreState.instances[0];
    emitTerminalData('session-1', 'live-five', 5);
    emitTerminalData('session-1', 'live-six', 6);
    releaseHistoryPage(withHistoryContract({
      chunks: [
        { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-two ') },
        { sequence: 4, timestampMs: 20, data: textEncoder.encode('history-four') },
      ],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 2,
      lastSequence: 4,
      coveredBytes: 23,
      totalBytes: 23,
    }));

    await settleTerminalPanel();
    await vi.waitFor(() => {
      expect(core?.write.mock.calls.map((call) => decodeTerminalWrite(call[0])).join('')).toContain('live-five');
    });

    emitTerminalData('session-1', 'live-seven', 7);
    await vi.waitFor(() => {
      expect(core?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toContain('live-seven');
    });

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(core?.write.mock.calls.map((call) => decodeTerminalWrite(call[0])).join('')).toBe(
      'history-two history-fourlive-fivelive-sixlive-seven',
    );
  });

  it('resumes gap-triggering live output when catchup history remains sparse', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportAttachState.historyBoundarySequence = 1;
    transportMocks.historyPage
      .mockResolvedValueOnce(withHistoryContract({
        chunks: [
          { sequence: 1, timestampMs: 5, data: textEncoder.encode('initial ') },
        ],
        nextStartSeq: 0,
        hasMore: false,
        firstSequence: 1,
        lastSequence: 1,
        coveredBytes: 8,
        totalBytes: 8,
      }))
      .mockResolvedValue(withHistoryContract({
        chunks: [
          { sequence: 2, timestampMs: 10, data: textEncoder.encode('missing') },
        ],
        nextStartSeq: 0,
        hasMore: false,
        firstSequence: 2,
        lastSequence: 4,
        coveredBytes: 7,
        totalBytes: 7,
      }));

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

  it('keeps sparse queued live output below a later history high-water', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportAttachState.historyBoundarySequence = 1;
    let releaseCatchupPage: (page: Awaited<ReturnType<typeof transportMocks.historyPage>>) => void = () => {};
    const catchupPage = new Promise<Awaited<ReturnType<typeof transportMocks.historyPage>>>((resolve) => {
      releaseCatchupPage = resolve;
    });
    transportMocks.historyPage
      .mockResolvedValueOnce(withHistoryContract({
        chunks: [
          { sequence: 1, timestampMs: 5, data: textEncoder.encode('initial ') },
        ],
        nextStartSeq: 0,
        hasMore: false,
        firstSequence: 1,
        lastSequence: 1,
        coveredBytes: 8,
        totalBytes: 8,
      }))
      .mockReturnValueOnce(catchupPage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreState.instances[0];
    core?.write.mockClear();
    emitTerminalData('session-1', 'live-five', 5);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    });

    emitTerminalData('session-1', 'covered-live-six', 6);
    releaseCatchupPage(withHistoryContract({
      chunks: [
        { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-two ') },
      ],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 2,
      lastSequence: 2,
      coveredThroughSequence: 4,
      snapshotEndSequence: 4,
      coveredBytes: 12,
      totalBytes: 12,
    }));
    await settleTerminalPanel();

    emitTerminalData('session-1', 'live-seven', 7);
    await settleTerminalPanel();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    expect(core?.write.mock.calls.map((call) => decodeTerminalWrite(call[0])).join('')).toBe(
      'history-two live-fivecovered-live-sixlive-seven',
    );
  });

  it('resets the real activity pipeline after clear before accepting a continued sequence', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportAttachState.historyBoundarySequence = 4;
    transportMocks.historyPage.mockResolvedValue(withHistoryContract({
      chunks: [],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 0,
      lastSequence: 0,
      coveredThroughSequence: 4,
      snapshotEndSequence: 4,
      coveredBytes: 0,
      totalBytes: 0,
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();

    emitTerminalData('session-1', 'before-clear', 5);
    await settleTerminalPanel();

    terminalCoreState.instances[0]?.write.mockClear();
    transportAttachState.historyBoundarySequence = 36;
    transportMocks.historyPage.mockResolvedValue(withHistoryContract({
      chunks: [],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 0,
      lastSequence: 0,
      coveredThroughSequence: 36,
      snapshotEndSequence: 36,
      historyGeneration: 2,
      coveredBytes: 0,
      totalBytes: 0,
    }));
    host.querySelector<HTMLButtonElement>('button[title="Clear"]')?.click();
    await vi.waitFor(() => expect(terminalCoreState.instances.length).toBeGreaterThan(1));
    expect(transportMocks.clear).toHaveBeenCalledWith('session-1');

    const core = terminalCoreState.instances.at(-1);
    core?.write.mockClear();
    emitTerminalData('session-1', 'after-clear', 37);
    await vi.waitFor(() => {
      expect(core?.write.mock.calls.map((call) => decodeTerminalWrite(call[0]))).toEqual(['after-clear']);
    });
  });

  it('does not show the foreground spinner for shell markers or background output', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await vi.waitFor(() => {
      expect(transportMocks.attach.mock.calls.some((call) => call[0] === 'session-2')).toBe(true);
    });

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    emitTerminalData('session-2', 'working...\n', 2);
    await settleTerminalPanel();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
  });

  it('shows a confirmed program title and spinner, then restores the directory on idle', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    publishTerminalForegroundCommand('session-2', {
      phase: 'running', displayName: 'top', revision: 1, updatedAtMs: 10,
    });
    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(host.querySelector('[data-terminal-session-title="session-2"]')?.textContent).toBe('top');
    expect(host.querySelector('[data-testid="terminal-session-path-session-2"]')?.textContent).toBe('/workspace/repo');

    publishTerminalForegroundCommand('session-2', {
      phase: 'idle', displayName: '', revision: 2, updatedAtMs: 20,
    });
    await settleTerminalPanel();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
    expect(host.querySelector('[data-terminal-session-title="session-2"]')?.textContent).toBe('repo');
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
    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();

    terminal2TabBeforeSwitch?.click();
    await settleTerminalPanel();

    const terminal2TabAfterSwitch = findTerminalTab(host, 'Terminal 2');
    expect(terminal2TabAfterSwitch?.dataset.terminalSessionActive).toBe('true');
    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
  });

  it('switches ten warm cores by the next animation frame without new runtime calls', async () => {
    terminalSessionsState.sessions = Array.from({ length: 10 }, (_, index) => ({
      id: `session-${index + 1}`,
      name: `Terminal ${index + 1}`,
      workingDir: `/workspace/${index + 1}`,
      createdAtMs: index + 1,
      isActive: index === 0,
      lastActiveAtMs: 10 - index,
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    for (let index = 2; index <= 10; index += 1) {
      findTerminalTab(host, `Terminal ${index}`)?.click();
      await settleTerminalPanel();
      await vi.waitFor(() => {
        expect(terminalCoreState.instances.length).toBeGreaterThanOrEqual(index);
      });
    }
    expect(terminalCoreState.instances).toHaveLength(10);
    transportMocks.attach.mockClear();
    transportMocks.historyPage.mockClear();

    const durations: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const targetIndex = (index % 10) + 1;
      const start = performance.now();
      findTerminalTab(host, `Terminal ${targetIndex}`)?.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      durations.push(performance.now() - start);
    }

    expect(durations.every((duration) => Number.isFinite(duration) && duration >= 0)).toBe(true);
    recordFixedTerminalPerformanceMetric('terminal_warm_core_switch', durations, 50);
    expect(terminalCoreState.instances).toHaveLength(10);
    expect(transportMocks.attach).not.toHaveBeenCalled();
    expect(transportMocks.historyPage).not.toHaveBeenCalled();
  }, 10_000);

  it('keeps the mobile drawer and search surface inside 320x568, 390x844, desktop, and transformed hosts', async () => {
    const renderResponsivePanel = async (width: number, height: number, transformed = false) => {
      await page.viewport(width, height);
      layoutState.mobile = width < 640;
      const host = document.createElement('div');
      host.style.width = transformed ? '600px' : '100vw';
      host.style.height = transformed ? '500px' : '100vh';
      if (transformed) {
        host.style.transform = 'scale(0.8)';
        host.style.transformOrigin = 'top left';
      }
      document.body.appendChild(host);
      const dispose = render(() => <TerminalPanel variant="workbench" />, host);
      await settleTerminalPanel();

      const hostRect = host.getBoundingClientRect();
      const contentRect = host.querySelector<HTMLElement>('[data-testid="terminal-content"]')?.getBoundingClientRect();
      expect(contentRect?.width ?? 0).toBeGreaterThan(0);
      expect((contentRect?.right ?? 0) <= hostRect.right + 1).toBe(true);

      if (layoutState.mobile) {
        host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-drawer-open"]')?.click();
        await settleTerminalPanel();
        const drawer = host.querySelector<HTMLElement>('.redeven-terminal-session-sidebar');
        const drawerRect = drawer?.getBoundingClientRect();
        expect(drawerRect?.left ?? -1).toBeGreaterThanOrEqual(hostRect.left - 1);
        expect((drawerRect?.right ?? Number.POSITIVE_INFINITY) <= hostRect.right + 1).toBe(true);
        expect((drawerRect?.bottom ?? Number.POSITIVE_INFINITY) <= hostRect.bottom + 1).toBe(true);
      }

      const screenshot = await page.screenshot({ save: false });
      expect(screenshot.length).toBeGreaterThan(1_000);
      dispose();
      host.remove();
    };

    try {
      await renderResponsivePanel(320, 568);
      await renderResponsivePanel(390, 844);
      await renderResponsivePanel(1280, 800);
      await renderResponsivePanel(900, 700, true);
    } finally {
      await page.viewport(1280, 720);
    }
  }, 15_000);
});
