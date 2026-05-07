// @vitest-environment jsdom

import { For, Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_INTERACTION_SURFACE_ATTR } from '@floegence/floe-webapp-core/ui';

import { TerminalPanel } from './TerminalPanel';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR } from '../workbench/surface/workbenchTextSelectionSurface';

const layoutState = vi.hoisted(() => ({
  mobile: false,
}));

const widgetState = vi.hoisted(() => ({
  currentWidgetId: null as string | null,
}));

const viewActivationState = vi.hoisted(() => ({
  missing: false,
  active: true,
}));

const themeState = vi.hoisted(() => ({
  resolvedTheme: 'dark' as 'light' | 'dark',
}));

const terminalPrefsState = vi.hoisted(() => ({
  userTheme: 'system',
  fontSize: 12,
  fontFamilyId: 'iosevka',
  mobileInputMode: 'floe' as 'floe' | 'system',
  workIndicatorEnabled: true,
}));

const focusSpy = vi.hoisted(() => vi.fn());
const forceResizeSpy = vi.hoisted(() => vi.fn());
const scrollLinesSpy = vi.hoisted(() => vi.fn());
const terminalInputSpy = vi.hoisted(() => vi.fn());
const terminalScrollState = vi.hoisted(() => ({
  alternateScreen: false,
  scrollbackLength: 200,
}));

const mobileKeyboardRectState = vi.hoisted(() => ({
  left: 0,
  top: 240,
  width: 320,
  height: 132,
}));

const mobileKeyboardTransitionState = vi.hoisted(() => ({
  lastVisible: true,
  visible: true,
  reopenReadPending: false,
}));

const terminalViewportRectState = vi.hoisted(() => ({
  left: 0,
  top: 24,
  width: 320,
  bottom: 320,
}));

const terminalSelectionState = vi.hoisted(() => ({
  text: '',
}));

const terminalConfigState = vi.hoisted(() => ({
  values: [] as any[],
}));

const terminalBufferLinesState = vi.hoisted(() => ({
  lines: new Map<number, string>(),
}));

const terminalCoreInstances = vi.hoisted(() => [] as any[]);

const notificationMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));

const writeTextToClipboardSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const openBrowserSpy = vi.hoisted(() => vi.fn(async () => undefined));
const openPreviewSpy = vi.hoisted(() => vi.fn(async () => undefined));
const openFileBrowserAtPathSpy = vi.hoisted(() => vi.fn(async () => undefined));
const terminalEnvPermissionsState = vi.hoisted(() => ({
  canRead: true,
  canExecute: true,
}));
const envContextState = vi.hoisted(() => ({
  viewMode: 'activity' as 'activity' | 'deck' | 'workbench',
}));

