// @vitest-environment jsdom

import { For, Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TerminalPanel } from './TerminalPanel';

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

const terminalPrefsState = vi.hoisted(() => ({
  userTheme: 'system',
  fontSize: 12,
  fontFamilyId: 'iosevka',
  mobileInputMode: 'floe' as 'floe' | 'system',
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
const terminalEnvPermissionsState = vi.hoisted(() => ({
  canRead: true,
  canExecute: true,
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
    resolvedTheme: () => 'dark',
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
  LoadingOverlay: (props: any) => (props.visible ? <div>{props.message}</div> : null),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
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
        <button type="button" onClick={() => props.onChange?.(item.id)}>
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
      openAskFlowerComposer: vi.fn(),
      openTerminalInDirectoryRequestSeq: () => 0,
      openTerminalInDirectoryRequest: () => null,
      openTerminalInDirectory: vi.fn(),
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

async function settleTerminalPanel() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

function findTerminalTab(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as HTMLButtonElement | undefined;
}

function findTerminalTabStatus(host: HTMLElement, label: string, status: 'running' | 'unread' | 'none'): Element | null {
  return findTerminalTab(host, label)?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? null;
}

describe('TerminalPanel', () => {
  beforeEach(() => {
    terminalPrefsState.userTheme = 'system';
    terminalPrefsState.fontSize = 12;
    terminalPrefsState.fontFamilyId = 'iosevka';
    terminalPrefsState.mobileInputMode = 'floe';
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
    expect(terminalConfigState.values[0]?.clipboard).toEqual({
      copyOnSelect: false,
    });
    expect(terminalConfigState.values[0]?.responsive).toEqual({
      fitOnFocus: true,
      emitResizeOnFocus: true,
      notifyResizeOnlyWhenFocused: true,
    });
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

    emitTerminalData('session-2', '\x1b]633;D;0\u0007', 2);
    await settleTerminalPanel();

    terminal2Tab = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Terminal 2'));
    expect(terminal2Tab?.querySelector('[data-terminal-tab-status="running"]')).toBeNull();
    expect(terminal2Tab?.querySelector('[data-terminal-tab-status="unread"]')).not.toBeNull();
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

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();

    await new Promise<void>((resolve) => setTimeout(resolve, 1_700));
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).toBeNull();
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

    emitTerminalData('session-2', '\x1b]633;P;RedevenActivity=idle\u0007', 3);
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).not.toBeNull();
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

    expect(writeTextToClipboardSpy).toHaveBeenCalledWith('  echo redeven\n');
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

    expect(openBrowserSpy).toHaveBeenCalledWith({
      path: '/workspace',
      homePath: '/workspace',
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

  it('does not route Cmd/Ctrl+C through a local keydown workaround', async () => {
    terminalSelectionState.text = 'pnpm test';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    terminalSurface?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'c',
    }));
    await settleTerminalPanel();

    expect(writeTextToClipboardSpy).not.toHaveBeenCalled();
  });

  it('does not hijack Cmd/Ctrl+C from non-terminal inputs inside the panel host', async () => {
    terminalSelectionState.text = 'pnpm test';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await settleTerminalPanel();

    const terminalContent = host.querySelector('[data-testid="terminal-content"]') as HTMLDivElement | null;
    expect(terminalContent).toBeTruthy();

    const extraInput = document.createElement('input');
    terminalContent?.appendChild(extraInput);

    extraInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'c',
    }));
    await settleTerminalPanel();

    expect(writeTextToClipboardSpy).not.toHaveBeenCalled();
  });
});
