import '../../index.css';

import { For, Show, createSignal } from 'solid-js';
import { render as solidRender } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { getThemeColors } from '@floegence/floeterm-terminal-web';
import {
  TerminalLiveErrorCode,
  TerminalLiveServerError,
  type TerminalLiveAttachResult,
} from '@floegence/floeterm-terminal-web/live';

import { EnvTerminalPage } from '../pages/EnvTerminalPage';
import { TerminalSessionCatalogContext } from '../services/terminalSessionCatalog';
import { FloatingContextMenu } from './FloatingContextMenu';
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

const activeRenderDisposers = new Set<() => void>();

const render: typeof solidRender = ((...args: Parameters<typeof solidRender>) => {
  const disposeRoot = solidRender(...args);
  const dispose = () => {
    if (!activeRenderDisposers.delete(dispose)) return;
    disposeRoot();
  };
  activeRenderDisposers.add(dispose);
  return dispose;
}) as typeof solidRender;

const mediaCommands = commands as unknown as Readonly<{
  installTerminalAgentIconRoutes: () => Promise<void>;
  emulateMediaPreferences: (preferences: Readonly<{
    forcedColors?: null | 'active' | 'none';
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
  inspectTerminalSharedGeometryScreenshot: () => Promise<Readonly<{
    fullHash: string;
    safeCanvasHash: string;
    canvasWidth: number;
    canvasHeight: number;
  }>>;
  inspectTerminalAvatarScreenshot: (sessionId: string) => Promise<Readonly<{
    screenshotHash: string;
    avatarWidth: number;
    avatarHeight: number;
    markWidth: number;
    markHeight: number;
    totalPixels: number;
    paintedPixels: number;
    distinctColorBuckets: number;
  }>>;
}>;

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

const appThemeState = vi.hoisted(() => ({
  resolvedTheme: 'dark' as 'dark' | 'light',
}));

const rpcFsMocks = vi.hoisted(() => ({
  getPathContext: vi.fn().mockResolvedValue({ agentHomePathAbs: '/workspace' }),
  list: vi.fn().mockResolvedValue({ entries: [] }),
  readFile: vi.fn().mockResolvedValue({ content: '{"scripts":{}}' }),
}));

const envContextMocks = vi.hoisted(() => ({
  openFlowerTurnLauncher: vi.fn(),
  openFileBrowserAtPath: vi.fn(async () => undefined),
}));

const transportAttachState = vi.hoisted(() => ({
  historyBoundarySequence: 0,
  effectiveCols: null as number | null,
  effectiveRows: null as number | null,
}));

const transportMocks = vi.hoisted(() => {
  const attach = vi.fn().mockImplementation(async (_sessionId: string, cols: number, rows: number) => ({
    historyBoundarySequence: transportAttachState.historyBoundarySequence,
    historyGeneration: 1,
    historyStartSequence: 0,
    geometryGeneration: 1,
    runtimeAttachGeneration: 1,
    cols: transportAttachState.effectiveCols ?? cols,
    rows: transportAttachState.effectiveRows ?? rows,
  }));
  const resize = vi.fn().mockImplementation(async (_sessionId: string, cols: number, rows: number) => ({
    runtimeAttachGeneration: 1,
    requested: { cols, rows },
    effective: {
      generation: 1,
      outputSequenceBoundary: transportAttachState.historyBoundarySequence,
      cols,
      rows,
    },
  }));
  return {
    sendInput: vi.fn().mockResolvedValue(undefined),
    resize,
    resizeWithEffectiveGeometry: resize,
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
    getDimensions: () => { cols: number; rows: number };
    focus: ReturnType<typeof vi.fn>;
    handlers: { onError?: (error: Error) => void };
    config: any;
    emitBell: () => void;
  }>,
}));

const terminalSessionsState = vi.hoisted(() => ({
  sessions: [
    {
      id: 'session-1',
      name: 'Terminal 1',
      workingDir: '/workspace',
      localPathCapability: { workingDir: '/workspace' },
      createdAtMs: 1,
      isActive: true,
      lastActiveAtMs: 10,
    },
    {
      id: 'session-2',
      name: 'Terminal 2',
      workingDir: '/workspace/repo',
      localPathCapability: { workingDir: '/workspace/repo' },
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
    outputActivity?: {
      phase: 'unknown' | 'streaming' | 'settled';
      revision: number;
      updatedAtMs: number;
    };
    executionContext?: any;
    workState?: any;
    localPathCapability?: { workingDir: string };
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
    outputActivity?: {
      phase: 'unknown' | 'streaming' | 'settled';
      revision: number;
      updatedAtMs: number;
    };
    executionContext?: any;
    workState?: any;
    localPathCapability?: { workingDir: string };
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
      resolvedTheme: () => appThemeState.resolvedTheme,
      shellPresetForMode: () => undefined,
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
    setScrollbarOptions = vi.fn();
    registerLinkProvider = vi.fn();
    setSearchResultsCallback = vi.fn();
    clearSearch = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
    emitBell = () => this.handlers?.onBell?.();
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
      wasmMemoryBytes: 512 * 1024,
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
    onTerminalLiveAttachmentLifecycle: () => () => undefined,
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

vi.mock('../services/terminalPreferences', async () => {
  const actual = await vi.importActual<typeof import('../services/terminalPreferences')>('../services/terminalPreferences');
  return {
    ...actual,
    ensureTerminalPreferencesInitialized: vi.fn(),
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
  };
});

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
    openFlowerTurnLauncher: envContextMocks.openFlowerTurnLauncher,
    openTerminalInDirectoryRequestSeq: () => 0,
    openTerminalInDirectoryRequest: () => null,
    openTerminalInDirectory: vi.fn(),
    openFileBrowserAtPath: envContextMocks.openFileBrowserAtPath,
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

function publishTerminalOutputActivity(
  sessionId: string,
  outputActivity: {
    phase: 'unknown' | 'streaming' | 'settled';
    revision: number;
    updatedAtMs: number;
  },
) {
  terminalSessionsState.sessions = terminalSessionsState.sessions.map((session) => (
    session.id === sessionId ? { ...session, outputActivity } : session
  ));
  for (const subscriber of terminalSessionsState.subscribers) subscriber(terminalSessionsState.sessions);
}

function publishTerminalExecutionContext(sessionId: string, executionContext: any) {
  terminalSessionsState.sessions = terminalSessionsState.sessions.map((session) => (
    session.id === sessionId ? { ...session, executionContext } : session
  ));
  for (const subscriber of terminalSessionsState.subscribers) subscriber(terminalSessionsState.sessions);
}

function publishTerminalWorkState(sessionId: string, workState: any) {
  terminalSessionsState.sessions = terminalSessionsState.sessions.map((session) => (
    session.id === sessionId ? { ...session, workState } : session
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

function findTerminalTabStatus(host: HTMLElement, label: string, status: 'spinner' | 'unread'): Element | null {
  return findTerminalTab(host, label)?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? null;
}

function localPresentationExecutionContext(workingDirectory: string) {
  return {
    location: {
      kind: 'local',
      phase: 'ready',
      label: '',
      authority: '',
      workingDirectory,
      source: 'shell_integration',
    },
    application: { kind: 'shell', identity: '', displayName: '' },
    revision: 1,
    updatedAtMs: 10,
  };
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
  appThemeState.resolvedTheme = 'dark';
  terminalEventSourceState.dataHandlers = new Map();
  terminalEventSourceState.nameHandlers = new Map();
  terminalEventSourceState.geometryHandlers = new Map();
  transportAttachState.historyBoundarySequence = 0;
  transportAttachState.effectiveCols = null;
  transportAttachState.effectiveRows = null;
  terminalCoreState.instances = [];
  terminalSessionsState.sessions = [
    {
      id: 'session-1',
      name: 'Terminal 1',
      workingDir: '/workspace',
      createdAtMs: 1,
      isActive: true,
      lastActiveAtMs: 10,
      executionContext: localPresentationExecutionContext('/workspace'),
      localPathCapability: { workingDir: '/workspace' },
    },
    {
      id: 'session-2',
      name: 'Terminal 2',
      workingDir: '/workspace/repo',
      createdAtMs: 2,
      isActive: false,
      lastActiveAtMs: 5,
      executionContext: localPresentationExecutionContext('/workspace/repo'),
      localPathCapability: { workingDir: '/workspace/repo' },
    },
  ];
  terminalSessionsState.subscribers = [];
  envContextMocks.openFlowerTurnLauncher.mockClear();
  envContextMocks.openFileBrowserAtPath.mockClear();
  Object.values(transportMocks).forEach((mock) => mock.mockClear());
  transportMocks.attach.mockReset();
  transportMocks.attach.mockImplementation(async (_sessionId: string, cols: number, rows: number) => ({
    historyBoundarySequence: transportAttachState.historyBoundarySequence,
    historyGeneration: 1,
    historyStartSequence: 0,
    geometryGeneration: 1,
    runtimeAttachGeneration: 1,
    cols: transportAttachState.effectiveCols ?? cols,
    rows: transportAttachState.effectiveRows ?? rows,
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
  for (const dispose of [...activeRenderDisposers].reverse()) dispose();
  document.body.innerHTML = '';
});

describe('TerminalPanel browser activity integration', () => {
  it('passes explicit released theme palettes to TerminalCore independently of the app appearance', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    terminalPrefsState.userTheme = 'signalSafeDark';
    appThemeState.resolvedTheme = 'dark';
    const darkHost = document.createElement('div');
    document.body.appendChild(darkHost);
    const disposeDark = render(() => <TerminalPanel variant="panel" />, darkHost);
    await vi.waitFor(() => expect(terminalCoreState.instances).toHaveLength(1));
    expect(terminalCoreState.instances[0]?.config.theme).toEqual(getThemeColors('signalSafeDark'));

    disposeDark();
    darkHost.remove();
    terminalCoreState.instances = [];
    appThemeState.resolvedTheme = 'light';
    const lightHost = document.createElement('div');
    document.body.appendChild(lightHost);
    const disposeLight = render(() => <TerminalPanel variant="panel" />, lightHost);
    await vi.waitFor(() => expect(terminalCoreState.instances).toHaveLength(1));
    expect(terminalCoreState.instances[0]?.config.theme).toEqual(getThemeColors('signalSafeDark'));

    disposeLight();
  });

  it('uses a light catalog palette exactly and keeps an unknown stored id untouched while rendering Dark', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    terminalPrefsState.userTheme = 'studioPaper';
    const lightHost = document.createElement('div');
    document.body.appendChild(lightHost);
    const disposeLight = render(() => <TerminalPanel variant="panel" />, lightHost);
    await vi.waitFor(() => expect(terminalCoreState.instances).toHaveLength(1));
    expect(terminalCoreState.instances[0]?.config.theme).toEqual(getThemeColors('studioPaper'));
    disposeLight();
    lightHost.remove();

    terminalCoreState.instances = [];
    terminalPrefsState.userTheme = 'futureThemeFromNewerClient';
    const unknownHost = document.createElement('div');
    document.body.appendChild(unknownHost);
    const disposeUnknown = render(() => <TerminalPanel variant="panel" />, unknownHost);
    await vi.waitFor(() => expect(terminalCoreState.instances).toHaveLength(1));
    expect(terminalCoreState.instances[0]?.config.theme).toEqual(getThemeColors('dark'));
    expect(terminalPrefsState.userTheme).toBe('futureThemeFromNewerClient');
    disposeUnknown();
  });

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
    const shortcutCells = host.querySelectorAll<HTMLElement>('[data-terminal-session-action-cell="index"]');
    expect(shortcutCells).toHaveLength(100);
    expect(shortcutCells[8]?.textContent?.trim()).toBe('9');
    expect(shortcutCells[9]?.textContent?.trim()).toBe('');
    expect(shortcutCells[99]?.textContent?.trim()).toBe('');
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

  it('projects shared-geometry details into the explicit owner surface without changing terminal geometry', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportAttachState.effectiveCols = 60;
    transportAttachState.effectiveRows = 20;
    const surfaceHost = document.createElement('div');
    surfaceHost.setAttribute('data-floe-dialog-surface-host', 'true');
    surfaceHost.style.cssText = 'position:relative;width:840px;height:500px;';
    document.body.appendChild(surfaceHost);
    const dispose = render(() => <TerminalPanel variant="workbench" workbenchSelected />, surfaceHost);

    try {
      await expect.poll(() => surfaceHost.querySelector('[data-testid="terminal-shared-geometry-status-notice"]')).toBeTruthy();
      const trigger = surfaceHost.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
      const terminalContent = surfaceHost.querySelector<HTMLElement>('[data-testid="terminal-content"]')!;
      const core = terminalCoreState.instances[0]!;
      const contentBefore = terminalContent.getBoundingClientRect();
      const dimensionsBefore = core.getDimensions();
      core.setFixedDimensions.mockClear();
      transportMocks.resizeWithEffectiveGeometry.mockClear();

      trigger.focus();
      await new Promise<void>((resolve) => setTimeout(resolve, 1650));
      const closedScreenshot = await mediaCommands.inspectTerminalSharedGeometryScreenshot();
      await userEvent.keyboard('{Enter}');
      await expect.poll(() => surfaceHost.querySelector('[data-floe-surface-floating-layer="true"]')).toBeTruthy();
      const openScreenshot = await mediaCommands.inspectTerminalSharedGeometryScreenshot();

      const region = surfaceHost.querySelector<HTMLElement>('[role="region"]')!;
      const disclosure = surfaceHost.querySelector<HTMLElement>('.terminal-shared-geometry-disclosure')!;
      const panelRoot = surfaceHost.querySelector<HTMLElement>('[data-terminal-panel-variant]')!;
      expect(region.textContent).toContain('60×20');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(trigger.getAttribute('aria-controls')).toBe(region.id);
      expect(document.activeElement).toBe(trigger);
      expect(disclosure.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        panelRoot.getBoundingClientRect().bottom - 7,
      );
      expect(region.tabIndex).toBe(0);
      expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
      expect(region.getAttribute('data-floe-canvas-wheel-interactive')).toBe('true');
      expect(region.getAttribute('data-redeven-workbench-wheel-role')).toBe('local-scroll-viewport');
      expect(terminalContent.getBoundingClientRect()).toEqual(contentBefore);
      expect(core.getDimensions()).toEqual(dimensionsBefore);
      expect(core.setFixedDimensions).not.toHaveBeenCalled();
      expect(transportMocks.resizeWithEffectiveGeometry).not.toHaveBeenCalled();
      expect(openScreenshot.fullHash).not.toBe(closedScreenshot.fullHash);
      expect(openScreenshot.safeCanvasHash).toBe(closedScreenshot.safeCanvasHash);
      expect(openScreenshot.canvasWidth).toBe(closedScreenshot.canvasWidth);
      expect(openScreenshot.canvasHeight).toBe(closedScreenshot.canvasHeight);
      const surfaceTransform = surfaceHost.style.transform;
      const selectionBefore = window.getSelection()?.toString() ?? '';
      region.focus();
      await userEvent.keyboard('{PageDown}');
      await expect.poll(() => region.scrollTop).toBeGreaterThan(0);
      expect(surfaceHost.style.transform).toBe(surfaceTransform);
      expect(window.getSelection()?.toString() ?? '').toBe(selectionBefore);

      surfaceHost.style.transform = 'translateX(15px)';
      await expect.poll(() => surfaceHost.querySelector('[data-floe-surface-floating-layer="true"]')).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    } finally {
      dispose();
      surfaceHost.remove();
    }
  });

  it('keeps long session identity tooltips inside a transformed Workbench surface for hover and focus', async () => {
    terminalSessionsState.sessions = [{
      id: 'session-remote',
      name: 'SSH',
      workingDir: '/workspace',
      createdAtMs: 1,
      isActive: true,
      lastActiveAtMs: 10,
      executionContext: {
        location: {
          kind: 'remote',
          phase: 'ready',
          label: 'root@build-runner-with-a-very-long-hostname.example.internal',
          authority: 'build-runner-with-a-very-long-hostname.example.internal',
          workingDirectory: '/srv/repositories/redeven/feature/terminal-context',
          source: 'osc7',
        },
        application: { kind: 'shell', identity: '', displayName: '' },
        revision: 2,
        updatedAtMs: 10,
      },
    }];
    const surfaceHost = document.createElement('div');
    surfaceHost.setAttribute('data-floe-dialog-surface-host', 'true');
    surfaceHost.style.cssText = 'position:relative;width:640px;height:440px;transform:translateX(18px) scale(0.9);transform-origin:top left;';
    document.body.appendChild(surfaceHost);
    const dispose = render(() => <TerminalPanel variant="workbench" workbenchSelected />, surfaceHost);

    try {
      await settleTerminalPanel();
      const row = surfaceHost.querySelector<HTMLButtonElement>('button[data-terminal-session-id="session-remote"]')!;
      await page.elementLocator(row).hover();
      await expect.poll(() => surfaceHost.querySelector('[role="tooltip"]')).toBeTruthy();

      let tooltip = surfaceHost.querySelector<HTMLElement>('[role="tooltip"]')!;
      expect(tooltip.textContent).toContain('root@build-runner-with-a-very-long-hostname.example.internal');
      expect(tooltip.textContent).toContain('/srv/repositories/redeven/feature/terminal-context');
      expect(tooltip.closest('[data-floe-dialog-surface-host="true"]')).toBe(surfaceHost);
      expect(tooltip.getAttribute('data-floe-local-interaction-surface')).toBe('true');

      await page.elementLocator(surfaceHost.querySelector<HTMLElement>('[data-testid="terminal-content"]')!).hover();
      await expect.poll(() => surfaceHost.querySelector('[role="tooltip"]')).toBeNull();

      row.focus();
      await expect.poll(() => surfaceHost.querySelector('[role="tooltip"]')).toBeTruthy();
      tooltip = surfaceHost.querySelector<HTMLElement>('[role="tooltip"]')!;
      expect(tooltip.getAttribute('data-floe-local-interaction-surface')).toBe('true');
      await userEvent.keyboard('{Escape}');
      expect(tooltip.getAttribute('aria-hidden')).toBe('true');
      await expect.poll(() => surfaceHost.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      dispose();
      surfaceHost.remove();
    }
  });

  it('uses deterministic desktop and mobile slots and an inert unselected Workbench notice', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    transportAttachState.effectiveCols = 60;
    transportAttachState.effectiveRows = 20;
    const host = document.createElement('div');
    host.style.cssText = 'width:800px;height:500px;';
    host.setAttribute('data-floe-dialog-surface-host', 'true');
    document.body.appendChild(host);
    const [workbenchSelected, setWorkbenchSelected] = createSignal(false);
    host.addEventListener('pointerdown', () => setWorkbenchSelected(true));
    const disposeDesktop = render(() => (
      <TerminalPanel variant="workbench" workbenchSelected={workbenchSelected()} />
    ), host);

    await expect.poll(() => host.querySelector('[data-terminal-shared-geometry-inert="true"]')).toBeTruthy();
    const desktopNotice = host.querySelector<HTMLElement>('[data-testid="terminal-shared-geometry-status-notice"]')!;
    expect(host.querySelector('button[aria-expanded]')).toBeNull();
    expect(getComputedStyle(desktopNotice).width).toBe('184px');
    terminalCoreState.instances[0]?.focus.mockClear();
    await userEvent.click(desktopNotice);
    await settleTerminalPanel();
    expect(workbenchSelected()).toBe(true);
    expect(host.querySelector('[data-floe-surface-floating-layer="true"]')).toBeNull();
    expect(terminalCoreState.instances[0]?.focus).not.toHaveBeenCalled();

    const selectedTrigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    selectedTrigger.click();
    await expect.poll(() => host.querySelector('[data-floe-surface-floating-layer="true"]')).toBeTruthy();
    selectedTrigger.click();
    setWorkbenchSelected(false);
    await settleTerminalPanel();
    expect(host.querySelector('[data-terminal-shared-geometry-inert="true"]')).toBeTruthy();

    host.style.width = '600px';
    await settleTerminalPanel();
    expect(getComputedStyle(desktopNotice).width).toBe('104px');
    expect(getComputedStyle(desktopNotice.querySelector('.terminal-shared-geometry-notice__short')!).display).not.toBe('none');
    expect(getComputedStyle(host.querySelector('.terminal-shared-geometry-history')!).display).toBe('none');

    host.style.width = '400px';
    await settleTerminalPanel();
    expect(getComputedStyle(desktopNotice).width).toBe('28px');
    expect(getComputedStyle(desktopNotice.querySelector('.terminal-shared-geometry-notice__short')!).display).toBe('none');
    terminalCoreState.instances[0]?.handlers.onError?.(new Error('renderer failed'));
    await settleTerminalPanel();
    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.getAttribute('data-terminal-runtime-state')).toBe('blocking');
    expect(getComputedStyle(host.querySelector('.terminal-shared-geometry-history')!).display).toBe('none');
    disposeDesktop();
    host.replaceChildren();
    terminalCoreState.instances = [];
    layoutState.mobile = true;
    host.style.width = '390px';
    const disposeMobile = render(() => <TerminalPanel variant="workbench" />, host);

    await expect.poll(() => host.querySelector('[data-testid="terminal-shared-geometry-mobile-notice"]')).toBeTruthy();
    const mobileNotice = host.querySelector<HTMLElement>('[data-testid="terminal-shared-geometry-mobile-notice"]')!;
    expect(getComputedStyle(mobileNotice).width).toBe('96px');
    expect(getComputedStyle(mobileNotice.querySelector('.terminal-shared-geometry-notice__trigger')!).height).toBe('36px');
    host.style.width = '340px';
    await settleTerminalPanel();
    expect(getComputedStyle(mobileNotice).width).toBe('60px');
    host.style.width = '300px';
    await settleTerminalPanel();
    expect(getComputedStyle(mobileNotice).width).toBe('36px');
    disposeMobile();
  });

  it('applies shared geometry exactly between the output sequences around its boundary', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();
    const core = terminalCoreState.instances[0]!;
    expect(core.config.responsive.reportHostDimensionsWithFixedGrid).toBe(true);
    core.setFixedDimensions.mockClear();

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
    let releaseAttach!: (result: {
      historyBoundarySequence: number;
      historyGeneration: number;
      historyStartSequence: number;
      geometryGeneration: number;
      runtimeAttachGeneration: number;
      cols: number;
      rows: number;
    }) => void;
    const attachResult = new Promise<Parameters<typeof releaseAttach>[0]>((resolve) => {
      releaseAttach = resolve;
    });
    transportMocks.attachWithHistoryBoundary.mockReturnValueOnce(attachResult);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await expect.poll(() => transportMocks.attachWithHistoryBoundary.mock.calls.length).toBe(1);

    emitTerminalData('session-1', 'attach-rtt-live', 1);
    releaseAttach({
      historyBoundarySequence: 0,
      historyGeneration: 1,
      historyStartSequence: 0,
      geometryGeneration: 1,
      runtimeAttachGeneration: 1,
      cols: 80,
      rows: 24,
    });

    await expect.poll(() => (
      terminalCoreState.instances[0]?.write.mock.calls.map((call) => decodeTerminalWrite(call[0])) ?? []
    )).toEqual(['attach-rtt-live']);
    expect(transportMocks.historyPage).not.toHaveBeenCalled();
  });

  it('keeps an older attach candidate in the renderer queue when a newer geometry event arrives first', async () => {
    terminalSessionsState.sessions = [terminalSessionsState.sessions[0]!];
    let releaseAttach!: (result: TerminalLiveAttachResult) => void;
    transportMocks.attachWithHistoryBoundary.mockReturnValueOnce(new Promise<TerminalLiveAttachResult>((resolve) => {
      releaseAttach = resolve;
    }));
    transportMocks.historyPage.mockResolvedValueOnce(withHistoryContract({
      chunks: [{ sequence: 4, timestampMs: 4, data: textEncoder.encode('history-4') }],
      nextStartSeq: 5,
      hasMore: false,
      firstSequence: 1,
      lastSequence: 4,
      coveredThroughSequence: 4,
      snapshotEndSequence: 4,
      firstRetainedSequence: 1,
      coveredBytes: 9,
      totalBytes: 9,
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="panel" />, host);
    await expect.poll(() => transportMocks.attachWithHistoryBoundary.mock.calls.length).toBe(1);

    emitTerminalGeometry('session-1', 3, 8, 60, 20);
    releaseAttach({
      historyBoundarySequence: 4,
      historyGeneration: 1,
      historyStartSequence: 1,
      geometryGeneration: 2,
      runtimeAttachGeneration: 1,
      cols: 70,
      rows: 22,
    });
    await expect.poll(() => terminalCoreState.instances[0]?.setFixedDimensions.mock.calls.length ?? 0).toBeGreaterThanOrEqual(1);
    for (let sequence = 5; sequence <= 9; sequence += 1) {
      emitTerminalData('session-1', `live-${sequence}`, sequence);
    }
    await settleTerminalPanel();

    const core = terminalCoreState.instances[0]!;
    const intermediateCall = core.setFixedDimensions.mock.calls.findIndex(([size]) => size.cols === 70 && size.rows === 22);
    const latestCall = core.setFixedDimensions.mock.calls.findIndex(([size]) => size.cols === 60 && size.rows === 20);
    expect(intermediateCall).toBeGreaterThanOrEqual(0);
    expect(latestCall).toBeGreaterThan(intermediateCall);
    const writes = core.write.mock.calls.map((call) => decodeTerminalWrite(call[0]));
    const throughBoundary = writes.findIndex((value) => value.includes('live-8'));
    const afterBoundary = writes.findIndex((value) => value.includes('live-9'));
    expect(core.setFixedDimensions.mock.invocationCallOrder[intermediateCall]).toBeLessThan(
      core.write.mock.invocationCallOrder[throughBoundary]!,
    );
    expect(core.write.mock.invocationCallOrder[throughBoundary]).toBeLessThan(
      core.setFixedDimensions.mock.invocationCallOrder[latestCall]!,
    );
    expect(core.setFixedDimensions.mock.invocationCallOrder[latestCall]).toBeLessThan(
      core.write.mock.invocationCallOrder[afterBoundary]!,
    );
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
    expect(findTerminalTabStatus(host, 'Terminal 2', 'spinner')).toBeNull();
  });

  it('shows a confirmed ordinary program title without a spinner, then restores the directory on idle', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    publishTerminalForegroundCommand('session-2', {
      phase: 'running', displayName: 'top', revision: 1, updatedAtMs: 10,
    });
    expect(findTerminalTabStatus(host, 'Terminal 2', 'spinner')).toBeNull();
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'spinner')).toBeNull();
    expect(host.querySelector('[data-terminal-session-title="session-2"]')?.textContent).toBe('top');
    expect(host.querySelector('[data-testid="terminal-session-path-session-2"]')?.textContent).toBe('/workspace/repo');

    publishTerminalForegroundCommand('session-2', {
      phase: 'idle', displayName: '', revision: 2, updatedAtMs: 20,
    });
    await settleTerminalPanel();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'spinner')).toBeNull();
    expect(host.querySelector('[data-terminal-session-title="session-2"]')?.textContent).toBe('repo');
  });

  it('settles a continuously revised SSH opening indicator at the shared deadline', async () => {
    const observedAtMs = Date.now();
    const openingContext = {
      location: {
        kind: 'remote', phase: 'opening', label: 'udesk', authority: '', workingDirectory: '', source: 'foreground_candidate',
      },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 1,
      updatedAtMs: observedAtMs,
    };
    const [openingSessions, setOpeningSessions] = createSignal([{
      id: 'session-ssh-opening',
      name: 'SSH',
      workingDir: '',
      createdAtMs: observedAtMs,
      isActive: true,
      lastActiveAtMs: observedAtMs,
      executionContext: openingContext,
    }]);
    const catalog = {
      sessions: openingSessions,
      hydrated: () => true,
      loading: () => false,
      stale: () => false,
      error: () => null,
      permissionDenied: () => false,
      connectionEpoch: () => 1,
      remoteOpeningObservedAtMs: () => observedAtMs,
      coordinator: () => sessionsCoordinatorMocks,
      getCoordinator: () => sessionsCoordinatorMocks,
      refresh: sessionsCoordinatorMocks.refresh,
      upsertSession: vi.fn(),
      removeSession: vi.fn(),
      updateSessionMeta: vi.fn(),
      clearForPermissionDenied: vi.fn(),
      requestPreparedHistory: vi.fn().mockResolvedValue(null),
      startHistoryWarmup: vi.fn(),
      invalidateHistory: vi.fn(),
      setSurfaceActive: vi.fn(),
    } as any;
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TerminalSessionCatalogContext.Provider value={catalog}>
        <TerminalPanel variant="workbench" />
      </TerminalSessionCatalogContext.Provider>
    ), host);
    await settleTerminalPanel();
    expect(host.querySelector('[data-terminal-transition-indicator="spinner"]')).not.toBeNull();

    let revision = 1;
    while (Date.now() - observedAtMs < 900) {
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      revision += 1;
      setOpeningSessions((sessions) => sessions.map((session) => ({
        ...session,
        executionContext: {
          ...openingContext,
          revision,
          updatedAtMs: Date.now(),
        },
      })));
      await settleTerminalPanel();
    }

    const row = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="session-ssh-opening"]');
    const descriptionId = row?.getAttribute('aria-describedby') ?? '';
    expect(host.querySelector('[data-terminal-transition-indicator="spinner"]')).toBeNull();
    expect(host.querySelector('[data-terminal-session-title="session-ssh-opening"]')?.textContent).toBe('udesk');
    expect(host.querySelector('[data-terminal-session-avatar="session-ssh-opening"] svg')).not.toBeNull();
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('Connecting to SSH');
  });

  it('renders audited agent identity and keeps semantic work stable when raw output settles', async () => {
    await mediaCommands.installTerminalAgentIconRoutes();
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    publishTerminalExecutionContext('session-2', {
      location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', workingDirectory: '/root', source: 'osc7' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 1,
      updatedAtMs: 9,
    });
    await settleTerminalPanel();
    const linkScreenshot = await mediaCommands.inspectTerminalAvatarScreenshot('session-2');
    expect([linkScreenshot.avatarWidth, linkScreenshot.avatarHeight]).toEqual([36, 36]);
    expect([linkScreenshot.markWidth, linkScreenshot.markHeight]).toEqual([16, 16]);
    expect(linkScreenshot.paintedPixels).toBeGreaterThan(0);

    publishTerminalForegroundCommand('session-2', {
      phase: 'running', displayName: 'codex', revision: 1, updatedAtMs: 10,
    });
    publishTerminalOutputActivity('session-2', {
      phase: 'streaming', revision: 1, updatedAtMs: 11,
    });
    publishTerminalExecutionContext('session-2', {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/workspace/repo', source: 'shell_integration' },
      application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
      revision: 1,
      updatedAtMs: 10,
    });
    publishTerminalWorkState('session-2', {
      phase: 'working', source: 'semantic', contextRevision: 1, foregroundCommandRevision: 1, revision: 1, updatedAtMs: 11,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    await settleTerminalPanel();

    const identity = host.querySelector<HTMLElement>('[data-terminal-agent-identity="codex"]');
    const slot = host.querySelector<HTMLElement>('[data-terminal-output-slot="session-2"]');
    expect(identity).not.toBeNull();
    const identityStyle = getComputedStyle(identity!);
    expect([identity!.getBoundingClientRect().width, identity!.getBoundingClientRect().height]).toEqual([36, 36]);
    expect(parseFloat(identityStyle.borderRadius)).toBeGreaterThanOrEqual(identity!.getBoundingClientRect().width / 2);
    const codexMark = identity!.querySelector<HTMLElement>('.bg-current')!;
    expect(getComputedStyle(codexMark).webkitMaskImage).toContain('/_redeven_proxy/env/agent-cli-icons/codex.svg');
    expect([codexMark.getBoundingClientRect().width, codexMark.getBoundingClientRect().height]).toEqual([21, 21]);
    const codexScreenshot = await mediaCommands.inspectTerminalAvatarScreenshot('session-2');
    expect([codexScreenshot.avatarWidth, codexScreenshot.avatarHeight]).toEqual([36, 36]);
    expect([codexScreenshot.markWidth, codexScreenshot.markHeight]).toEqual([21, 21]);
    expect(codexScreenshot.paintedPixels).toBeGreaterThan(0);
    expect(codexScreenshot.distinctColorBuckets).toBeGreaterThan(1);
    expect(codexScreenshot.screenshotHash).not.toBe(linkScreenshot.screenshotHash);
    expect(host.querySelector('[data-terminal-output-state="streaming"]')).not.toBeNull();
    expect(identity?.querySelector('[data-terminal-transition-indicator="spinner"]')).toBeNull();
    const before = slot!.getBoundingClientRect();

    publishTerminalOutputActivity('session-2', {
      phase: 'settled', revision: 2, updatedAtMs: 20,
    });
    await settleTerminalPanel();
    const after = slot!.getBoundingClientRect();
    expect(host.querySelector('[data-terminal-output-state="streaming"]')).not.toBeNull();
    expect([after.width, after.height]).toEqual([before.width, before.height]);

    publishTerminalForegroundCommand('session-2', {
      phase: 'running', displayName: 'claude', revision: 2, updatedAtMs: 30,
    });
    publishTerminalExecutionContext('session-2', {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/workspace/repo', source: 'shell_integration' },
      application: { kind: 'agent_cli', identity: 'claude', displayName: 'Claude Code' },
      revision: 2,
      updatedAtMs: 30,
    });
    publishTerminalWorkState('session-2', {
      phase: 'working', source: 'semantic', contextRevision: 2, foregroundCommandRevision: 2, revision: 2, updatedAtMs: 30,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    await settleTerminalPanel();
    const claudeIdentity = host.querySelector<HTMLElement>('[data-terminal-agent-identity="claude"]')!;
    const claudeIcon = claudeIdentity.querySelector<HTMLImageElement>('img')!;
    expect([claudeIdentity.getBoundingClientRect().width, claudeIdentity.getBoundingClientRect().height]).toEqual([36, 36]);
    expect([claudeIcon.getBoundingClientRect().width, claudeIcon.getBoundingClientRect().height]).toEqual([20, 20]);
    expect(new URL(claudeIcon.src).pathname).toBe('/_redeven_proxy/env/agent-cli-icons/claude.svg');
    const claudeScreenshot = await mediaCommands.inspectTerminalAvatarScreenshot('session-2');
    expect([claudeScreenshot.avatarWidth, claudeScreenshot.avatarHeight]).toEqual([36, 36]);
    expect([claudeScreenshot.markWidth, claudeScreenshot.markHeight]).toEqual([20, 20]);
    expect(claudeScreenshot.paintedPixels).toBeGreaterThan(0);
    expect(claudeScreenshot.distinctColorBuckets).toBeGreaterThan(1);
    expect(claudeScreenshot.screenshotHash).not.toBe(codexScreenshot.screenshotHash);
    const agentCoverageRatio = codexScreenshot.paintedPixels / claudeScreenshot.paintedPixels;
    expect(agentCoverageRatio).toBeGreaterThanOrEqual(0.8);
    expect(agentCoverageRatio).toBeLessThanOrEqual(1.4);

    publishTerminalForegroundCommand('session-2', {
      phase: 'running', displayName: 'pi', revision: 3, updatedAtMs: 40,
    });
    publishTerminalExecutionContext('session-2', {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/workspace/repo', source: 'shell_integration' },
      application: { kind: 'agent_cli', identity: 'pi', displayName: 'Pi' },
      revision: 3,
      updatedAtMs: 40,
    });
    publishTerminalWorkState('session-2', {
      phase: 'idle', source: 'semantic', contextRevision: 3, foregroundCommandRevision: 3, revision: 3, updatedAtMs: 40,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    await settleTerminalPanel();

    const piIdentity = host.querySelector<HTMLElement>('[data-terminal-agent-identity="pi"]')!;
    const piMark = piIdentity.querySelector<HTMLElement>('.bg-current')!;
    expect([piIdentity.getBoundingClientRect().width, piIdentity.getBoundingClientRect().height]).toEqual([36, 36]);
    expect([piMark.getBoundingClientRect().width, piMark.getBoundingClientRect().height]).toEqual([20, 20]);
    expect(getComputedStyle(piMark).webkitMaskImage).toContain('/_redeven_proxy/env/agent-cli-icons/pi.svg');
    const piScreenshot = await mediaCommands.inspectTerminalAvatarScreenshot('session-2');
    expect(piScreenshot.paintedPixels).toBeGreaterThan(0);
    expect(piScreenshot.screenshotHash).not.toBe(claudeScreenshot.screenshotHash);
  });

  it('aligns identity, two-line content, and the fixed action rail on one session-row grid', async () => {
    terminalSessionsState.sessions = terminalSessionsState.sessions.map((session) => (
      session.id === 'session-2'
        ? {
            ...session,
            workingDir: `/workspace/${'deeply-nested-directory/'.repeat(8)}redeven`,
            localPathCapability: { workingDir: `/workspace/${'deeply-nested-directory/'.repeat(8)}redeven` },
          }
        : session
    ));
    const host = document.createElement('div');
    host.style.width = '420px';
    host.style.height = '640px';
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const row = host.querySelector<HTMLElement>('[data-terminal-session-row="session-2"]')!;
    const avatar = host.querySelector<HTMLElement>('[data-terminal-session-avatar="session-2"]')!;
    const content = host.querySelector<HTMLElement>('[data-terminal-session-content="session-2"]')!;
    const title = host.querySelector<HTMLElement>('[data-terminal-session-title="session-2"]')!;
    const grid = host.querySelector<HTMLElement>('[data-terminal-session-actions="session-2"]')!;
    const cell = (name: string) => grid.querySelector<HTMLElement>(`[data-terminal-session-action-cell="${name}"]`)!.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const avatarRect = avatar.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const indexRect = cell('index');
    const closeRect = cell('close');
    const copyRect = cell('copy');
    const filesRect = cell('files');
    const pathRect = host.querySelector<HTMLElement>('[data-terminal-session-path="session-2"]')!.getBoundingClientRect();
    const verticalCenter = (rect: DOMRect) => rect.top + rect.height / 2;

    expect(getComputedStyle(row).display).toBe('grid');
    expect(getComputedStyle(grid).position).not.toBe('absolute');
    expect(rowRect.height).toBe(64);
    expect(Math.abs(verticalCenter(avatarRect) - verticalCenter(rowRect))).toBeLessThanOrEqual(1);
    expect(Math.abs(verticalCenter(contentRect) - verticalCenter(rowRect))).toBeLessThanOrEqual(1);
    expect(Math.abs(verticalCenter(gridRect) - verticalCenter(rowRect))).toBeLessThanOrEqual(1);
    expect(Math.abs(titleRect.left - pathRect.left)).toBeLessThanOrEqual(1);
    expect(avatarRect.right).toBeLessThanOrEqual(contentRect.left - 8);
    expect(contentRect.right).toBeLessThanOrEqual(gridRect.left - 8);
    expect(gridRect.right).toBeLessThanOrEqual(rowRect.right - 8);
    expect([indexRect.width, indexRect.height]).toEqual([20, 20]);
    expect([closeRect.width, closeRect.height]).toEqual([20, 20]);
    expect([copyRect.width, copyRect.height]).toEqual([20, 20]);
    expect([filesRect.width, filesRect.height]).toEqual([20, 20]);
    expect(Math.abs(indexRect.left - copyRect.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(closeRect.left - filesRect.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(indexRect.top - closeRect.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(copyRect.top - filesRect.top)).toBeLessThanOrEqual(1);
    expect(indexRect.right).toBeLessThanOrEqual(closeRect.left);
    expect(indexRect.bottom).toBeLessThanOrEqual(copyRect.top);
    expect(pathRect.right).toBeLessThanOrEqual(gridRect.left - 8);
    const closeButton = host.querySelector<HTMLElement>('[data-testid="close-session-session-2"]')!;
    const filesButton = host.querySelector<HTMLElement>('[data-testid="terminal-session-files-session-2"]')!;
    expect(getComputedStyle(closeButton).opacity).toBe('0');
    expect(getComputedStyle(closeButton).pointerEvents).toBe('none');
    closeButton.focus();
    expect(document.activeElement).toBe(closeButton);
    expect(closeButton.matches(':focus')).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(getComputedStyle(closeButton).opacity).toBe('1');
    expect(getComputedStyle(closeButton).pointerEvents).toBe('auto');
    filesButton.focus();
    expect(getComputedStyle(filesButton).opacity).toBe('1');
    expect(getComputedStyle(filesButton).pointerEvents).toBe('auto');
  });

  it('paints idle unread Agent attention as a stable dot until the session is viewed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    await page.elementLocator(findTerminalTab(host, 'Terminal 2')!).click();
    await vi.waitFor(() => expect(terminalCoreState.instances).toHaveLength(2));
    await page.elementLocator(findTerminalTab(host, 'Terminal 1')!).click();
    await settleTerminalPanel();

    publishTerminalForegroundCommand('session-2', {
      phase: 'running', displayName: 'codex', revision: 1, updatedAtMs: 10,
    });
    publishTerminalOutputActivity('session-2', {
      phase: 'streaming', revision: 1, updatedAtMs: 11,
    });
    publishTerminalExecutionContext('session-2', {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/workspace/repo', source: 'shell_integration' },
      application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
      revision: 1,
      updatedAtMs: 10,
    });
    publishTerminalWorkState('session-2', {
      phase: 'working', source: 'semantic', contextRevision: 1, foregroundCommandRevision: 1, revision: 1, updatedAtMs: 11,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    await settleTerminalPanel();

    const slot = host.querySelector<HTMLElement>('[data-terminal-output-slot="session-2"]')!;
    const slotBefore = slot.getBoundingClientRect();
    terminalCoreState.instances[1]?.emitBell();
    publishTerminalOutputActivity('session-2', {
      phase: 'settled', revision: 2, updatedAtMs: 20,
    });
    publishTerminalWorkState('session-2', {
      phase: 'idle', source: 'semantic', contextRevision: 1, foregroundCommandRevision: 1, revision: 2, updatedAtMs: 20,
    });
    await settleTerminalPanel();

    const dot = host.querySelector<HTMLElement>('[data-terminal-attention-state="unread"]')!;
    const dotRect = dot.getBoundingClientRect();
    const dotStyle = getComputedStyle(dot);
    const slotUnread = slot.getBoundingClientRect();
    expect([dotRect.width, dotRect.height]).toEqual([6, 6]);
    expect(dotRect.left + dotRect.width / 2).toBeCloseTo(slotUnread.left + slotUnread.width / 2, 4);
    expect(dotRect.top + dotRect.height / 2).toBeCloseTo(slotUnread.top + slotUnread.height / 2, 4);
    expect(parseFloat(dotStyle.borderRadius)).toBeGreaterThanOrEqual(3);
    expect(dotStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect([slotUnread.width, slotUnread.height]).toEqual([slotBefore.width, slotBefore.height]);
    expect(host.querySelector('[data-terminal-transition-indicator="spinner"]')).toBeNull();
    expect(host.querySelector('[data-terminal-output-attention="unread"]')).toBeNull();

    await page.elementLocator(findTerminalTab(host, 'Terminal 2')!).click();
    await settleTerminalPanel();
    const slotRead = slot.getBoundingClientRect();
    expect(host.querySelector('[data-terminal-attention-state="unread"]')).toBeNull();
    expect(host.querySelector('[data-terminal-output-state]')).toBeNull();
    expect([slotRead.width, slotRead.height]).toEqual([slotBefore.width, slotBefore.height]);
    expect(host.querySelector('[data-terminal-agent-identity="codex"]')).not.toBeNull();
  });

  it('uses thesvg light and dark variants without filtering the official mark', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    publishTerminalForegroundCommand('session-2', {
      phase: 'running', displayName: 'cursor-agent', revision: 1, updatedAtMs: 10,
    });
    publishTerminalExecutionContext('session-2', {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/workspace/repo', source: 'shell_integration' },
      application: { kind: 'agent_cli', identity: 'cursor', displayName: 'Cursor' },
      revision: 1,
      updatedAtMs: 10,
    });
    publishTerminalWorkState('session-2', {
      phase: 'idle', source: 'semantic', contextRevision: 1, foregroundCommandRevision: 1, revision: 1, updatedAtMs: 10,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    await settleTerminalPanel();

    const identity = host.querySelector<HTMLElement>('[data-terminal-agent-identity="cursor"]')!;
    const lightIcon = identity.querySelector<HTMLImageElement>('img[src$="cursor-light.svg"]')!;
    const darkIcon = identity.querySelector<HTMLImageElement>('img[src$="cursor-dark.svg"]')!;
    expect(getComputedStyle(lightIcon).display).not.toBe('none');
    expect(getComputedStyle(darkIcon).display).toBe('none');
    expect(lightIcon.style.filter).toBe('');
    expect(darkIcon.style.filter).toBe('');

    document.documentElement.classList.add('dark');
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(getComputedStyle(lightIcon).display).toBe('none');
      expect(getComputedStyle(darkIcon).display).not.toBe('none');
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  it('keeps work and attention shapes distinct with reduced motion and forced colors', async () => {
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce', forcedColors: 'active' });
    try {
      const host = document.createElement('div');
      document.body.appendChild(host);
      render(() => <TerminalPanel variant="workbench" />, host);
      await settleTerminalPanel();

      await page.elementLocator(findTerminalTab(host, 'Terminal 2')!).click();
      await vi.waitFor(() => expect(terminalCoreState.instances).toHaveLength(2));
      await page.elementLocator(findTerminalTab(host, 'Terminal 1')!).click();
      await settleTerminalPanel();

      publishTerminalForegroundCommand('session-2', {
        phase: 'running', displayName: 'codex', revision: 1, updatedAtMs: 10,
      });
      publishTerminalOutputActivity('session-2', {
        phase: 'streaming', revision: 1, updatedAtMs: 11,
      });
      publishTerminalExecutionContext('session-2', {
        location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/workspace/repo', source: 'shell_integration' },
        application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
        revision: 1,
        updatedAtMs: 10,
      });
      publishTerminalWorkState('session-2', {
        phase: 'working', source: 'semantic', contextRevision: 1, foregroundCommandRevision: 1, revision: 1, updatedAtMs: 11,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 170));
      await settleTerminalPanel();

      const outputBar = host.querySelector<SVGRectElement>('.redeven-terminal-output-wave-bar')!;
      const trigger = host.querySelector<HTMLElement>('[data-terminal-output-trigger="session-2"]')!;
      expect(trigger.getAttribute('aria-label')).toBe('Working');
      expect(trigger.dataset.terminalActivitySource).toBe('semantic');
      expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
      expect(window.matchMedia('(forced-colors: active)').matches).toBe(true);
      expect(getComputedStyle(outputBar).animationName).toBe('none');
      expect(getComputedStyle(trigger).borderTopStyle).toBe('solid');
      expect(outputBar.getBoundingClientRect().height).toBeGreaterThan(0);

      publishTerminalOutputActivity('session-2', {
        phase: 'settled', revision: 2, updatedAtMs: 20,
      });
      publishTerminalWorkState('session-2', {
        phase: 'waiting_user', source: 'semantic', contextRevision: 1, foregroundCommandRevision: 1, revision: 2, updatedAtMs: 20,
      });
      await settleTerminalPanel();

      const attentionTrigger = host.querySelector<HTMLButtonElement>('[data-terminal-attention-trigger="session-2"]')!;
      const waitingDot = attentionTrigger.querySelector<HTMLElement>('[data-terminal-attention-state="waiting"]')!;
      expect(getComputedStyle(attentionTrigger).borderTopStyle).toBe('solid');
      expect([waitingDot.getBoundingClientRect().width, waitingDot.getBoundingClientRect().height]).toEqual([8, 8]);
      await page.elementLocator(attentionTrigger).click();
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('User input');
      await userEvent.keyboard('{Escape}');
      expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('aria-hidden') ?? 'true').toBe('true');
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

      terminalCoreState.instances[1]?.emitBell();
      publishTerminalWorkState('session-2', {
        phase: 'idle', source: 'semantic', contextRevision: 1, foregroundCommandRevision: 1, revision: 3, updatedAtMs: 21,
      });
      await settleTerminalPanel();

      const unreadDot = host.querySelector<HTMLElement>('[data-terminal-attention-state="unread"]')!;
      const unreadDotRect = unreadDot.getBoundingClientRect();
      const unreadDotStyle = getComputedStyle(unreadDot);
      expect([unreadDotRect.width, unreadDotRect.height]).toEqual([6, 6]);
      expect(unreadDotStyle.borderTopStyle).toBe('solid');
      expect(unreadDotStyle.animationName).toBe('none');
      expect(host.querySelector('[data-terminal-transition-indicator="spinner"]')).toBeNull();
    } finally {
      await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' });
    }
  });

  it('keeps session selection quiet while output help supports focus, Escape, and click toggle', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const outside = document.createElement('button');
    outside.type = 'button';
    document.body.appendChild(outside);
    const dispose = render(() => <TerminalPanel variant="workbench" />, host);

    try {
      await settleTerminalPanel();
      publishTerminalForegroundCommand('session-2', {
        phase: 'running', displayName: 'codex', revision: 1, updatedAtMs: 10,
      });
      publishTerminalOutputActivity('session-2', {
        phase: 'streaming', revision: 1, updatedAtMs: 11,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 170));
      await settleTerminalPanel();

      const row = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="session-2"]')!;
      await page.elementLocator(row).click();
      expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('aria-hidden') ?? 'true').toBe('true');

      const trigger = host.querySelector<HTMLButtonElement>('[data-terminal-output-trigger="session-2"]')!;
      trigger.focus();
      await settleTerminalPanel();
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Terminal output is active');

      await userEvent.keyboard('{Escape}');
      expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('aria-hidden')).toBe('true');
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

      await page.elementLocator(trigger).click();
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Terminal output is active');
      await page.elementLocator(trigger).click();
      expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('aria-hidden')).toBe('true');
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

      await page.elementLocator(trigger).click();
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Terminal output is active');
      outside.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        isPrimary: true,
        pointerType: 'touch',
      }));
      expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('aria-hidden')).toBe('true');
      expect(row.dataset.terminalSessionActive).toBe('true');
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      dispose();
      outside.remove();
    }
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
    expect(findTerminalTabStatus(host, 'Terminal 2', 'spinner')).toBeNull();

    terminal2TabBeforeSwitch?.click();
    await settleTerminalPanel();

    const terminal2TabAfterSwitch = findTerminalTab(host, 'Terminal 2');
    expect(terminal2TabAfterSwitch?.dataset.terminalSessionActive).toBe('true');
    expect(findTerminalTabStatus(host, 'Terminal 2', 'spinner')).toBeNull();
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

  it('handles macOS terminal search and session shortcuts from the real terminal textarea', async () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15',
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <TerminalPanel variant="workbench" />, host);

    try {
      await settleTerminalPanel();
      const terminalInput = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Terminal input"]');
      expect(terminalInput).toBeTruthy();

      const searchEvent = new KeyboardEvent('keydown', {
        key: 'f',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      terminalInput!.dispatchEvent(searchEvent);
      await settleTerminalPanel();

      const searchInput = host.querySelector<HTMLInputElement>('input[placeholder="Search..."]');
      expect(searchEvent.defaultPrevented).toBe(true);
      expect(searchInput).toBeTruthy();
      expect(document.activeElement).toBe(searchInput);

      const sessionEvent = new KeyboardEvent('keydown', {
        key: '2',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      terminalInput!.dispatchEvent(sessionEvent);
      await settleTerminalPanel();

      expect(sessionEvent.defaultPrevented).toBe(true);
      expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('true');
    } finally {
      dispose();
      host.remove();
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent,
      });
    }
  });

  it('executes terminal context-menu actions with wrapped keyboard navigation', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <TerminalPanel variant="workbench" />, host);

    try {
      await settleTerminalPanel();
      const terminalInput = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Terminal input"]');
      expect(terminalInput).toBeTruthy();

      terminalInput!.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ContextMenu',
        bubbles: true,
        cancelable: true,
      }));
      await settleTerminalPanel();
      expect(document.body.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Terminal');
      expect(document.activeElement?.textContent?.trim()).toBe('Ask Flower');

      await userEvent.keyboard('{ArrowUp}');
      expect(document.activeElement?.textContent?.trim()).toBe('Clear terminal content');
      await userEvent.keyboard('{Enter}');
      await vi.waitFor(() => {
        expect(transportMocks.clear).toHaveBeenCalledWith('session-1');
      });
      expect(document.body.querySelector('[role="menu"]')).toBeNull();

      await vi.waitFor(() => {
        expect(host.querySelector('textarea[aria-label="Terminal input"]')).toBeTruthy();
      });
      const currentInput = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Terminal input"]');
      currentInput!.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ContextMenu',
        bubbles: true,
        cancelable: true,
      }));
      await settleTerminalPanel();
      expect(document.activeElement?.textContent?.trim()).toBe('Ask Flower');
      await userEvent.keyboard(' ');
      await vi.waitFor(() => {
        expect(document.body.querySelector('[role="menu"]')).toBeNull();
      });
    } finally {
      dispose();
      host.remove();
    }
  });

  it('opens Ask Flower without local path metadata while SSH Files remains disabled', async () => {
    terminalSessionsState.sessions = [{
      id: 'session-ssh',
      name: 'SSH',
      workingDir: '/root/project',
      createdAtMs: 1,
      isActive: true,
      lastActiveAtMs: 10,
      executionContext: {
        location: {
          kind: 'remote',
          phase: 'ready',
          label: 'root@host',
          authority: 'host',
          workingDirectory: '/root/project',
          source: 'osc7',
        },
        application: { kind: 'shell', identity: '', displayName: '' },
        revision: 1,
        updatedAtMs: 10,
      },
    }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <TerminalPanel variant="workbench" />, host);

    try {
      await settleTerminalPanel();
      const filesSlot = host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-files-session-ssh"]');
      expect(filesSlot).toBeTruthy();
      expect(filesSlot?.dataset.terminalFilesAvailability).toBe('remote');
      expect(filesSlot?.getAttribute('aria-disabled')).toBe('true');

      const terminalInput = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Terminal input"]');
      expect(terminalInput).toBeTruthy();
      terminalInput?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ContextMenu',
        bubbles: true,
        cancelable: true,
      }));
      await settleTerminalPanel();

      const menu = document.body.querySelector<HTMLElement>('[role="menu"]');
      const askFlowerButton = menu?.querySelector<HTMLButtonElement>('[data-floating-menu-item-id="ask-flower"]');
      const browseFilesButton = menu?.querySelector<HTMLButtonElement>('[data-floating-menu-item-id="browse-files"]');
      expect(askFlowerButton?.getAttribute('aria-disabled')).not.toBe('true');
      expect(browseFilesButton?.getAttribute('aria-disabled')).toBe('true');

      await page.elementLocator(askFlowerButton!).click();
      await vi.waitFor(() => {
        expect(envContextMocks.openFlowerTurnLauncher).toHaveBeenCalledTimes(1);
      });
      const serializedIntent = JSON.stringify(envContextMocks.openFlowerTurnLauncher.mock.calls[0]?.[0]);
      expect(serializedIntent).not.toContain('working_dir');
      expect(serializedIntent).not.toContain('suggested_working_dir');
      expect(envContextMocks.openFileBrowserAtPath).not.toHaveBeenCalled();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('preserves browser focus order when a floating context menu closes on Tab', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let setMenuOpen = (_open: boolean) => undefined;
    let menuTrigger: HTMLButtonElement | undefined;
    const TestIcon = () => <span />;
    const dispose = render(() => {
      const [menuOpen, setOpen] = createSignal(true);
      setMenuOpen = setOpen;
      return (
        <div data-floe-dialog-surface-host="true">
          <button type="button" data-testid="focus-before-menu">Before menu</button>
          <button ref={menuTrigger} type="button" data-testid="menu-trigger">Menu trigger</button>
          <Show when={menuOpen()}>
            <FloatingContextMenu
              x={20}
              y={20}
              ariaLabel="Test actions"
              focusAnchor={menuTrigger}
              items={[{
                id: 'test-action',
                kind: 'action',
                label: 'Test action',
                icon: TestIcon,
                onSelect: () => undefined,
              }]}
              onDismiss={() => setOpen(false)}
            />
          </Show>
          <button type="button" data-testid="focus-after-menu">After menu</button>
        </div>
      );
    }, host);

    try {
      await settleTerminalPanel();
      expect(document.activeElement?.textContent?.trim()).toBe('Test action');
      await userEvent.tab();
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(host.querySelector('[data-testid="focus-after-menu"]'));

      setMenuOpen(true);
      await settleTerminalPanel();
      expect(document.activeElement?.textContent?.trim()).toBe('Test action');
      await userEvent.tab({ shift: true });
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(host.querySelector('[data-testid="focus-before-menu"]'));
    } finally {
      dispose();
      host.remove();
    }
  });

  it('uses the focusable session row as the mouse context-menu Tab anchor', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <TerminalPanel variant="workbench" />, host);

    try {
      await settleTerminalPanel();
      const row = findTerminalTab(host, 'Terminal 1') as HTMLButtonElement | undefined;
      const rowContainer = row?.parentElement;
      expect(row).toBeTruthy();
      expect(rowContainer).toBeTruthy();
      const focusableElements = Array.from(host.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const rowIndex = focusableElements.indexOf(row!);
      const beforeRow = focusableElements[rowIndex - 1];
      const afterRow = focusableElements[rowIndex + 1];
      expect(beforeRow).toBeTruthy();
      expect(afterRow).toBeTruthy();

      const openMouseMenu = async () => {
        rowContainer!.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 48,
          clientY: 64,
        }));
        await settleTerminalPanel();
        expect(document.activeElement?.textContent?.trim()).toBe('Ask Flower');
      };

      await openMouseMenu();
      await userEvent.tab();
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(afterRow);

      await openMouseMenu();
      await userEvent.tab({ shift: true });
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(beforeRow);
      expect(document.activeElement).not.toBe(row);
    } finally {
      dispose();
      host.remove();
    }
  });

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
      publishTerminalForegroundCommand('session-2', {
        phase: 'running', displayName: 'codex', revision: 20 + width, updatedAtMs: 20 + width,
      });
      publishTerminalOutputActivity('session-2', {
        phase: 'streaming', revision: 20 + width, updatedAtMs: 21 + width,
      });
      publishTerminalExecutionContext('session-2', {
        location: {
          kind: 'remote',
          phase: 'ready',
          label: 'root@build-runner-with-a-very-long-hostname.example.internal',
          authority: 'build-runner-with-a-very-long-hostname.example.internal',
          workingDirectory: '/srv/repositories/redeven/feature/terminal-context',
          source: 'osc7',
        },
        application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
        revision: 20 + width,
        updatedAtMs: 20 + width,
      });
      publishTerminalWorkState('session-2', {
        phase: 'working', source: 'semantic', contextRevision: 20 + width, foregroundCommandRevision: 20 + width,
        revision: 20 + width, updatedAtMs: 21 + width,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 170));
      await settleTerminalPanel();

      const hostRect = host.getBoundingClientRect();
      const contentRect = host.querySelector<HTMLElement>('[data-testid="terminal-content"]')?.getBoundingClientRect();
      expect(
        contentRect?.width ?? 0,
        `terminal content must remain visible: size=${width}x${height} transformed=${transformed} host=${JSON.stringify(hostRect.toJSON())} content=${JSON.stringify(contentRect?.toJSON())} sidebar=${JSON.stringify(host.querySelector<HTMLElement>('.redeven-terminal-session-sidebar')?.getBoundingClientRect().toJSON())}`,
      ).toBeGreaterThan(0);
      expect((contentRect?.right ?? 0) <= hostRect.right + 1).toBe(true);

      if (layoutState.mobile) {
        host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-drawer-open"]')?.click();
        await settleTerminalPanel();
        const drawer = host.querySelector<HTMLElement>('.redeven-terminal-session-sidebar');
        const drawerRect = drawer?.getBoundingClientRect();
        expect(drawerRect?.left ?? -1).toBeGreaterThanOrEqual(hostRect.left - 1);
        expect((drawerRect?.right ?? Number.POSITIVE_INFINITY) <= hostRect.right + 1).toBe(true);
        expect(
          drawerRect?.bottom ?? Number.POSITIVE_INFINITY,
          `drawer must fit host: drawer=${JSON.stringify(drawerRect?.toJSON())} host=${JSON.stringify(hostRect.toJSON())} class=${drawer?.className} style=${JSON.stringify(drawer ? {
            height: getComputedStyle(drawer).height,
            minHeight: getComputedStyle(drawer).minHeight,
            maxHeight: getComputedStyle(drawer).maxHeight,
            position: getComputedStyle(drawer).position,
            top: getComputedStyle(drawer).top,
            bottom: getComputedStyle(drawer).bottom,
          } : {})}`,
        ).toBeLessThanOrEqual(hostRect.bottom + 1);
        const titleRect = host.querySelector<HTMLElement>('[data-terminal-session-title="session-2"]')?.getBoundingClientRect();
        const attentionRect = host.querySelector<HTMLElement>('[data-terminal-attention-slot="session-2"]')?.getBoundingClientRect();
        expect((titleRect?.right ?? Number.POSITIVE_INFINITY) <= (attentionRect?.left ?? 0) + 1).toBe(true);
        const pathRect = host.querySelector<HTMLElement>('[data-terminal-session-path="session-2"]')?.getBoundingClientRect();
        const actionRailRect = host.querySelector<HTMLElement>('[data-terminal-session-actions="session-2"]')?.getBoundingClientRect();
        expect(
          (pathRect?.right ?? Number.POSITIVE_INFINITY) <= (actionRailRect?.left ?? 0),
          `mobile path must not overlap action rail: path=${JSON.stringify(pathRect?.toJSON())} rail=${JSON.stringify(actionRailRect?.toJSON())}`,
        ).toBe(true);
        const closeButton = host.querySelector<HTMLElement>('[data-testid="close-session-session-2"]');
        const filesButton = host.querySelector<HTMLElement>('[data-testid="terminal-session-files-session-2"]');
        expect(closeButton ? getComputedStyle(closeButton).opacity : null).toBe('1');
        expect(filesButton?.dataset.terminalFilesAvailability).toBe('remote');
        expect(filesButton?.getAttribute('aria-disabled')).toBe('true');
        expect(filesButton ? getComputedStyle(filesButton).opacity : null).toBe('1');

        findTerminalTab(host, 'Terminal 2')?.click();
        await settleTerminalPanel();
        const disclosure = host.querySelector<HTMLButtonElement>('[data-testid="terminal-active-context-disclosure"]');
        const disclosureRect = disclosure?.getBoundingClientRect();
        const activityRect = host.querySelector<HTMLElement>('[data-terminal-mobile-activity-slot]')?.getBoundingClientRect();
        expect(disclosure?.getAttribute('aria-label')).toContain('build-runner-with-a-very-long-hostname.example.internal');
        expect(
          (disclosureRect?.right ?? Number.POSITIVE_INFINITY) <= (activityRect?.left ?? 0) + 1,
          `mobile context must not overlap activity: disclosure=${JSON.stringify(disclosureRect?.toJSON())} activity=${JSON.stringify(activityRect?.toJSON())}`,
        ).toBe(true);
        disclosure?.click();
        await settleTerminalPanel();
        expect(document.body.querySelector('[role="tooltip"]')?.textContent)
          .toContain('root@build-runner-with-a-very-long-hostname.example.internal');

        host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-drawer-open"]')?.click();
        await settleTerminalPanel();
        findTerminalTab(host, 'Terminal 1')?.click();
        await settleTerminalPanel();
      }

      expect(host.querySelector('[data-terminal-agent-identity="codex"]')).not.toBeNull();
      expect(host.querySelector('[data-terminal-output-state="streaming"]')).not.toBeNull();

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