const rpcFsMocks = vi.hoisted(() => ({
  getPathContext: vi.fn().mockResolvedValue({ agentHomePathAbs: '/workspace' }),
  list: vi.fn().mockResolvedValue({
    entries: [
      {
        name: 'src',
        path: '/workspace/src',
        isDirectory: true,
        size: 0,
        modifiedAt: 0,
        createdAt: 0,
      },
      {
        name: 'README.md',
        path: '/workspace/README.md',
        isDirectory: false,
        size: 0,
        modifiedAt: 0,
        createdAt: 0,
      },
    ],
  }),
  readFile: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      scripts: {
        dev: 'vite',
        test: 'vitest run',
      },
    }),
  }),
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
    timestampMs?: number;
    echoOfInput?: boolean;
    originalSource?: string;
  }) => void>>(),
  nameHandlers: new Map<string, Set<(event: {
    sessionId: string;
    newName: string;
    workingDir: string;
  }) => void>>(),
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
  createSession: vi.fn(async (name?: string, workingDir?: string) => {
    const session = {
      id: 'session-2',
      name: String(name ?? '').trim() || 'Terminal 2',
      workingDir: String(workingDir ?? '').trim() || '/workspace',
      createdAtMs: 2,
      isActive: true,
      lastActiveAtMs: 20,
    };
    terminalSessionsState.sessions = [
      ...terminalSessionsState.sessions.map((entry) => ({ ...entry, isActive: false })),
      session,
    ];
    for (const subscriber of terminalSessionsState.subscribers) {
      subscriber(terminalSessionsState.sessions);
    }
    return session;
  }),
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

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  useCurrentWidgetId: () => widgetState.currentWidgetId,
  useLayout: () => ({
    isMobile: () => layoutState.mobile,
  }),
  useNotification: () => notificationMocks,
  useResolvedFloeConfig: () => ({
    persist: {
      load: (_key: string, fallback: any) => fallback,
      debouncedSave: vi.fn(),
    },
  }),
  useTheme: () => ({
    resolvedTheme: () => themeState.resolvedTheme,
  }),
  useViewActivation: () => {
    if (viewActivationState.missing) {
      throw new Error('ViewActivationContext not found. Wrap your view with <ViewActivationProvider />.');
    }
    return {
      id: 'test-view',
      active: () => viewActivationState.active,
      activationSeq: () => 0,
    };
  },
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Copy: Icon,
    Folder: Icon,
    Sparkles: Icon,
    Terminal: Icon,
    Trash: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (
    <Show when={props.visible}>
      <div>{props.message}</div>
    </Show>
  ),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  LOCAL_INTERACTION_SURFACE_ATTR: 'data-floe-local-interaction-surface',
  WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR: 'data-floe-workbench-widget-activation-surface',
  Button: (props: any) => (
    <button
      type="button"
      class={props.class}
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
  Checkbox: (props: any) => (
    <label>
      <input
        type="checkbox"
        checked={props.checked}
        aria-label={props.label}
        onChange={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).checked)}
      />
      {props.label}
    </label>
  ),
  Dropdown: (props: any) => (
    <div data-testid="dropdown">
      <div>{props.trigger}</div>
      <div>
        <For each={props.items}>
          {(item: any) => (
            item.separator ? (
              <div data-testid={`separator-${item.id}`} />
            ) : (
              <button type="button" data-testid={`dropdown-item-${item.id}`} onClick={() => props.onSelect(item.id)}>
                {item.label}
              </button>
            )
          )}
        </For>
      </div>
    </div>
  ),
  SurfaceFloatingLayer: (props: any) => {
    const { children, layerRef, position, class: className, style, ...rest } = props;
    return (
      <div
        ref={layerRef}
        class={className}
        style={{
          ...(style ?? {}),
          left: `${position?.x ?? 0}px`,
          top: `${position?.y ?? 0}px`,
        }}
        data-floe-local-interaction-surface="true"
        {...rest}
      >
        {children}
      </div>
    );
  },
  Input: (props: any) => (
    <input
      ref={props.ref}
      value={props.value}
      placeholder={props.placeholder}
      onInput={props.onInput}
    />
  ),
  NumberInput: (props: any) => (
    <input
      data-testid="number-input"
      value={props.value}
      onInput={(event) => props.onChange(Number((event.currentTarget as HTMLInputElement).value))}
    />
  ),
  MobileKeyboard: (props: any) => {
    if (props.visible && !mobileKeyboardTransitionState.lastVisible) {
      mobileKeyboardTransitionState.reopenReadPending = true;
    }
    mobileKeyboardTransitionState.visible = props.visible;
    mobileKeyboardTransitionState.lastVisible = props.visible;

    const viewportLeftPx = `${mobileKeyboardRectState.left}px`;
    const viewportBottomPx = '0px';
    const viewportWidthPx = `${mobileKeyboardRectState.width}px`;

    return (
      <div
        data-testid={props.visible ? 'mobile-keyboard' : undefined}
        aria-hidden={!props.visible}
        ref={(el) => {
          el.style.setProperty('--mobile-keyboard-viewport-left', viewportLeftPx);
          el.style.setProperty('--mobile-keyboard-viewport-bottom', viewportBottomPx);
          el.style.setProperty('--mobile-keyboard-viewport-width', viewportWidthPx);
          el.style.left = viewportLeftPx;
          el.style.bottom = viewportBottomPx;
          el.style.width = viewportWidthPx;
          Object.defineProperty(el, 'getBoundingClientRect', {
            configurable: true,
            value: () => {
              const hiddenTop = window.innerHeight;
              const hiddenBottom = hiddenTop + mobileKeyboardRectState.height;
              const useHiddenRect = !mobileKeyboardTransitionState.visible || mobileKeyboardTransitionState.reopenReadPending;
              if (mobileKeyboardTransitionState.visible && mobileKeyboardTransitionState.reopenReadPending) {
                mobileKeyboardTransitionState.reopenReadPending = false;
              }
              const top = useHiddenRect ? hiddenTop : mobileKeyboardRectState.top;
              const bottom = useHiddenRect ? hiddenBottom : mobileKeyboardRectState.top + mobileKeyboardRectState.height;
              return {
                width: mobileKeyboardRectState.width,
                height: mobileKeyboardRectState.height,
                top,
                left: mobileKeyboardRectState.left,
                right: mobileKeyboardRectState.left + mobileKeyboardRectState.width,
                bottom,
                x: mobileKeyboardRectState.left,
                y: top,
                toJSON: () => undefined,
              };
            },
          });
          props.ref?.(el);
        }}
      >
        <Show when={props.visible}>
          <>
            <button type="button" data-testid="mobile-keyboard-key" onClick={() => props.onKey?.('x')}>
              Send x
            </button>
            <button type="button" data-testid="mobile-keyboard-key-g" onClick={() => props.onKey?.('g')}>
              Send g
            </button>
            <button type="button" data-testid="mobile-keyboard-dismiss" onClick={() => props.onDismiss?.()}>
              Dismiss
            </button>
            {(props.suggestions ?? []).map((item: any) => (
              <button
                type="button"
                data-testid={`mobile-keyboard-suggestion-${item.label}`}
                onClick={() => props.onSuggestionSelect?.(item)}
              >
                {item.label}
              </button>
            ))}
          </>
        </Show>
      </div>
    );
  },
  Tabs: (props: any) => (
    <div>
      {props.items.map((item: any) => (
        <span>
          <button type="button" onClick={() => props.onChange?.(item.id)}>
            {item.icon}
            {item.label}
          </button>
          {props.closable ? (
            <button
              type="button"
              aria-label={`Close ${item.label}`}
              data-testid={`close-tab-${item.id}`}
              onClick={() => props.onClose?.(item.id)}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {props.showAdd ? <button type="button" onClick={props.onAdd}>Add</button> : null}
    </div>
  ),
  TabPanel: (props: any) => (props.active || props.keepMounted ? <div>{props.children}</div> : null),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div data-testid="dialog" class={props.class}>
        <div>{props.title}</div>
        <div>{props.description}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    </Show>
  ),
}));

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

vi.mock('@floegence/floeterm-terminal-web', () => {
  class MockTerminalCore {
    container: HTMLDivElement;
    config: any;
    handlers: any;
    registeredLinkProviders: any[] = [];
    terminal = {
      options: {},
      selectionManager: {
        isSelecting: false,
        boundMouseUpHandler: vi.fn(),
        stopAutoScroll: vi.fn(),
        selectionChangedEmitter: {
          fire: vi.fn(),
        },
      },
      scrollLines: scrollLinesSpy,
      getScrollbackLength: () => terminalScrollState.scrollbackLength,
      isAlternateScreen: () => terminalScrollState.alternateScreen,
      input: terminalInputSpy,
      buffer: {
        active: {
          getLine: (row: number) => {
            const value = terminalBufferLinesState.lines.get(row);
            if (typeof value !== 'string') {
              return null;
            }

            return {
              translateToString: () => value,
            };
          },
        },
      },
    };

    constructor(container: HTMLDivElement, config?: any, handlers?: any) {
      this.container = container;
      this.config = config ?? {};
      this.handlers = handlers ?? {};
      terminalConfigState.values.push(config ?? null);
      terminalCoreInstances.push(this);
      const input = document.createElement('textarea');
      input.setAttribute('aria-label', 'Terminal input');
      this.container.appendChild(input);
    }

    initialize = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn();
    setTheme = vi.fn();
    forceResize = forceResizeSpy;
    getDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
    setPresentationScale = vi.fn();
    setAppearance = vi.fn((appearance: {
      theme?: Record<string, unknown>;
      fontSize?: number;
      fontFamily?: string;
      presentationScale?: number;
    }) => {
      if (appearance.theme) {
        this.setTheme(appearance.theme);
      }
      if (typeof appearance.fontSize === 'number') {
        this.setFontSize(appearance.fontSize);
      }
      if (typeof appearance.fontFamily === 'string') {
        this.setFontFamily(appearance.fontFamily);
      }
      if (typeof appearance.presentationScale === 'number') {
        this.setPresentationScale(appearance.presentationScale);
      }
    });
    startHistoryReplay = vi.fn();
    endHistoryReplay = vi.fn();
    write = vi.fn();
    focus = vi.fn(() => {
      focusSpy();
      const responsive = this.config?.responsive ?? {};
      if ((responsive.fitOnFocus || responsive.emitResizeOnFocus) && typeof this.handlers?.onResize === 'function') {
        this.handlers.onResize({ cols: 80, rows: 24 });
      }
    });
    setFontSize = vi.fn();
    setFontFamily = vi.fn();
    registerLinkProvider = vi.fn((provider: unknown) => {
      this.registeredLinkProviders.push(provider);
    });
    setSearchResultsCallback = vi.fn();
    clearSearch = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
    clear = vi.fn();
    getSelectionText = vi.fn(() => terminalSelectionState.text);
    hasSelection = vi.fn(() => terminalSelectionState.text.length > 0);
    copySelection = vi.fn(async (source: 'shortcut' | 'command' | 'copy_event' = 'command') => {
      if (terminalSelectionState.text.length <= 0) {
        return {
          copied: false as const,
          reason: 'empty_selection' as const,
          source,
        };
      }

      return {
        copied: true as const,
        textLength: terminalSelectionState.text.length,
        source,
      };
    });
    emitBell = () => {
      this.handlers?.onBell?.();
    };
  }

  return {
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
        const next = terminalEventSourceState.dataHandlers.get(sessionId);
        next?.delete(handler);
      };
    },
    onTerminalNameUpdate: (sessionId: string, handler: any) => {
      const current = terminalEventSourceState.nameHandlers.get(sessionId) ?? new Set();
      current.add(handler);
      terminalEventSourceState.nameHandlers.set(sessionId, current);
      return () => {
        const next = terminalEventSourceState.nameHandlers.get(sessionId);
        next?.delete(handler);
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
    setUserTheme: (value: string) => {
      terminalPrefsState.userTheme = value;
    },
    setFontSize: (value: number) => {
      terminalPrefsState.fontSize = value;
    },
    setFontFamily: (value: string) => {
      terminalPrefsState.fontFamilyId = value;
    },
    setMobileInputMode: (value: 'floe' | 'system') => {
      terminalPrefsState.mobileInputMode = value;
    },
    setWorkIndicatorEnabled: (value: boolean) => {
      terminalPrefsState.workIndicatorEnabled = value;
    },
  }),
}));

vi.mock('../pages/EnvContext', () => {
  const envAccessor = Object.assign(
    () => ({
      permissions: {
        can_read: terminalEnvPermissionsState.canRead,
        can_execute: terminalEnvPermissionsState.canExecute,
      },
    }),
    { state: 'ready' },
  );

  return {
    useEnvContext: () => ({
      env: envAccessor,
      viewMode: () => envContextState.viewMode,
      openAskFlowerComposer: vi.fn(),
      openTerminalInDirectoryRequestSeq: () => 0,
      openTerminalInDirectoryRequest: () => null,
      openTerminalInDirectory: vi.fn(),
      openFileBrowserAtPath: openFileBrowserAtPathSpy,
      consumeOpenTerminalInDirectoryRequest: vi.fn(),
    }),
  };
});

vi.mock('./FileBrowserSurfaceContext', () => ({
  useFileBrowserSurfaceContext: () => ({
    controller: {
      open: () => false,
    },
    openBrowser: openBrowserSpy,
    closeBrowser: vi.fn(),
  }),
}));

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    controller: {
      openPreview: openPreviewSpy,
    },
    openPreview: openPreviewSpy,
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

vi.mock('../utils/askFlowerPath', () => ({
  normalizeAbsolutePath: (value: string) => value,
  expandHomeDisplayPath: (value: string) => value,
  toHomeDisplayPath: (value: string) => value,
  resolveSuggestedWorkingDirAbsolute: ({ suggestedWorkingDirAbs }: { suggestedWorkingDirAbs?: string | null }) => suggestedWorkingDirAbs ?? '',
}));

vi.mock('../utils/clipboard', () => ({
  writeTextToClipboard: writeTextToClipboardSpy,
}));

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type TestTerminalHistoryPage = {
  chunks: Array<{ sequence: number; timestampMs: number; data: Uint8Array }>;
  nextStartSeq: number;
  hasMore: boolean;
  firstSequence: number;
  lastSequence: number;
  coveredBytes: number;
  totalBytes: number;
};

function makeTerminalHistoryPage(overrides: Partial<TestTerminalHistoryPage> = {}): TestTerminalHistoryPage {
  return {
    chunks: [],
    nextStartSeq: 0,
    hasMore: false,
    firstSequence: 0,
    lastSequence: 0,
    coveredBytes: 0,
    totalBytes: 0,
    ...overrides,
  };
}

function decodeTerminalWrite(value: unknown): string {
  return value instanceof Uint8Array ? textDecoder.decode(value) : '';
}

async function settleTerminalPanelMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function settleTerminalPanel() {
  await settleTerminalPanelMicrotasks();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await settleTerminalPanelMicrotasks();
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

function publishTerminalSessions() {
  for (const subscriber of terminalSessionsState.subscribers) {
    subscriber(terminalSessionsState.sessions);
  }
}

function findTerminalTab(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as HTMLButtonElement | undefined;
}

function findTerminalTabs(host: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll('button')).filter((button) => button.textContent?.includes(label)) as HTMLButtonElement[];
}

function findTerminalTabStatus(host: HTMLElement, label: string, status: 'running' | 'unread' | 'none'): Element | null {
  return findTerminalTab(host, label)?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? null;
}

function findPendingTerminalTabStatus(host: HTMLElement, label: string, status: 'creating' | 'failed'): Element | null {
  return findTerminalTab(host, label)?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? null;
}

function findTerminalWorkIndicator(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.redeven-terminal-work-indicator');
}

describe('TerminalPanel', () => {
  beforeEach(() => {
    terminalPrefsState.userTheme = 'system';
    themeState.resolvedTheme = 'dark';
    terminalPrefsState.fontSize = 12;
    terminalPrefsState.fontFamilyId = 'iosevka';
    terminalPrefsState.mobileInputMode = 'floe';
    terminalPrefsState.workIndicatorEnabled = true;
    widgetState.currentWidgetId = null;
    viewActivationState.missing = false;
    viewActivationState.active = true;
    focusSpy.mockClear();
    forceResizeSpy.mockClear();
    scrollLinesSpy.mockClear();
    terminalInputSpy.mockClear();
    terminalScrollState.alternateScreen = false;
    terminalScrollState.scrollbackLength = 200;
    mobileKeyboardRectState.left = 0;
    mobileKeyboardRectState.top = 240;
    mobileKeyboardRectState.width = 320;
    mobileKeyboardRectState.height = 132;
    mobileKeyboardTransitionState.lastVisible = true;
    mobileKeyboardTransitionState.visible = true;
    mobileKeyboardTransitionState.reopenReadPending = false;
    terminalViewportRectState.left = 0;
    terminalViewportRectState.top = 24;
    terminalViewportRectState.width = 320;
    terminalViewportRectState.bottom = 320;
    envContextState.viewMode = 'activity';
    terminalEnvPermissionsState.canRead = true;
    terminalEnvPermissionsState.canExecute = true;
    terminalSelectionState.text = '';
    terminalConfigState.values = [];
    terminalBufferLinesState.lines = new Map();
    terminalCoreInstances.splice(0, terminalCoreInstances.length);
    terminalEventSourceState.dataHandlers = new Map();
    terminalEventSourceState.nameHandlers = new Map();
    notificationMocks.error.mockClear();
    notificationMocks.info.mockClear();
    notificationMocks.success.mockClear();
    writeTextToClipboardSpy.mockClear();
    openBrowserSpy.mockClear();
    openFileBrowserAtPathSpy.mockClear();
    openPreviewSpy.mockClear();
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 372,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320,
    });
    Object.values(transportMocks).forEach((mock) => {
      if ('mockClear' in mock) mock.mockClear();
    });
    transportMocks.sendInput.mockResolvedValue(undefined);
    transportMocks.resize.mockResolvedValue(undefined);
    transportMocks.attach.mockResolvedValue(undefined);
    transportMocks.history.mockResolvedValue([]);
    transportMocks.historyPage.mockResolvedValue({
      chunks: [],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 0,
      lastSequence: 0,
      coveredBytes: 0,
      totalBytes: 0,
    });
    transportMocks.getSessionStats.mockResolvedValue({ history: { totalBytes: 0 } });
    transportMocks.clear.mockResolvedValue(undefined);
    Object.values(rpcFsMocks).forEach((mock) => {
      if ('mockClear' in mock) mock.mockClear();
    });
    rpcFsMocks.getPathContext.mockResolvedValue({ agentHomePathAbs: '/workspace' });
    rpcFsMocks.list.mockResolvedValue({
      entries: [
        {
          name: 'src',
          path: '/workspace/src',
          isDirectory: true,
          size: 0,
          modifiedAt: 0,
          createdAt: 0,
        },
        {
          name: 'README.md',
          path: '/workspace/README.md',
          isDirectory: false,
          size: 0,
          modifiedAt: 0,
          createdAt: 0,
        },
      ],
    });
    rpcFsMocks.readFile.mockResolvedValue({
      content: JSON.stringify({
        scripts: {
          dev: 'vite',
          test: 'vitest run',
        },
      }),
    });
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
    ];
    terminalSessionsState.subscribers = [];
    sessionsCoordinatorMocks.refresh.mockClear();
    sessionsCoordinatorMocks.createSession.mockClear();
    sessionsCoordinatorMocks.deleteSession.mockClear();
    sessionsCoordinatorMocks.updateSessionMeta.mockClear();

    let nextAnimationFrameId = 0;
    const pendingAnimationFrames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextAnimationFrameId;
      pendingAnimationFrames.set(id, callback);
      queueMicrotask(() => {
        const pending = pendingAnimationFrames.get(id);
        if (!pending) return;
        pendingAnimationFrames.delete(id);
        pending(0);
      });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendingAnimationFrames.delete(id);
    });
    if (typeof PointerEvent === 'undefined') {
      class TestPointerEvent extends MouseEvent {
        pointerId: number;
        pointerType: string;
        isPrimary: boolean;

        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 1;
          this.pointerType = init.pointerType ?? '';
          this.isPrimary = init.isPrimary ?? true;
        }
      }

      vi.stubGlobal('PointerEvent', TestPointerEvent as unknown as typeof PointerEvent);
    }

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.style.getPropertyValue('--terminal-bottom-inset')) {
        return {
          top: terminalViewportRectState.top,
          bottom: terminalViewportRectState.bottom,
          left: terminalViewportRectState.left,
          right: terminalViewportRectState.left + terminalViewportRectState.width,
          width: terminalViewportRectState.width,
          height: terminalViewportRectState.bottom - terminalViewportRectState.top,
          x: terminalViewportRectState.left,
          y: terminalViewportRectState.top,
          toJSON: () => undefined,
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    layoutState.mobile = false;
    terminalEnvPermissionsState.canRead = true;
    terminalEnvPermissionsState.canExecute = true;
    vi.useRealTimers();
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
    vi.unstubAllGlobals();
  });

  it('shows a simplified More menu and opens terminal settings from it', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await Promise.resolve();
    await Promise.resolve();

    const searchAction = host.querySelector('[data-testid="dropdown-item-search"]') as HTMLButtonElement | null;
    const settingsAction = host.querySelector('[data-testid="dropdown-item-settings"]') as HTMLButtonElement | null;

    expect(searchAction).toBeTruthy();
    expect(settingsAction).toBeTruthy();
    expect(host.querySelector('[data-testid="dropdown-item-show_floe_keyboard"]')).toBeNull();
    expect(host.querySelector('[data-testid="dropdown-item-hide_floe_keyboard"]')).toBeNull();
    expect(host.querySelector('[data-testid="dropdown-item-use_floe_keyboard"]')).toBeNull();
    expect(host.querySelector('[data-testid="dropdown-item-use_system_ime"]')).toBeNull();
    expect(host.textContent).not.toContain('Theme:');
    expect(host.textContent).not.toContain('Font:');
    expect(host.textContent).not.toContain('System Theme');

    searchAction?.click();
    await Promise.resolve();
    expect(host.querySelector('input[placeholder="Search..."]')).toBeTruthy();

    settingsAction?.click();
    await Promise.resolve();
    expect(host.querySelector('[data-testid="dialog"]')).toBeTruthy();
    expect(host.textContent).toContain('Terminal settings');
  });

  it('falls back to an always-active view when ViewActivationContext is unavailable', async () => {
    viewActivationState.missing = true;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    expect(terminalCoreInstances.length).toBeGreaterThan(0);
    expect(host.textContent).toContain('Terminal 1');
  });

  it('configures TerminalCore with focus-triggered remote resize handoff enabled', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    expect(terminalConfigState.values.length).toBeGreaterThan(0);
    expect(terminalConfigState.values[0]?.cursorBlink).toBe(false);
    expect(terminalConfigState.values[0]?.rendererType).toBe('webgl');
    expect(terminalConfigState.values[0]?.clipboard).toEqual({
      copyOnSelect: false,
    });
    expect(terminalConfigState.values[0]?.responsive).toEqual({
      fitOnFocus: true,
      emitResizeOnFocus: true,
      notifyResizeOnlyWhenFocused: true,
    });
    expect(terminalConfigState.values[0]?.fit).toBeUndefined();
  });

  it('removes the terminal scrollbar reserve for workbench projected surfaces', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    expect(terminalConfigState.values.length).toBeGreaterThan(0);
    expect(terminalConfigState.values[0]?.fit).toEqual({
      scrollbarReservePx: 0,
    });
  });

  it('keeps workbench projected surfaces out of terminal render scale', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const core = terminalCoreInstances[0];
    expect(terminalConfigState.values[0]?.presentationScale).toBe(1);
    expect(core?.setAppearance).toHaveBeenCalled();
    expect(core?.setPresentationScale).not.toHaveBeenCalled();
  });

  it('keeps the terminal work indicator thickness local to the terminal panel', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const indicator = findTerminalWorkIndicator(host);
    expect(indicator?.style.getPropertyValue('--redeven-terminal-work-indicator-size')).toBe('3.5px');
  });

  it('hides the terminal work indicator when the global activity border preference is disabled', async () => {
    terminalPrefsState.workIndicatorEnabled = false;
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    emitTerminalData('session-1', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    expect(host.querySelector('[data-testid="terminal-content"]')?.getAttribute('data-terminal-work-state')).toBe('idle');
    expect(findTerminalWorkIndicator(host)).toBeNull();
  });

  it('marks the terminal work indicator with the app theme contrast mode', async () => {
    themeState.resolvedTheme = 'light';
    terminalPrefsState.userTheme = 'dark';
    const lightHost = document.createElement('div');
    document.body.appendChild(lightHost);

    render(() => <TerminalPanel variant="deck" />, lightHost);
    await settleTerminalPanel();

    expect(findTerminalWorkIndicator(lightHost)?.dataset.terminalWorkTheme).toBe('light');

    themeState.resolvedTheme = 'dark';
    terminalPrefsState.userTheme = 'light';
    const darkHost = document.createElement('div');
    document.body.appendChild(darkHost);

    render(() => <TerminalPanel variant="deck" />, darkHost);
    await settleTerminalPanel();

    expect(findTerminalWorkIndicator(darkHost)?.dataset.terminalWorkTheme).toBe('dark');
  });

  it('keeps the terminal work indicator idle in the activity panel even when a command is running', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();

    emitTerminalData('session-1', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');
  });

  it('uses shared workbench terminal geometry instead of local terminal preferences', async () => {
    terminalPrefsState.fontSize = 18;
    terminalPrefsState.fontFamilyId = 'iosevka';
    const fontSizeChange = vi.fn();
    const fontFamilyChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TerminalPanel
        variant="workbench"
        terminalGeometryPreferences={{
          fontSize: 14,
          fontFamilyId: 'jetbrains',
          onFontSizeChange: fontSizeChange,
          onFontFamilyChange: fontFamilyChange,
        }}
      />
    ), host);
    await settleTerminalPanel();

    expect(terminalConfigState.values[0]?.fontSize).toBe(14);
    expect(terminalCoreInstances[0]?.setFontSize).toHaveBeenCalledWith(14);
    expect(terminalCoreInstances[0]?.setFontFamily).toHaveBeenCalledWith(expect.stringContaining('JetBrains Mono'));
  });

  it('uses the explicit floeterm font-family API instead of mutating terminal internals directly', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    expect(terminalCoreInstances[0]?.setFontFamily).toHaveBeenCalledWith(expect.stringContaining('Iosevka'));
  });

  it('creates and focuses a terminal session from an activity-scoped open-session request', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handledSpy = vi.fn();

    render(() => (
      <TerminalPanel
        variant="panel"
        openSessionRequest={{
          requestId: 'request-1',
          workingDir: '/workspace/repo',
          preferredName: 'repo',
        }}
        onOpenSessionRequestHandled={handledSpy}
      />
    ), host);
    await settleTerminalPanel();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledWith('repo', '/workspace/repo');
    expect(handledSpy).toHaveBeenCalledWith('request-1');
    expect(host.textContent).toContain('repo');
  });

  it('ignores open-session requests that target a different container mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handledSpy = vi.fn();

    render(() => (
      <TerminalPanel
        variant="deck"
        openSessionRequest={{
          requestId: 'request-ignored',
          workingDir: '/workspace/repo',
          preferredName: 'repo',
          targetMode: 'activity',
        }}
        onOpenSessionRequestHandled={handledSpy}
      />
    ), host);
    await settleTerminalPanel();

    expect(sessionsCoordinatorMocks.createSession).not.toHaveBeenCalledWith('repo', '/workspace/repo');
    expect(handledSpy).not.toHaveBeenCalledWith('request-ignored');

    widgetState.currentWidgetId = 'widget-1';
    sessionsCoordinatorMocks.createSession.mockClear();

    const deckHost = document.createElement('div');
    document.body.appendChild(deckHost);
    render(() => (
      <TerminalPanel
        variant="deck"
        openSessionRequest={{
          requestId: 'request-deck',
          workingDir: '/workspace/repo',
          preferredName: 'repo',
          targetMode: 'deck',
        }}
        onOpenSessionRequestHandled={handledSpy}
      />
    ), deckHost);
    await settleTerminalPanel();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledWith('repo', '/workspace/repo');
    expect(handledSpy).toHaveBeenCalledWith('request-deck');
  });

  it('keeps workbench terminal session groups isolated and appends new sessions into the owning widget group', async () => {
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
        id: 'session-extra',
        name: 'Server logs',
        workingDir: '/workspace/logs',
        createdAtMs: 2,
        isActive: false,
        lastActiveAtMs: 5,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handledSpy = vi.fn();
    const groupStateSpy = vi.fn();

    render(() => (
      (() => {
        const [groupState, setGroupState] = createSignal({
          sessionIds: ['session-1'],
          activeSessionId: 'session-1' as string | null,
        });

        return (
          <TerminalPanel
            variant="workbench"
            sessionGroupState={groupState()}
            onSessionGroupStateChange={(next) => {
              groupStateSpy(next);
              setGroupState(next);
            }}
            openSessionRequest={{
              requestId: 'request-workbench-group',
              workingDir: '/workspace/repo',
              preferredName: 'repo',
            }}
            onOpenSessionRequestHandled={handledSpy}
          />
        );
      })()
    ), host);
    await settleTerminalPanel();

    expect(host.textContent).toContain('Terminal 1');
    expect(host.textContent).not.toContain('Server logs');
    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledWith('repo', '/workspace/repo');
    expect(groupStateSpy).toHaveBeenCalledWith({
      sessionIds: ['session-1', 'session-2'],
      activeSessionId: 'session-2',
    });
    expect(handledSpy).toHaveBeenCalledWith('request-workbench-group');
  });

  it('keeps previously activated workbench terminal tabs mounted live', async () => {
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

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      (() => {
        const [groupState, setGroupState] = createSignal({
          sessionIds: ['session-1', 'session-2'],
          activeSessionId: 'session-1' as string | null,
        });

        return (
          <TerminalPanel
            variant="workbench"
            sessionGroupState={groupState()}
            onSessionGroupStateChange={setGroupState}
          />
        );
      })()
    ), host);
    await settleTerminalPanel();

    expect(terminalEventSourceState.dataHandlers.get('session-1')?.size).toBe(1);
    expect(terminalEventSourceState.dataHandlers.get('session-2')?.size ?? 0).toBe(0);

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();

    expect(terminalEventSourceState.dataHandlers.get('session-1')?.size).toBe(1);
    expect(terminalEventSourceState.dataHandlers.get('session-2')?.size).toBe(1);
  });

  it('keeps mounted terminal views alive when equivalent session snapshots replace objects', async () => {
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

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      (() => {
        const [groupState, setGroupState] = createSignal({
          sessionIds: ['session-1', 'session-2'],
          activeSessionId: 'session-1' as string | null,
        });

        return (
          <TerminalPanel
            variant="workbench"
            sessionGroupState={groupState()}
            onSessionGroupStateChange={setGroupState}
          />
        );
      })()
    ), host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();
    await vi.waitFor(() => {
      expect(terminalCoreInstances).toHaveLength(2);
    });

    const initialAttachCallCount = transportMocks.attach.mock.calls.length;
    const mountedCores = [...terminalCoreInstances];

    terminalSessionsState.sessions = terminalSessionsState.sessions.map((session) => ({ ...session }));
    publishTerminalSessions();
    await settleTerminalPanel();

    expect(terminalCoreInstances).toEqual(mountedCores);
    expect(mountedCores[0]?.dispose).not.toHaveBeenCalled();
    expect(mountedCores[1]?.dispose).not.toHaveBeenCalled();
    expect(mountedCores[0]?.initialize).toHaveBeenCalledTimes(1);
    expect(mountedCores[1]?.initialize).toHaveBeenCalledTimes(1);
    expect(transportMocks.attach).toHaveBeenCalledTimes(initialAttachCallCount);
  });

  it('uses workbench session operations for tab create and close', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const deletePromise = {
      resolve: null as (() => void) | null,
    };

    const sessionOperations = {
      createSession: vi.fn(async () => ({
        id: 'session-2',
        name: 'Terminal 2',
        workingDir: '/workspace',
        createdAtMs: 2,
        isActive: true,
        lastActiveAtMs: 20,
      })),
      deleteSession: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          deletePromise.resolve = resolve;
        });
      }),
    };

    render(() => (
      (() => {
        const [groupState, setGroupState] = createSignal({
          sessionIds: ['session-1'],
          activeSessionId: 'session-1' as string | null,
        });

        return (
          <TerminalPanel
            variant="workbench"
            sessionGroupState={groupState()}
            onSessionGroupStateChange={setGroupState}
            sessionOperations={sessionOperations}
          />
        );
      })()
    ), host);
    await settleTerminalPanel();

    const addButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'Add') as HTMLButtonElement | undefined;
    expect(addButton).toBeTruthy();

    addButton?.click();
    await settleTerminalPanel();

    expect(sessionOperations.createSession).toHaveBeenCalledWith('Terminal 2', '/workspace');
    expect(sessionsCoordinatorMocks.createSession).not.toHaveBeenCalled();
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).toBeNull();
    expect(host.querySelector('[data-testid="close-tab-session-2"]')).toBeTruthy();

    const closeButton = host.querySelector('[data-testid="close-tab-session-2"]') as HTMLButtonElement | null;
    expect(closeButton).toBeTruthy();
    closeButton?.click();
    await settleTerminalPanel();

    expect(sessionOperations.deleteSession).toHaveBeenCalledWith('session-2');
    expect(sessionsCoordinatorMocks.deleteSession).not.toHaveBeenCalled();
    expect(findTerminalTab(host, 'Terminal 2')).toBeUndefined();

    deletePromise.resolve?.();
    await settleTerminalPanel();
  });

  it('creates a new terminal session without sending a fixed 80x24 create size', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const button = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'Add') as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();

    button?.click();
    await settleTerminalPanel();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledWith('Terminal 2', '/workspace');
  });

  it('shows an optimistic terminal tab immediately while session creation is pending', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const resolveCreateCallbacks: Array<(value: typeof terminalSessionsState.sessions[number]) => void> = [];
    sessionsCoordinatorMocks.createSession.mockImplementationOnce(async (name?: string, workingDir?: string) => (
      await new Promise<typeof terminalSessionsState.sessions[number]>((resolve) => {
        resolveCreateCallbacks.push((session) => {
          terminalSessionsState.sessions = [
            ...terminalSessionsState.sessions.map((entry) => ({ ...entry, isActive: false })),
            session,
          ];
          publishTerminalSessions();
          resolve(session);
        });
      })
    ));

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const addButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'Add') as HTMLButtonElement | undefined;
    expect(addButton).toBeTruthy();

    addButton?.click();
    await settleTerminalPanelMicrotasks();

    expect(findTerminalTab(host, 'Terminal 2')).toBeTruthy();
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).not.toBeNull();
    expect(host.textContent).toContain('Creating terminal...');
    expect(sessionsCoordinatorMocks.createSession).not.toHaveBeenCalled();

    await settleTerminalPanel();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledWith('Terminal 2', '/workspace');
    expect(transportMocks.attach.mock.calls.every((call) => !String(call[0] ?? '').includes('pending-terminal'))).toBe(true);

    resolveCreateCallbacks[0]?.({
      id: 'session-2',
      name: 'Terminal 2',
      workingDir: '/workspace',
      createdAtMs: 2,
      isActive: true,
      lastActiveAtMs: 20,
    });
    await settleTerminalPanel();

    expect(findTerminalTab(host, 'Terminal 2')).toBeTruthy();
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).toBeNull();
    expect(host.querySelector('[data-testid="close-tab-session-2"]')).toBeTruthy();
  });

  it('reconciles an optimistic terminal tab when the session snapshot arrives before create resolves', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const resolveCreateRef: {
      current: ((value: typeof terminalSessionsState.sessions[number]) => void) | null;
    } = { current: null };
    sessionsCoordinatorMocks.createSession.mockImplementationOnce(async () => (
      await new Promise<typeof terminalSessionsState.sessions[number]>((resolve) => {
        resolveCreateRef.current = resolve;
      })
    ));

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const addButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'Add') as HTMLButtonElement | undefined;
    addButton?.click();
    await settleTerminalPanel();

    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).not.toBeNull();

    const createdSession = {
      id: 'session-2',
      name: 'Terminal 2',
      workingDir: '/workspace',
      createdAtMs: 2,
      isActive: true,
      lastActiveAtMs: 20,
    };
    terminalSessionsState.sessions = [
      ...terminalSessionsState.sessions.map((entry) => ({ ...entry, isActive: false })),
      createdSession,
    ];
    publishTerminalSessions();
    await settleTerminalPanel();

    expect(findTerminalTabs(host, 'Terminal 2')).toHaveLength(1);
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).toBeNull();
    expect(host.textContent).not.toContain('Creating terminal...');
    expect(host.querySelector('[data-testid="close-tab-session-2"]')).toBeTruthy();

    const completeCreate = resolveCreateRef.current;
    expect(completeCreate).not.toBeNull();
    if (!completeCreate) throw new Error('Missing create resolver');
    completeCreate(createdSession);
    await settleTerminalPanel();

    expect(findTerminalTabs(host, 'Terminal 2')).toHaveLength(1);
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).toBeNull();
    expect(host.querySelector('[data-testid="close-tab-session-2"]')).toBeTruthy();
  });

  it('keeps a failed optimistic terminal tab in place with retry and dismiss actions', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    sessionsCoordinatorMocks.createSession
      .mockRejectedValueOnce(new Error('shell unavailable'))
      .mockImplementationOnce(async (name?: string, workingDir?: string) => {
        const session = {
          id: 'session-2',
          name: String(name ?? '').trim() || 'Terminal 2',
          workingDir: String(workingDir ?? '').trim() || '/workspace',
          createdAtMs: 2,
          isActive: true,
          lastActiveAtMs: 20,
        };
        terminalSessionsState.sessions = [
          ...terminalSessionsState.sessions.map((entry) => ({ ...entry, isActive: false })),
          session,
        ];
        publishTerminalSessions();
        return session;
      });

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const addButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'Add') as HTMLButtonElement | undefined;
    addButton?.click();
    await settleTerminalPanel();

    expect(findTerminalTab(host, 'Terminal 2')).toBeTruthy();
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'failed')).not.toBeNull();
    expect(host.textContent).toContain('Terminal creation failed');
    expect(host.textContent).toContain('shell unavailable');

    const retryButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'Retry') as HTMLButtonElement | undefined;
    retryButton?.click();
    await settleTerminalPanel();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledTimes(2);
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'failed')).toBeNull();
    expect(host.querySelector('[data-testid="close-tab-session-2"]')).toBeTruthy();
  });

  it('attaches with measured dimensions and performs one final size confirmation after attach', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.attach).toHaveBeenCalledWith('session-1', 80, 24);
    });
    await vi.waitFor(() => {
      expect(transportMocks.resize).toHaveBeenCalledWith('session-1', 80, 24);
    });
  });

  it('opens the floating file preview from a modifier-click terminal file link', async () => {
    terminalBufferLinesState.lines.set(0, 'src/app/server.ts:18:4 failed to compile');

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const provider = terminalCoreInstances[0]?.registeredLinkProviders[0];
    expect(provider).toBeTruthy();

    const links = await new Promise<any[] | undefined>((resolve) => {
      provider.provideLinks(1, resolve);
    });
    expect(links).toHaveLength(1);

    links?.[0]?.activate(new MouseEvent('click', { metaKey: true }));
    await settleTerminalPanel();

    expect(openPreviewSpy).toHaveBeenCalledWith({
      id: '/workspace/src/app/server.ts',
      name: 'server.ts',
      path: '/workspace/src/app/server.ts',
      type: 'file',
    });
  });

  it('marks inactive sessions after a bell with an unread dot and clears it when the session becomes active', async () => {
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

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Terminal 2')?.click();
    await settleTerminalPanel();

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Terminal 1')?.click();
    await settleTerminalPanel();

    terminalCoreInstances[1]?.emitBell();
    await settleTerminalPanel();
    terminalCoreInstances[1]?.emitBell();
    await settleTerminalPanel();

    expect(notificationMocks.info).not.toHaveBeenCalled();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');
    const terminal2Tab = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Terminal 2'));
    expect(terminal2Tab?.querySelector('[data-terminal-tab-status="unread"]')).not.toBeNull();
    expect(host.textContent).not.toContain('! Terminal 2');

    terminal2Tab?.click();
    await settleTerminalPanel();

    const activeTerminal2Tab = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Terminal 2'));
    expect(activeTerminal2Tab?.querySelector('[data-terminal-tab-status="unread"]')).toBeNull();
  });

  it('shows a running spinner for a background command and switches to an unread dot when it finishes', async () => {
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

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Terminal 2')?.click();
    await settleTerminalPanel();

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    let terminal2Tab = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Terminal 2'));
    expect(terminal2Tab?.querySelector('[data-terminal-tab-status="running"]')).not.toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');

    emitTerminalData('session-2', '\x1b]633;D;0\u0007', 2);
    await settleTerminalPanel();

    terminal2Tab = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Terminal 2'));
    expect(terminal2Tab?.querySelector('[data-terminal-tab-status="running"]')).toBeNull();
    expect(terminal2Tab?.querySelector('[data-terminal-tab-status="unread"]')).not.toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');
  });

  it('switches a background interactive session from running spinner to an unread dot after output goes quiet', async () => {
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

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
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

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).not.toBeNull();
  });

  it('lets a quiet background command drop its spinner after the start grace window when no new output arrives', async () => {
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

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('active');

    await new Promise<void>((resolve) => setTimeout(resolve, 1_700));
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('running');

    emitTerminalData('session-2', '\x1b]633;D;0\u0007', 2);
    await settleTerminalPanel();

    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');
  });

  it('lets explicit program activity markers override the tab spinner and fall back to unread when the tool goes idle', async () => {
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

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;P;RedevenActivity=busy\u0007', 1);
    emitTerminalData('session-2', 'thinking...\n', 2);
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');

    emitTerminalData('session-2', '\x1b]633;P;RedevenActivity=idle\u0007', 3);
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).not.toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');
  });

  it('consumes cwd shell-integration markers without writing them to the terminal surface', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const activeCore = terminalCoreInstances[0];
    activeCore?.write.mockClear();
    sessionsCoordinatorMocks.updateSessionMeta.mockClear();

    emitTerminalData('session-1', '\x1b]633;P;Cwd=/workspace/repo\u0007', 1);
    await settleTerminalPanel();

    expect(activeCore?.write).not.toHaveBeenCalled();
    expect(sessionsCoordinatorMocks.updateSessionMeta).toHaveBeenCalledWith('session-1', { workingDir: '/workspace/repo' });
  });

  it('coalesces same-frame live output before writing to the terminal surface', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const activeCore = terminalCoreInstances[0];
    activeCore?.write.mockClear();

    emitTerminalData('session-1', 'alpha ', 1);
    emitTerminalData('session-1', 'beta ', 2);
    emitTerminalData('session-1', 'gamma', 3);
    await settleTerminalPanel();

    expect(activeCore?.write).toHaveBeenCalledTimes(1);
    const firstWrite = activeCore?.write.mock.calls[0]?.[0] as Uint8Array | undefined;
    expect(firstWrite ? new TextDecoder().decode(firstWrite) : '').toBe('alpha beta gamma');
  });

  it('keeps inactive sessions from repainting live output until they are activated again', async () => {
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
        workingDir: '/workspace',
        createdAtMs: 2,
        isActive: false,
        lastActiveAtMs: 5,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    const inactiveCore = terminalCoreInstances[1];
    inactiveCore?.write.mockClear();
    transportMocks.historyPage.mockClear();
    transportMocks.historyPage.mockResolvedValue({
      chunks: [
        {
          sequence: 1,
          timestampMs: 42,
          data: textEncoder.encode('background output'),
        },
      ],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 1,
      lastSequence: 1,
      coveredBytes: 'background output'.length,
      totalBytes: 'background output'.length,
    });

    emitTerminalData('session-2', 'background output', 1);
    await settleTerminalPanel();

    expect(inactiveCore?.write).not.toHaveBeenCalled();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).not.toBeNull();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();
    await settleTerminalPanel();

    const reloadedCore = terminalCoreInstances[terminalCoreInstances.length - 1];
    expect(transportMocks.historyPage).toHaveBeenCalledWith('session-2', 0, -1);
    const firstWrite = reloadedCore?.write.mock.calls[0]?.[0] as Uint8Array | undefined;
    expect(firstWrite ? new TextDecoder().decode(firstWrite) : '').toBe('background output');
  });

  it('replays terminal history page-by-page and shows progress while a later page is loading', async () => {
    let releaseSecondPage: (page: TestTerminalHistoryPage) => void = () => {};
    const secondPage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseSecondPage = resolve;
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage
      .mockResolvedValueOnce(makeTerminalHistoryPage({
        chunks: [
          {
            sequence: 1,
            timestampMs: 10,
            data: textEncoder.encode('alpha'),
          },
        ],
        nextStartSeq: 2,
        hasMore: true,
        firstSequence: 1,
        lastSequence: 1,
        coveredBytes: 5,
        totalBytes: 10,
      }))
      .mockReturnValueOnce(secondPage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    expect(host.textContent).toContain('Loading history 5 B / 10 B');

    const core = terminalCoreInstances[0];
    expect(core?.clear).toHaveBeenCalled();
    expect(core?.startHistoryReplay).toHaveBeenCalledWith(120_000);

    releaseSecondPage(makeTerminalHistoryPage({
      chunks: [
        {
          sequence: 2,
          timestampMs: 20,
          data: textEncoder.encode('omega'),
        },
      ],
      hasMore: false,
      firstSequence: 2,
      lastSequence: 2,
      coveredBytes: 5,
      totalBytes: 10,
    }));

    await vi.waitFor(() => {
      expect(core?.endHistoryReplay).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(core?.write).toHaveBeenCalledTimes(2);
    });

    expect(transportMocks.historyPage).toHaveBeenNthCalledWith(1, 'session-1', 0, -1);
    expect(transportMocks.historyPage).toHaveBeenNthCalledWith(2, 'session-1', 2, -1);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['alpha', 'omega']);
  });

  it('deduplicates live chunks buffered while terminal history pages replay', async () => {
    let releaseHistoryPage: (page: TestTerminalHistoryPage) => void = () => {};
    const historyPage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseHistoryPage = resolve;
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage.mockReturnValueOnce(historyPage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    emitTerminalData('session-1', 'duplicate', 1);
    emitTerminalData('session-1', 'fresh', 2);
    await settleTerminalPanel();

    expect(core?.write).not.toHaveBeenCalled();

    releaseHistoryPage(makeTerminalHistoryPage({
      chunks: [
        {
          sequence: 1,
          timestampMs: 10,
          data: textEncoder.encode('duplicate'),
        },
      ],
      hasMore: false,
      firstSequence: 1,
      lastSequence: 1,
      coveredBytes: 9,
      totalBytes: 9,
    }));

    await vi.waitFor(() => {
      expect(core?.endHistoryReplay).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(core?.write).toHaveBeenCalledTimes(2);
    });

    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['duplicate', 'fresh']);
  });

  it('does not recreate a session when the same open-session request id is replayed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handledSpy = vi.fn();
    const [request, setRequest] = createSignal({
      requestId: 'request-1',
      workingDir: '/workspace/repo',
      preferredName: 'repo',
      targetMode: 'deck' as const,
    });

    render(() => (
      <TerminalPanel
        variant="deck"
        openSessionRequest={request()}
        onOpenSessionRequestHandled={handledSpy}
      />
    ), host);
    await settleTerminalPanel();

    setRequest({
      requestId: 'request-1',
      workingDir: '/workspace/repo',
      preferredName: 'repo-again',
      targetMode: 'deck',
    });
    await settleTerminalPanel();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledTimes(1);
    expect(handledSpy).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the active terminal after closing settings', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'system';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await Promise.resolve();
    await Promise.resolve();
    focusSpy.mockClear();

    (host.querySelector('[data-testid="dropdown-item-settings"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    expect(host.querySelector('[data-testid="dialog"]')?.className).toContain('h-[calc(100dvh-0.5rem)]');

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Close'))?.click();
    await Promise.resolve();

    expect(focusSpy).toHaveBeenCalled();
  });

  it('re-sends terminal resize when focus is restored after closing settings', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'system';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();
    focusSpy.mockClear();
    transportMocks.resize.mockClear();

    (host.querySelector('[data-testid="dropdown-item-settings"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Close'))?.click();
    await Promise.resolve();

    expect(focusSpy).toHaveBeenCalled();
    expect(transportMocks.resize).toHaveBeenCalledWith('session-1', 80, 24);
  });

  it('restores focus to the active terminal when workbench local activation advances', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => {
      const [activationSeq, setActivationSeq] = createSignal(0);
      (host as HTMLElement & { bumpWorkbenchActivation?: () => void }).bumpWorkbenchActivation = () => {
        setActivationSeq((value) => value + 1);
      };

      return (
        <TerminalPanel
          variant="workbench"
          workbenchSelected
          workbenchActivationSeq={activationSeq()}
        />
      );
    }, host);
    await settleTerminalPanel();
    focusSpy.mockClear();

    (host as HTMLElement & { bumpWorkbenchActivation?: () => void }).bumpWorkbenchActivation?.();
    await settleTerminalPanel();

    expect(focusSpy).toHaveBeenCalled();
  });

  it('does not restore focus when an unselected workbench terminal receives an activation update', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => {
      const [activationSeq, setActivationSeq] = createSignal(0);
      (host as HTMLElement & { bumpWorkbenchActivation?: () => void }).bumpWorkbenchActivation = () => {
        setActivationSeq((value) => value + 1);
      };

      return (
        <TerminalPanel
          variant="workbench"
          workbenchSelected={false}
          workbenchActivationSeq={activationSeq()}
        />
      );
    }, host);
    await settleTerminalPanel();
    focusSpy.mockClear();

    (host as HTMLElement & { bumpWorkbenchActivation?: () => void }).bumpWorkbenchActivation?.();
    await settleTerminalPanel();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('marks the live terminal host as a text-selection surface in workbench mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();
    expect(terminalSurface?.getAttribute(LOCAL_INTERACTION_SURFACE_ATTR)).toBe('true');
    expect(terminalSurface?.getAttribute(REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR)).toBe('true');
  });

  it('restores focus on plain click inside workbench terminal surfaces when no selection exists', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" workbenchSelected />, host);
    await settleTerminalPanel();
    focusSpy.mockClear();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await settleTerminalPanel();

    expect(focusSpy).toHaveBeenCalled();
  });

  it('does not restore focus on plain click inside an unselected workbench terminal', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" workbenchSelected={false} />, host);
    await settleTerminalPanel();
    focusSpy.mockClear();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await settleTerminalPanel();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('does not restore focus on workbench terminal clicks while the terminal already owns a selection', async () => {
    terminalSelectionState.text = 'pnpm test';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();
    focusSpy.mockClear();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await settleTerminalPanel();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('defaults to the Floe keyboard on mobile and sends payloads to the active session', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector('[data-testid="mobile-keyboard"]')).toBeTruthy();
    (host.querySelector('[data-testid="mobile-keyboard-key"]') as HTMLButtonElement | null)?.click();

    expect(transportMocks.sendInput).toHaveBeenCalledWith('session-1', 'x', 'conn-1');
  });

  it('does not restore terminal focus after closing settings when Floe keyboard mode is active on mobile', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await Promise.resolve();
    await Promise.resolve();
    focusSpy.mockClear();

    (host.querySelector('[data-testid="dropdown-item-settings"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Close'))?.click();
    await Promise.resolve();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('switches from Floe keyboard mode to system IME only from terminal settings', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();
    focusSpy.mockClear();
    forceResizeSpy.mockClear();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    const sessionViewport = terminalSurface?.parentElement as HTMLDivElement | null;

    expect(host.querySelector('[data-testid="dropdown-item-use_system_ime"]')).toBeNull();
    expect(host.querySelector('[data-testid="dropdown-item-hide_floe_keyboard"]')).toBeTruthy();

    (host.querySelector('[data-testid="dropdown-item-settings"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('System IME'))?.click();
    await Promise.resolve();

    expect(terminalPrefsState.mobileInputMode).toBe('system');
    expect(host.querySelector('[data-testid="mobile-keyboard"]')).toBeNull();
    expect(sessionViewport?.style.getPropertyValue('--terminal-bottom-inset')).toBe('0px');
    expect(forceResizeSpy).toHaveBeenCalled();

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Close'))?.click();
    await Promise.resolve();

    expect(focusSpy).toHaveBeenCalled();
  });

  it('keeps temporary Floe keyboard visibility actions in the mobile More menu only for Floe mode', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    const sessionViewport = terminalSurface?.parentElement as HTMLDivElement | null;
    forceResizeSpy.mockClear();

    expect(host.querySelector('[data-testid="dropdown-item-hide_floe_keyboard"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="dropdown-item-show_floe_keyboard"]')).toBeNull();
    expect(host.textContent).not.toContain('Session: session-1');
    expect(host.textContent).not.toContain('History:');

    (host.querySelector('[data-testid="dropdown-item-hide_floe_keyboard"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();

    expect(host.querySelector('[data-testid="mobile-keyboard"]')).toBeNull();
    expect(sessionViewport?.style.getPropertyValue('--terminal-bottom-inset')).toBe('0px');
    expect(host.querySelector('[data-testid="dropdown-item-show_floe_keyboard"]')).toBeTruthy();
    expect(host.textContent).toContain('Session: session-1');
    expect(host.textContent).toContain('History:');
    expect(forceResizeSpy).toHaveBeenCalled();

    forceResizeSpy.mockClear();
    (host.querySelector('[data-testid="dropdown-item-show_floe_keyboard"]') as HTMLButtonElement | null)?.click();
    await settleTerminalPanel();

    expect(host.querySelector('[data-testid="mobile-keyboard"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="dropdown-item-hide_floe_keyboard"]')).toBeTruthy();
    expect(sessionViewport?.style.getPropertyValue('--terminal-bottom-inset')).toBe('80px');
    expect(forceResizeSpy).toHaveBeenCalled();
  });

  it('recomputes the terminal inset correctly when the keyboard is reopened from the terminal surface', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    const sessionViewport = terminalSurface?.parentElement as HTMLDivElement | null;
    expect(sessionViewport?.style.getPropertyValue('--terminal-bottom-inset')).toBe('80px');

    (host.querySelector('[data-testid="mobile-keyboard-dismiss"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    expect(sessionViewport?.style.getPropertyValue('--terminal-bottom-inset')).toBe('0px');

    terminalSurface?.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 9,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 40,
      clientY: 40,
    }));
    await settleTerminalPanel();

    expect(host.querySelector('[data-testid="mobile-keyboard"]')).toBeTruthy();
    expect(sessionViewport?.style.getPropertyValue('--terminal-bottom-inset')).toBe('80px');
  });

  it('does not show Floe keyboard actions in the mobile More menu while System IME mode is active', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'system';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector('[data-testid="dropdown-item-show_floe_keyboard"]')).toBeNull();
    expect(host.querySelector('[data-testid="dropdown-item-hide_floe_keyboard"]')).toBeNull();
    expect(host.querySelector('[data-testid="dropdown-item-use_floe_keyboard"]')).toBeNull();
    expect(host.querySelector('[data-testid="dropdown-item-use_system_ime"]')).toBeNull();
    expect(host.querySelector('[data-testid="dropdown-item-settings"]')).toBeTruthy();
  });

  it('suppresses the system IME and matches the terminal inset to the real keyboard overlap', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalInput = host.querySelector('textarea[aria-label="Terminal input"]') as HTMLTextAreaElement | null;
    expect(terminalInput?.getAttribute('inputmode')).toBe('none');
    expect(terminalInput?.getAttribute('virtualkeyboardpolicy')).toBe('manual');

    const terminalContent = host.querySelector('[data-testid="terminal-content"]') as HTMLDivElement | null;
    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    const sessionViewport = terminalSurface?.parentElement as HTMLDivElement | null;

    expect(terminalContent?.style.paddingBottom).toBe('');
    expect(sessionViewport?.style.getPropertyValue('--terminal-bottom-inset')).toBe('80px');
    expect(terminalSurface?.style.bottom).toBe('var(--terminal-bottom-inset)');
    expect(host.textContent).not.toContain('Session: session-1');
    expect(host.textContent).not.toContain('History:');
  });

  it('maps mobile touch drags on the terminal surface to terminal scrollback', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await Promise.resolve();
    await Promise.resolve();
    scrollLinesSpy.mockClear();
    terminalInputSpy.mockClear();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();
    expect(terminalSurface?.style.touchAction).toBe('pan-x');
    expect(terminalSurface?.style.overscrollBehavior).toBe('contain');

    terminalSurface?.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 40,
      clientY: 40,
    }));
    terminalSurface?.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 40,
      clientY: 65,
    }));
    terminalSurface?.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 40,
      clientY: 65,
    }));

    expect(scrollLinesSpy).toHaveBeenCalledWith(-1);
    expect(terminalInputSpy).not.toHaveBeenCalled();
  });

  it('routes mobile touch drags through terminal input when the terminal is in alternate screen mode', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';
    terminalScrollState.alternateScreen = true;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await Promise.resolve();
    await Promise.resolve();
    scrollLinesSpy.mockClear();
    terminalInputSpy.mockClear();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 40,
      clientY: 60,
    }));
    terminalSurface?.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 40,
      clientY: 35,
    }));
    terminalSurface?.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 40,
      clientY: 35,
    }));

    expect(scrollLinesSpy).not.toHaveBeenCalled();
    expect(terminalInputSpy).toHaveBeenCalledWith('\x1B[B', true);
  });

  it('shows keyboard suggestions and sends the completion payload when a suggestion is selected', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await Promise.resolve();
    await Promise.resolve();
    transportMocks.sendInput.mockClear();

    (host.querySelector('[data-testid="mobile-keyboard-key-g"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    await Promise.resolve();

    const gitSuggestion = host.querySelector('[data-testid="mobile-keyboard-suggestion-git"]') as HTMLButtonElement | null;
    expect(gitSuggestion).toBeTruthy();

    gitSuggestion?.click();
    await Promise.resolve();

    expect(transportMocks.sendInput).toHaveBeenNthCalledWith(1, 'session-1', 'g', 'conn-1');
    expect(transportMocks.sendInput).toHaveBeenNthCalledWith(2, 'session-1', 'it ', 'conn-1');
  });

  it('copies the active terminal selection from the custom context menu', async () => {
    terminalSelectionState.text = '  echo redeven\n';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 32,
    }));
    await settleTerminalPanel();

    const copyButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Copy selection'));
    expect(copyButton).toBeTruthy();

    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settleTerminalPanel();

    expect(terminalCoreInstances).toHaveLength(1);
    expect(terminalCoreInstances[0]?.copySelection).toHaveBeenCalledWith('command');
  });

  it('keeps the workbench terminal context menu inside the local surface host', async () => {
    terminalSelectionState.text = 'pwd';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <div data-floe-dialog-surface-host="true">
        <TerminalPanel variant="workbench" />
      </div>
    ), host);
    await settleTerminalPanel();

    const surfaceHost = host.querySelector('[data-floe-dialog-surface-host="true"]') as HTMLDivElement | null;
    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(surfaceHost).toBeTruthy();
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 32,
    }));
    await settleTerminalPanel();

    const menu = surfaceHost?.querySelector('[role="menu"]') as HTMLDivElement | null;
    const copyButton = Array.from(menu?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Copy selection')
    ) as HTMLButtonElement | undefined;
    expect(menu).toBeTruthy();
    expect(menu?.getAttribute('data-floe-local-interaction-surface')).toBe('true');
    expect(copyButton).toBeTruthy();
  });

  it('opens the shared file browser from the terminal context menu', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 32,
    }));
    await settleTerminalPanel();

    const menu = host.querySelector('[role="menu"]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();

    const menuButtons = Array.from(menu?.querySelectorAll('button') ?? []);
    expect(menuButtons.map((button) => button.textContent?.trim())).toEqual([
      'Ask Flower',
      'Browse files',
      'Copy selection',
    ]);
    expect(menu?.querySelectorAll('[role="separator"]')).toHaveLength(1);

    const browseButton = menuButtons.find((button) => button.textContent?.includes('Browse files'));
    expect(browseButton).toBeTruthy();

    browseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settleTerminalPanel();

    expect(openFileBrowserAtPathSpy).toHaveBeenCalledWith('/workspace', {
      homePath: '/workspace',
    });
  });

  it('uses a fresh Files widget for workbench terminal browse-files handoffs', async () => {
    envContextState.viewMode = 'workbench';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 32,
    }));
    await settleTerminalPanel();

    const menu = host.querySelector('[role="menu"]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();

    const menuButtons = Array.from(menu?.querySelectorAll('button') ?? []);
    expect(menuButtons.map((button) => button.textContent?.trim())).toEqual([
      'Ask Flower',
      'Browse files',
      'Copy selection',
    ]);

    const browseButton = menuButtons.find((button) => button.textContent?.includes('Browse files'));
    expect(browseButton).toBeTruthy();

    browseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settleTerminalPanel();

    expect(openFileBrowserAtPathSpy).toHaveBeenCalledWith('/workspace', {
      homePath: '/workspace',
      openStrategy: 'create_new',
    });
  });

  it('hides the terminal file-browser action when read permission is unavailable', async () => {
    terminalEnvPermissionsState.canRead = false;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 32,
    }));
    await settleTerminalPanel();

    const menu = host.querySelector('[role="menu"]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();

    const menuButtons = Array.from(menu?.querySelectorAll('button') ?? []);
    expect(menuButtons.map((button) => button.textContent?.trim())).toEqual([
      'Ask Flower',
      'Copy selection',
    ]);
    expect(menu?.querySelectorAll('[role="separator"]')).toHaveLength(1);

    const browseButton = menuButtons.find((button) => button.textContent?.includes('Browse files'));
    expect(browseButton).toBeUndefined();
  });

  it('keeps terminal search as the product-owned mod+f shortcut', async () => {
    terminalSelectionState.text = 'pnpm test';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      key: 'f',
    });
    terminalSurface?.dispatchEvent(event);
    await settleTerminalPanel();

    expect(event.defaultPrevented).toBe(true);
    const searchInput = host.querySelector('input[placeholder="Search..."]') as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();
  });

  it('does not keep a product-owned Cmd/Ctrl+C copy workaround at the panel shell', async () => {
    terminalSelectionState.text = 'pnpm test';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      key: 'c',
    });
    terminalSurface?.dispatchEvent(event);
    await settleTerminalPanel();

    expect(terminalCoreInstances).toHaveLength(1);
    expect(terminalCoreInstances[0]?.copySelection).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
