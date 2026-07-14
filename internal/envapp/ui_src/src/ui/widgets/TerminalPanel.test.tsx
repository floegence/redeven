// @vitest-environment jsdom

import { For, Show, createEffect, createSignal } from 'solid-js';
import { render as solidRender } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_INTERACTION_SURFACE_ATTR } from '@floegence/floe-webapp-core/ui';

import { TerminalPanel } from './TerminalPanel';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR } from '../workbench/surface/workbenchTextSelectionSurface';
import {
  getDebugConsoleClientEventRingSnapshot,
  resetDebugConsoleCaptureForTests,
} from '../services/debugConsoleCapture';
import { resetTerminalRecoveryDiagnosticsForTests } from '../services/terminalRecoveryDiagnostics';

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
const terminalWriteCompletionState = vi.hoisted(() => ({
  deferHistory: false,
  deferLive: false,
  historyCallbacks: [] as Array<() => void>,
  liveCallbacks: [] as Array<() => void>,
}));
const createOutputPipelineSpy = vi.hoisted(() => vi.fn());
const createOutputCoordinatorSpy = vi.hoisted(() => vi.fn());
const outputCoordinatorRetrySpy = vi.hoisted(() => vi.fn());
const terminalWorkingSetState = vi.hoisted(() => ({
  runtimes: new Map<string, any>(),
  activeSessionId: null as string | null,
  interactions: new Map<string, Set<string>>(),
  setPageHidden: vi.fn(),
  evaluate: vi.fn(),
  dispose: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));

const writeTextToClipboardSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const openBrowserSpy = vi.hoisted(() => vi.fn(async () => undefined));
const openPreviewSpy = vi.hoisted(() => vi.fn(async () => undefined));
const openFileBrowserAtPathSpy = vi.hoisted(() => vi.fn(async () => undefined));
const openFlowerTurnLauncherSpy = vi.hoisted(() => vi.fn());
const openDebugConsoleSpy = vi.hoisted(() => vi.fn());
const terminalEnvPermissionsState = vi.hoisted(() => ({
  canRead: true,
  canWrite: true,
  canExecute: true,
}));
const envContextState = vi.hoisted(() => ({
  viewMode: 'activity' as 'activity' | 'workbench',
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
  createUIFirstSelection: (options: any) => {
    const [visual, setVisual] = createSignal(options.committed());
    const [pending, setPending] = createSignal(false);
    let requestID = 0;
    createEffect(() => {
      const committed = options.committed();
      if (!pending()) setVisual(committed);
    });
    return {
      visual,
      committed: options.committed,
      pending,
      preview: setVisual,
      resetPreview: () => {
        if (!pending()) setVisual(options.committed());
      },
      request: (value: unknown, metadata?: unknown) => {
        const currentRequest = ++requestID;
        setVisual(value);
        setPending(true);
        queueMicrotask(() => {
          if (currentRequest !== requestID) return;
          options.commit(value, metadata);
          queueMicrotask(() => {
            if (currentRequest !== requestID) return;
            setPending(false);
            setVisual(options.committed());
          });
        });
      },
      commitNow: (value: unknown, metadata?: unknown) => options.commit(value, metadata),
      cancel: () => {
        requestID += 1;
        setPending(false);
        setVisual(options.committed());
      },
    };
  },
  deferAfterPaint: (fn: () => void) => {
    requestAnimationFrame(() => setTimeout(fn, 0));
  },
  isMacLikePlatform: () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/u.test(navigator.userAgent),
  matchKeybind: (event: KeyboardEvent, keybind: string | { mod?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean; key: string }) => {
    const parsed = typeof keybind === 'string'
      ? (() => {
        const parts = keybind.toLowerCase().split('+');
        const key = parts.pop() || '';
        return {
          mod: parts.includes('mod'),
          ctrl: parts.includes('ctrl'),
          alt: parts.includes('alt'),
          shift: parts.includes('shift'),
          key,
        };
      })()
      : keybind;
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/u.test(navigator.userAgent);
    if (parsed.mod && !(mac ? event.metaKey : event.ctrlKey)) return false;
    if (parsed.ctrl && !event.ctrlKey) return false;
    if (parsed.alt && !event.altKey) return false;
    if (parsed.shift && !event.shiftKey) return false;
    return event.key.toLowerCase() === parsed.key;
  },
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
    BugIcon: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronUp: Icon,
    Copy: Icon,
    ExternalLink: Icon,
    Folder: Icon,
    Menu: Icon,
    Plus: Icon,
    Refresh: Icon,
    Search: Icon,
    Sparkles: Icon,
    Terminal: Icon,
    Trash: Icon,
    X: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
  Sidebar: (props: any) => (
    <aside data-testid="mock-sidebar" data-sidebar-width={String(props.width ?? '')} aria-label={props.ariaLabel} class={props.class}>
      {props.children}
    </aside>
  ),
  SidebarContent: (props: any) => <div data-testid="mock-sidebar-content" class={props.class}>{props.children}</div>,
  SidebarItemList: (props: any) => {
    const { children, class: className, ...rest } = props;
    return <div {...rest} class={className}>{children}</div>;
  },
  SidebarSection: (props: any) => (
    <section class={props.class}>
      <div data-testid="mock-sidebar-section-title">
        <span>{props.title}</span>
        {props.actions}
      </div>
      <div>{props.children}</div>
    </section>
  ),
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (
    <Show when={props.visible}>
      <div>{props.message}</div>
    </Show>
  ),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  LOCAL_INTERACTION_SURFACE_ATTR: 'data-floe-local-interaction-surface',
  WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR: 'data-floe-workbench-widget-activation-surface',
  Button: (props: any) => (
    <button
      type="button"
      data-testid={props['data-testid']}
      aria-label={props['aria-label']}
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
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
      class={props.class}
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
    <div
      data-testid="mock-tabs"
      data-indicator-mode={props.features?.indicator?.mode ?? ''}
      data-indicator-animated={String(props.features?.indicator?.animated ?? '')}
      data-tab-class={props.slotClassNames?.tab ?? ''}
      data-tab-active-class={props.slotClassNames?.tabActive ?? ''}
      data-tab-inactive-class={props.slotClassNames?.tabInactive ?? ''}
      data-indicator-class={props.slotClassNames?.indicator ?? ''}
    >
      {props.items.map((item: any) => (
        <span>
          <button
            type="button"
            role="tab"
            aria-selected={props.activeId === item.id ? 'true' : 'false'}
            data-terminal-tab-id={item.id}
            data-terminal-tab-active={props.activeId === item.id ? 'true' : 'false'}
            onClick={() => props.onChange?.(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
          {props.closable ? (
            <button
              type="button"
              aria-label={`Close ${item.label}`}
              data-testid={`close-session-${item.id}`}
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
    dispose = vi.fn(() => this.container.replaceChildren());
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
    write = vi.fn((_data: Uint8Array, callback?: () => void) => {
      if (callback && terminalWriteCompletionState.deferLive) {
        terminalWriteCompletionState.liveCallbacks.push(callback);
      } else {
        callback?.();
      }
    });
    writeHistory = vi.fn((data: Uint8Array, callback?: () => void) => {
      this.write(data);
      if (callback && terminalWriteCompletionState.deferHistory) {
        terminalWriteCompletionState.historyCallbacks.push(callback);
      } else {
        callback?.();
      }
    });
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
    captureRestorableSnapshot = vi.fn((options?: { coveredThroughSequence?: number }) => ({
      version: 1 as const,
      data: 'terminal snapshot',
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
    readBufferLine = vi.fn((row: number) => terminalBufferLinesState.lines.get(row) ?? '');
    getTouchScrollRuntime = vi.fn(() => ({
      scrollLines: (amount: number) => {
        scrollLinesSpy(amount);
        return true;
      },
      getScrollbackLength: () => terminalScrollState.scrollbackLength,
      isAlternateScreen: () => terminalScrollState.alternateScreen,
      sendAlternateScreenInput: (data: string) => terminalInputSpy(data, true),
    }));
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

  const createMockOutputPipeline = (options: any) => {
    createOutputPipelineSpy(options);
    let live: any[] = [];
    let inactive: any[] = [];
    let catchUp: any[] = [];
    let frame: number | null = null;
    let disposed = false;
    let catchUpPending = false;
    let lastObservedSequence = Math.max(0, Math.floor(Number(options.startSequence ?? 1)) - 1);
    let lastAppliedSequence = lastObservedSequence;
    const queuedSequences = new Set<number>();
    const catchUpSequences = new Set<number>();
    const normalizeSequence = (sequence: unknown): number | undefined => {
      const value = Math.floor(Number(sequence));
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const bytes = (chunks: any[]) => chunks.reduce((sum, chunk) => sum + (chunk.data?.byteLength ?? 0), 0);
    const clearFrame = () => {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    };
    const clearRegular = () => {
      live = [];
      inactive = [];
      queuedSequences.clear();
    };
    const clearCatchUp = () => {
      catchUp = [];
      catchUpSequences.clear();
    };
    const enqueueCatchUp = (chunk: any) => {
      const sequence = normalizeSequence(chunk.sequence);
      if (sequence && catchUpSequences.has(sequence)) return;
      const maxChunks = Math.max(1, Number(options.policy?.maxInactiveChunks ?? 256));
      const maxBytes = Math.max(1, Number(options.policy?.maxInactiveBytes ?? 512 * 1024));
      while (catchUp.length > 0 && (catchUp.length >= maxChunks || bytes(catchUp) + chunk.data.byteLength > maxBytes)) {
        const dropped = catchUp.shift();
        const droppedSequence = normalizeSequence(dropped?.sequence);
        if (droppedSequence) catchUpSequences.delete(droppedSequence);
      }
      catchUp.push(chunk);
      if (sequence) catchUpSequences.add(sequence);
    };
    const requestCatchUp = (chunk: any, sequence: number, expectedSequence: number) => {
      const pending = [...inactive, ...live];
      const droppedChunks = pending.length + 1;
      const droppedBytes = bytes(pending) + chunk.data.byteLength;
      const startSequence = lastAppliedSequence > 0 ? lastAppliedSequence + 1 : 0;
      clearFrame();
      clearRegular();
      catchUpPending = true;
      for (const pendingChunk of pending) enqueueCatchUp(pendingChunk);
      enqueueCatchUp(chunk);
      options.requestCatchUp?.({
        reason: 'sequence-gap',
        startSequence,
        expectedSequence,
        observedSequence: sequence,
        droppedChunks,
        droppedBytes,
      });
    };
    const merge = (chunks: any[]) => {
      const merged = new Uint8Array(bytes(chunks));
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk.data, offset);
        offset += chunk.data.byteLength;
      }
      return merged;
    };
    const markApplied = (chunks: any[]) => {
      for (const chunk of chunks) {
        const sequence = normalizeSequence(chunk.sequence);
        if (!sequence) continue;
        queuedSequences.delete(sequence);
        lastAppliedSequence = Math.max(lastAppliedSequence, sequence);
      }
    };
    const isInteractive = () => options.isInteractive?.() ?? true;
    const flushFrame = () => {
      frame = null;
      if (disposed || catchUpPending) return;
      if (!isInteractive()) {
        inactive.push(...live);
        live = [];
        return;
      }
      live.unshift(...inactive);
      inactive = [];
      const batch = live;
      live = [];
      const payload = merge(batch);
      if (payload.byteLength > 0) options.write(payload, batch);
      markApplied(batch);
      options.onDrain?.();
    };
    const schedule = () => {
      if (frame !== null || disposed || catchUpPending) return;
      frame = requestAnimationFrame(flushFrame);
    };
    const enqueue = (chunk: any) => {
      if (disposed) return;
      const sequence = normalizeSequence(chunk.sequence);
      const normalizedChunk = sequence ? { ...chunk, sequence } : chunk;
      if (catchUpPending) {
        enqueueCatchUp(normalizedChunk);
        return;
      }
      if (sequence) {
        if (sequence <= lastAppliedSequence || queuedSequences.has(sequence)) return;
        const expectedSequence = Math.max(lastObservedSequence, lastAppliedSequence) + 1;
        if (sequence > expectedSequence) {
          requestCatchUp(normalizedChunk, sequence, expectedSequence);
          return;
        }
        lastObservedSequence = Math.max(lastObservedSequence, sequence);
        queuedSequences.add(sequence);
      }
      if (normalizedChunk.data.byteLength === 0) {
        markApplied([normalizedChunk]);
        options.onDrain?.();
        return;
      }
      if (!isInteractive()) {
        inactive.push(normalizedChunk);
        return;
      }
      live.push(normalizedChunk);
      schedule();
    };

    return {
      enqueue,
      flush: () => {
        if (disposed || catchUpPending) return;
        if (!isInteractive()) {
          inactive.push(...live);
          live = [];
          clearFrame();
          return;
        }
        live.unshift(...inactive);
        inactive = [];
        if (live.length > 0) schedule();
        else options.onDrain?.();
      },
      reset: (resetOptions: {
        startSequence?: number;
        resumeCatchUp?: boolean;
        allowSequenceSkipOnResume?: boolean;
      } = {}) => {
        const retained = resetOptions.resumeCatchUp ? [...catchUp] : [];
        clearFrame();
        clearRegular();
        clearCatchUp();
        catchUpPending = false;
        lastObservedSequence = Math.max(0, Math.floor(Number(resetOptions.startSequence ?? 1)) - 1);
        lastAppliedSequence = lastObservedSequence;
        for (const chunk of retained) {
          const sequence = normalizeSequence(chunk.sequence);
          const expectedSequence = Math.max(lastObservedSequence, lastAppliedSequence) + 1;
          if (resetOptions.allowSequenceSkipOnResume && sequence && sequence > expectedSequence) {
            lastObservedSequence = sequence - 1;
            lastAppliedSequence = sequence - 1;
          }
          enqueue(chunk);
        }
      },
      dispose: () => {
        disposed = true;
        clearFrame();
        clearRegular();
        clearCatchUp();
        catchUpPending = false;
      },
      getStats: () => ({
        pendingChunks: live.length + catchUp.length,
        pendingBytes: bytes(live) + bytes(catchUp),
        inactiveChunks: inactive.length,
        inactiveBytes: bytes(inactive),
        catchUpChunks: catchUp.length,
        catchUpBytes: bytes(catchUp),
        catchUpPending,
        disposed,
      }),
      getDrainState: () => {
        const livePending = live.length > 0 || frame !== null;
        const inactivePending = inactive.length > 0;
        return {
          livePending,
          inactivePending,
          catchUpPending,
          drainPending: livePending || inactivePending || catchUpPending,
          disposed,
        };
      },
    };
  };

  const createMockPagedOutputCoordinator = (options: any) => {
    createOutputCoordinatorSpy(options);
    let state = 'idle';
    let active = true;
    let coveredThroughSequence = 0;
    let retained: any[] = [];
    let disposed = false;
    let generation = 0;
    let pipeline: any;
    let baselineReady = false;
    let failure: any = null;
    let baselineWaiters: Array<(value: any) => void> = [];
    let activeWriters = 0;
    let writerQuiescenceWaiters: Array<() => void> = [];

    const snapshot = () => ({
      state,
      active,
      baselineReady,
      coveredThroughSequence,
      retainedLiveChunks: retained.length,
      retainedLiveBytes: retained.reduce((sum, item) => sum + item.data.byteLength, 0),
      retryAttempt: 0,
      retryScheduled: false,
      failure,
      lastError: null,
      attachGeneration: generation,
      disposed,
    });
    const setState = (next: string) => {
      state = next;
      options.onStateChange?.(snapshot());
    };
    const resolveBaseline = () => {
      const value = snapshot();
      const waiters = baselineWaiters;
      baselineWaiters = [];
      for (const resolve of waiters) resolve(value);
    };
    const writeChunks = async (chunks: any[]) => {
      const accepted = chunks.flatMap((queuedItem) => {
        const item = queuedItem.coordinatorSequence
          ? { ...queuedItem, sequence: queuedItem.coordinatorSequence }
          : queuedItem;
        const data = options.transformChunk ? options.transformChunk(item) : item.data;
        return data === null ? [] : [{ ...item, data }];
      });
      if (accepted.length > 0) {
        const total = accepted.reduce((sum, item) => sum + item.data.byteLength, 0);
        const payload = new Uint8Array(total);
        let offset = 0;
        for (const item of accepted) {
          payload.set(item.data, offset);
          offset += item.data.byteLength;
        }
        const source = accepted[0]?.source;
        const writer = source === 'history' ? (options.writeHistory ?? options.write) : options.write;
        activeWriters += 1;
        try {
          await writer(payload, accepted);
        } finally {
          activeWriters -= 1;
          if (activeWriters === 0) {
            const waiters = writerQuiescenceWaiters;
            writerQuiescenceWaiters = [];
            for (const resolve of waiters) resolve();
          }
        }
        for (const item of accepted) {
          coveredThroughSequence = Math.max(coveredThroughSequence, item.sequence ?? 0);
        }
      }
    };
    const replay = async (startSequence: number, catchUp: boolean, run: number) => {
      const coverageAtStart = coveredThroughSequence;
      setState(catchUp ? 'catching-up' : 'initial-replay');
      const replayedSequences = new Set<number>();
      let cursor: number | string | undefined;
      let nextStart = startSequence;
      for (let pageIndex = 0; pageIndex < 4096; pageIndex += 1) {
        const page = await options.fetchPage({
          startSequence: nextStart,
          cursor,
          signal: new AbortController().signal,
        });
        if (disposed || run !== generation) return;
        if (page.firstAvailableSequence && nextStart > 0 && page.firstAvailableSequence > nextStart) {
          options.clear?.();
          options.onHistoryTruncated?.('history-evicted');
          coveredThroughSequence = page.firstAvailableSequence - 1;
        }
        const replayChunks = [...page.chunks].filter((item) => !item.sequence || item.sequence > coveredThroughSequence);
        for (const item of replayChunks) {
          if (item.sequence) replayedSequences.add(item.sequence);
        }
        await writeChunks(replayChunks);
        coveredThroughSequence = Math.max(coveredThroughSequence, page.coveredThroughSequence ?? 0);
        if (!page.hasMore) break;
        cursor = page.nextCursor;
        nextStart = coveredThroughSequence + 1;
      }
      pipeline.reset();
      const pending = retained;
      retained = [];
      const firstSequence = pending.find((item) => item.sequence)?.sequence;
      if (coveredThroughSequence === 0 && firstSequence && replayedSequences.size === 0) {
        coveredThroughSequence = firstSequence - 1;
      }
      if (catchUp && coveredThroughSequence <= coverageAtStart && pending.length > 0) {
        retained = pending;
        failure = {
          code: 'history_coverage_incomplete',
          phase: 'catch_up',
          retryable: true,
          attempt: 0,
          coveredSequence: coveredThroughSequence,
          attachGeneration: run,
        };
        setState('failed');
        return;
      }
      if (!catchUp) {
        baselineReady = true;
        resolveBaseline();
      }
      setState('live');
      for (let index = 0; index < pending.length; index += 1) {
        const item = pending[index];
        if (item.sequence && replayedSequences.has(item.sequence)) continue;
        if (item.sequence && item.sequence <= coveredThroughSequence) {
          enqueueRender(item);
        } else {
          acceptLive(item);
          if (state !== 'live') {
            retained.unshift(...pending.slice(index + 1));
            return;
          }
        }
      }
      pipeline.flush();
    };

    const enqueueRender = (item: any) => {
      const sequence = item.sequence;
      pipeline.enqueue({ ...item, sequence: undefined, coordinatorSequence: sequence });
      if (sequence) coveredThroughSequence = Math.max(coveredThroughSequence, sequence);
    };
    const acceptLive = (item: any) => {
      const sequence = item.sequence;
      if (sequence && sequence <= coveredThroughSequence) return;
      if (sequence && coveredThroughSequence > 0 && sequence > coveredThroughSequence + 1) {
        retained.push(item);
        const run = ++generation;
        void replay(coveredThroughSequence + 1, true, run);
        return;
      }
      enqueueRender(item);
    };

    pipeline = createMockOutputPipeline({
      isInteractive: () => true,
      policy: {
        maxInactiveChunks: options.policy?.maxRetainedLiveChunks,
        maxInactiveBytes: options.policy?.maxRetainedLiveBytes,
      },
      write: (_payload: Uint8Array, chunks: any[]) => writeChunks(chunks),
    });

    return {
      attach: async (startSequence = 1) => {
        const run = ++generation;
        baselineReady = false;
        failure = null;
        coveredThroughSequence = Math.max(0, startSequence - 1);
        pipeline.reset({ startSequence: coveredThroughSequence + 1 });
        await replay(startSequence, false, run);
      },
      waitForBaseline: () => {
        const value = snapshot();
        if (value.baselineReady || value.state === 'failed' || value.disposed) return Promise.resolve(value);
        return new Promise((resolve) => baselineWaiters.push(resolve));
      },
      pause: async () => {
        active = false;
        options.onStateChange?.(snapshot());
        if (activeWriters > 0) {
          await new Promise<void>((resolve) => writerQuiescenceWaiters.push(resolve));
        }
        return snapshot();
      },
      pushLive: (item: any) => {
        if (state !== 'live' || !active || !(options.isInteractive?.() ?? true)) {
          retained.push(item);
          return;
        }
        acceptLive(item);
      },
      setActive: (next: boolean) => {
        active = next;
        if (active) {
          const pending = retained;
          retained = [];
          for (const item of pending) acceptLive(item);
          pipeline.flush();
        }
        options.onStateChange?.(snapshot());
      },
      clear: (startSequence = 1) => {
        generation += 1;
        baselineReady = false;
        failure = null;
        retained = [];
        coveredThroughSequence = Math.max(0, startSequence - 1);
        pipeline.reset({ startSequence: coveredThroughSequence + 1 });
        options.clear?.();
        setState('idle');
      },
      retry: outputCoordinatorRetrySpy,
      getSnapshot: snapshot,
      dispose: () => {
        disposed = true;
        generation += 1;
        pipeline.dispose();
        setState('disposed');
      },
    };
  };

  return {
    TerminalCore: MockTerminalCore,
    createTerminalOutputPipeline: vi.fn(createMockOutputPipeline),
    createPagedTerminalOutputCoordinator: vi.fn(createMockPagedOutputCoordinator),
    getDefaultTerminalConfig: vi.fn((_theme: string, overrides?: any) => overrides ?? {}),
    getThemeColors: vi.fn(() => ({ background: '#111111', foreground: '#eeeeee' })),
  };
});

vi.mock('../services/terminalAdaptiveWorkingSet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/terminalAdaptiveWorkingSet')>();
  return {
    ...actual,
    createTerminalAdaptiveWorkingSetManager: () => ({
      register: (sessionId: string, runtime: any) => {
        terminalWorkingSetState.runtimes.set(sessionId, runtime);
        return () => terminalWorkingSetState.runtimes.delete(sessionId);
      },
      setActiveSession: (sessionId: string | null) => {
        terminalWorkingSetState.activeSessionId = sessionId;
      },
      setInteraction: (sessionId: string, interaction: string, active: boolean) => {
        const current = terminalWorkingSetState.interactions.get(sessionId) ?? new Set<string>();
        if (active) current.add(interaction);
        else current.delete(interaction);
        if (current.size > 0) terminalWorkingSetState.interactions.set(sessionId, current);
        else terminalWorkingSetState.interactions.delete(sessionId);
      },
      setPageHidden: terminalWorkingSetState.setPageHidden,
      evaluate: terminalWorkingSetState.evaluate,
      getSnapshot: () => ({
        warmBudgetBytes: 256 * 1024 * 1024,
        burstBudgetBytes: 384 * 1024 * 1024,
        snapshotBudgetBytes: 64 * 1024 * 1024,
        estimatedWarmBytes: 0,
        snapshotBytes: 0,
        pageHidden: false,
        entries: [],
      }),
      dispose: terminalWorkingSetState.dispose,
    }),
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
        can_write: terminalEnvPermissionsState.canWrite,
        can_execute: terminalEnvPermissionsState.canExecute,
      },
    }),
    { state: 'ready' },
  );

  return {
    useEnvContext: () => ({
      env: envAccessor,
      viewMode: () => envContextState.viewMode,
      openFlowerTurnLauncher: openFlowerTurnLauncherSpy,
      openTerminalInDirectoryRequestSeq: () => 0,
      openTerminalInDirectoryRequest: () => null,
      openTerminalInDirectory: vi.fn(),
      openFileBrowserAtPath: openFileBrowserAtPathSpy,
      openDebugConsole: openDebugConsoleSpy,
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
  canLaunchProcess: (permissions: { can_write?: boolean; can_execute?: boolean } | null | undefined) => (
    Boolean(permissions?.can_write && permissions?.can_execute)
  ),
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
  basenameFromAbsolutePath: (value: string) => {
    const normalized = String(value ?? '').replace(/\/+$/, '');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'File';
  },
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
const solidRenderDisposers: Array<() => void> = [];

const render: typeof solidRender = (...args) => {
  const dispose = solidRender(...args);
  solidRenderDisposers.push(dispose);
  return dispose;
};

type TestTerminalHistoryPage = {
  chunks: Array<{ sequence: number; timestampMs: number; data: Uint8Array }>;
  nextStartSeq: number;
  hasMore: boolean;
  firstSequence: number;
  lastSequence: number;
  coveredThroughSequence: number;
  snapshotEndSequence: number;
  firstRetainedSequence: number;
  historyGeneration: number;
  historyReset: boolean;
  historyTruncated: boolean;
  coveredBytes: number;
  totalBytes: number;
};

function makeTerminalHistoryPage(overrides: Partial<TestTerminalHistoryPage> = {}): TestTerminalHistoryPage {
  const lastSequence = overrides.lastSequence ?? 0;
  return {
    chunks: [],
    nextStartSeq: 0,
    hasMore: false,
    firstSequence: 0,
    lastSequence,
    coveredThroughSequence: overrides.coveredThroughSequence ?? lastSequence,
    snapshotEndSequence: overrides.snapshotEndSequence ?? lastSequence,
    firstRetainedSequence: overrides.firstRetainedSequence ?? overrides.firstSequence ?? 0,
    historyGeneration: overrides.historyGeneration ?? 1,
    historyReset: overrides.historyReset ?? false,
    historyTruncated: overrides.historyTruncated ?? false,
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
}

async function settleTerminalPanelAfterPaint() {
  await settleTerminalPanel();
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(1);
  } else {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  await settleTerminalPanel();
}

async function drainTerminalPanelAsyncWork() {
  for (let i = 0; i < 5; i += 1) {
    await settleTerminalPanelAfterPaint();
  }
}

async function waitForTerminalPanelCondition(assertion: () => void, attempts = 50) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    await settleTerminalPanelAfterPaint();
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error('Timed out waiting for terminal panel condition');
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
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-terminal-session-id]')).find((button) => button.textContent?.includes(label));
}

function findTerminalTabs(host: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-terminal-session-id]')).filter((button) => button.textContent?.includes(label));
}

function findActiveTerminalTab(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector('button[data-terminal-session-active="true"]') as HTMLButtonElement | null;
}

function findTerminalTabsRoot(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-testid="terminal-session-list"]') as HTMLElement | null;
}

function findTerminalTabStatus(host: HTMLElement, label: string, status: 'running' | 'unread' | 'none'): Element | null {
  const tab = findTerminalTab(host, label);
  return tab?.parentElement?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? tab?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? null;
}

function findTerminalRunningSpinner(host: HTMLElement, label: string): SVGElement | null {
  const tab = findTerminalTab(host, label);
  return tab?.parentElement?.querySelector<SVGElement>('[data-terminal-tab-status="running"] svg') ?? null;
}

function findPendingTerminalTabStatus(host: HTMLElement, label: string, status: 'creating' | 'failed'): Element | null {
  const tab = findTerminalTab(host, label);
  return tab?.parentElement?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? tab?.querySelector(`[data-terminal-tab-status="${status}"]`) ?? null;
}

function findTerminalWorkIndicator(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.redeven-terminal-work-indicator');
}

async function openSidebarContextMenu(host: HTMLElement, label: string): Promise<HTMLDivElement> {
  const row = findTerminalTab(host, label)?.parentElement;
  expect(row).toBeTruthy();

  row?.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 48,
    clientY: 64,
  }));
  await settleTerminalPanel();

  const menu = host.querySelector('[role="menu"]') as HTMLDivElement | null;
  expect(menu).toBeTruthy();
  return menu as HTMLDivElement;
}

function findContextMenuButton(menu: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(label)
  );
}

function setNavigatorUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
}

function dispatchTerminalKeydown(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchTerminalPointerDown(target: Element, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    isPrimary: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function installRequestAnimationFrameMock(mode: 'microtask' | 'timer' = 'microtask') {
  let nextAnimationFrameId = 0;
  const pendingAnimationFrames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextAnimationFrameId;
    pendingAnimationFrames.set(id, callback);
    const run = () => {
      const pending = pendingAnimationFrames.get(id);
      if (!pending) return;
      pendingAnimationFrames.delete(id);
      pending(0);
    };
    if (mode === 'timer') {
      setTimeout(run, 0);
    } else {
      queueMicrotask(run);
    }
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pendingAnimationFrames.delete(id);
  });
}

describe('TerminalPanel', () => {
  beforeEach(() => {
    resetDebugConsoleCaptureForTests();
    resetTerminalRecoveryDiagnosticsForTests();
    terminalPrefsState.userTheme = 'system';
    themeState.resolvedTheme = 'dark';
    terminalPrefsState.fontSize = 12;
    terminalPrefsState.fontFamilyId = 'iosevka';
    terminalPrefsState.mobileInputMode = 'floe';
    terminalPrefsState.workIndicatorEnabled = true;
    widgetState.currentWidgetId = null;
    viewActivationState.missing = false;
    viewActivationState.active = true;
    sessionStorage.clear();
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
    terminalEnvPermissionsState.canWrite = true;
    terminalEnvPermissionsState.canExecute = true;
    terminalSelectionState.text = '';
    terminalConfigState.values = [];
    terminalBufferLinesState.lines = new Map();
    terminalCoreInstances.splice(0, terminalCoreInstances.length);
    terminalWriteCompletionState.deferHistory = false;
    terminalWriteCompletionState.deferLive = false;
    terminalWriteCompletionState.historyCallbacks = [];
    terminalWriteCompletionState.liveCallbacks = [];
    createOutputPipelineSpy.mockClear();
    createOutputCoordinatorSpy.mockClear();
    outputCoordinatorRetrySpy.mockClear();
    terminalWorkingSetState.runtimes.clear();
    terminalWorkingSetState.activeSessionId = null;
    terminalWorkingSetState.interactions.clear();
    terminalWorkingSetState.setPageHidden.mockClear();
    terminalWorkingSetState.evaluate.mockClear();
    terminalWorkingSetState.dispose.mockClear();
    terminalEventSourceState.dataHandlers = new Map();
    terminalEventSourceState.nameHandlers = new Map();
    notificationMocks.error.mockClear();
    notificationMocks.info.mockClear();
    notificationMocks.success.mockClear();
    writeTextToClipboardSpy.mockClear();
    openBrowserSpy.mockClear();
    openFileBrowserAtPathSpy.mockClear();
    openFlowerTurnLauncherSpy.mockClear();
    openDebugConsoleSpy.mockClear();
    openPreviewSpy.mockClear();
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 372,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320,
    });
    setNavigatorUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
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

    installRequestAnimationFrameMock();
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

  afterEach(async () => {
    for (const dispose of solidRenderDisposers.splice(0).reverse()) {
      dispose();
    }
    await drainTerminalPanelAsyncWork();
    document.body.innerHTML = '';
    layoutState.mobile = false;
    terminalEnvPermissionsState.canRead = true;
    terminalEnvPermissionsState.canWrite = true;
    terminalEnvPermissionsState.canExecute = true;
    vi.useRealTimers();
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
    vi.unstubAllGlobals();
  });

  it('does not expose a general terminal with execute-only permission', () => {
    terminalEnvPermissionsState.canWrite = false;
    terminalEnvPermissionsState.canExecute = true;

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);

    expect(host.textContent).toContain('Permission denied');
    expect(sessionsCoordinatorMocks.refresh).not.toHaveBeenCalled();
  });

  it('keeps an empty terminal panel on the system loading surface until sessions hydrate', async () => {
    terminalSessionsState.sessions = [];
    const refreshGate: { resolve?: () => void } = {};
    sessionsCoordinatorMocks.refresh.mockImplementationOnce(async () => (
      await new Promise<void>((resolve) => {
        refreshGate.resolve = resolve;
      })
    ));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);

    const loadingCurtain = host.querySelector('.redeven-loading-curtain') as HTMLElement | null;
    expect(loadingCurtain).toBeTruthy();
    expect(loadingCurtain?.classList.contains('redeven-terminal-loading-curtain')).toBe(false);
    expect(loadingCurtain?.getAttribute('data-redeven-loading-curtain-stage')).toBe('sessions');
    expect(loadingCurtain?.textContent).toContain('Loading sessions...');
    expect(loadingCurtain?.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Loading sessions...');
    expect(host.textContent).not.toContain('No terminal sessions yet');

    await settleTerminalPanel();
    expect(sessionsCoordinatorMocks.refresh).toHaveBeenCalledTimes(1);

    expect(refreshGate.resolve).toBeTruthy();
    refreshGate.resolve?.();
    await settleTerminalPanel();

    expect(host.querySelector('.redeven-loading-curtain')).toBeNull();
    expect(host.textContent).toContain('No terminal sessions yet');
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

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanelAfterPaint();

    expect(terminalCoreInstances.length).toBeGreaterThan(0);
    expect(host.textContent).toContain('Terminal 1');
  });

  it('renders terminal sidebar items with directory title, avatar initial, path text, and separate actions', async () => {
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/redeven',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const tab = findTerminalTab(host, 'Terminal 1');
    expect(tab).toBeTruthy();
    expect(tab?.className).toContain('cursor-pointer');
    expect(tab?.getAttribute('title')).toBe('/workspace/redeven');
    const row = tab?.parentElement;
    expect(row?.textContent).toContain('redeven');
    const avatar = row?.querySelector<HTMLElement>('[data-terminal-session-avatar="session-1"]');
    expect(avatar?.textContent).toContain('R');
    expect(avatar?.getAttribute('style')).toContain('color-mix');

    const pathText = host.querySelector<HTMLElement>('[data-testid="terminal-session-path-session-1"]');
    expect(pathText).toBeTruthy();
    expect(pathText?.tagName).toBe('SPAN');
    expect(pathText?.textContent).toContain('/workspace/redeven');
    expect(pathText?.getAttribute('title')).toBe('/workspace/redeven');
    expect(pathText?.className).not.toContain('underline');
    expect(pathText?.className).toContain('pointer-events-none');
    expect(pathText?.className).toContain('cursor-pointer');
    expect(host.querySelector('[data-testid="terminal-session-path-copy-session-1"]')?.className).toContain('cursor-pointer');
    expect(host.querySelector('[data-testid="terminal-session-files-session-1"]')?.className).toContain('cursor-pointer');
    expect(host.querySelector('[data-testid="close-session-session-1"]')?.className).toContain('cursor-pointer');
    expect(host.querySelector('[data-testid="terminal-sidebar-add-session"]')?.className).toContain('cursor-pointer');
    expect(host.querySelector('[data-testid="terminal-sidebar-refresh"]')?.className).toContain('cursor-pointer');
  });

  it('previews and commits sidebar selection from the path click-through area before mounting the terminal', async () => {
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/alpha',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
      {
        id: 'session-2',
        name: 'Terminal 2',
        workingDir: '/workspace/beta',
        createdAtMs: 2,
        isActive: false,
        lastActiveAtMs: 20,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const pathText = host.querySelector<HTMLElement>('[data-testid="terminal-session-path-session-2"]');
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="session-2"]');
    expect(pathText).toBeTruthy();
    expect(pathText?.className).toContain('pointer-events-none');
    expect(rowButton).toBeTruthy();
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');
    expect(terminalCoreInstances).toHaveLength(1);

    dispatchTerminalPointerDown(rowButton!);

    expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('true');
    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-1');
    expect(terminalCoreInstances).toHaveLength(1);
    expect(transportMocks.attach.mock.calls.every((call) => call[0] !== 'session-2')).toBe(true);
    expect(openFileBrowserAtPathSpy).not.toHaveBeenCalled();
    expect(writeTextToClipboardSpy).not.toHaveBeenCalled();

    rowButton?.click();
    await settleTerminalPanel();

    expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('true');
    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-2');
    expect(host.querySelector('[data-terminal-deferred-surface="true"]')).toBeTruthy();
    expect(terminalCoreInstances).toHaveLength(1);

    await settleTerminalPanelAfterPaint();

    expect(host.querySelector('[data-terminal-deferred-surface="true"]')).toBeNull();
    expect(terminalCoreInstances).toHaveLength(2);
  });

  it('copies the sidebar path from the copy action without switching terminal sessions', async () => {
    vi.useFakeTimers();
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/alpha',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
      {
        id: 'session-2',
        name: 'Terminal 2',
        workingDir: '/workspace/beta',
        createdAtMs: 2,
        isActive: false,
        lastActiveAtMs: 20,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');

    const copyButton = host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-path-copy-session-2"]');
    expect(copyButton).toBeTruthy();
    expect(copyButton?.getAttribute('title')).toBe('Copy path');

    copyButton?.click();
    await settleTerminalPanel();

    expect(writeTextToClipboardSpy).toHaveBeenCalledWith('/workspace/beta');
    expect(openFileBrowserAtPathSpy).not.toHaveBeenCalled();
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');
    expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('false');
    expect(copyButton?.getAttribute('title')).toBe('Path copied');

    await vi.advanceTimersByTimeAsync(1500);
    await settleTerminalPanel();

    expect(copyButton?.getAttribute('title')).toBe('Copy path');
  });

  it('reports a copy failure when the sidebar path copy action cannot write to the clipboard', async () => {
    writeTextToClipboardSpy.mockRejectedValueOnce(new Error('clipboard denied'));
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/redeven',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-path-copy-session-1"]')?.click();
    await settleTerminalPanel();

    expect(notificationMocks.error).toHaveBeenCalledWith('Copy failed', 'clipboard denied');
  });

  it('opens files from the sidebar files action without switching terminal sessions', async () => {
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/alpha',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
      {
        id: 'session-2',
        name: 'Terminal 2',
        workingDir: '/workspace/beta',
        createdAtMs: 2,
        isActive: false,
        lastActiveAtMs: 20,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-files-session-2"]')?.click();
    await settleTerminalPanel();

    expect(openFileBrowserAtPathSpy).toHaveBeenCalledWith('/workspace/beta', {
      homePath: '/workspace',
      title: 'beta',
      openStrategy: undefined,
    });
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');
    expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('false');
  });

  it('keeps a running sidebar spinner mounted when sidebar actions update row state', async () => {
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/alpha',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
      {
        id: 'session-2',
        name: 'Terminal 2',
        workingDir: '/workspace/beta',
        createdAtMs: 2,
        isActive: false,
        lastActiveAtMs: 20,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    const runningSpinner = findTerminalRunningSpinner(host, 'Terminal 2');
    expect(runningSpinner).not.toBeNull();

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-path-copy-session-2"]')?.click();
    await settleTerminalPanel();

    expect(writeTextToClipboardSpy).toHaveBeenCalledWith('/workspace/beta');
    expect(findTerminalRunningSpinner(host, 'Terminal 2')).toBe(runningSpinner);
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-files-session-2"]')?.click();
    await settleTerminalPanel();

    expect(openFileBrowserAtPathSpy).toHaveBeenCalledWith('/workspace/beta', {
      homePath: '/workspace',
      title: 'beta',
      openStrategy: undefined,
    });
    expect(findTerminalRunningSpinner(host, 'Terminal 2')).toBe(runningSpinner);
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');
  });

  it('deletes an inactive sidebar session without switching terminal sessions first', async () => {
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/alpha',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
      {
        id: 'session-2',
        name: 'Terminal 2',
        workingDir: '/workspace/beta',
        createdAtMs: 2,
        isActive: false,
        lastActiveAtMs: 20,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const closeButton = host.querySelector<HTMLButtonElement>('[data-testid="close-session-session-2"]');
    expect(closeButton).toBeTruthy();

    closeButton?.click();
    await settleTerminalPanel();

    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');
    expect(findTerminalTab(host, 'Terminal 2')).toBeUndefined();
    expect(sessionsCoordinatorMocks.deleteSession).not.toHaveBeenCalled();

    await settleTerminalPanelAfterPaint();

    expect(sessionsCoordinatorMocks.deleteSession).toHaveBeenCalledWith('session-2');
  });

  it('opens files as a new workbench file browser surface from the sidebar files action', async () => {
    envContextState.viewMode = 'workbench';
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/redeven',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-files-session-1"]')?.click();
    await settleTerminalPanel();

    expect(openFileBrowserAtPathSpy).toHaveBeenCalledWith('/workspace/redeven', {
      homePath: '/workspace',
      title: 'redeven',
      openStrategy: 'create_new',
    });
  });

  it('shows the terminal path without a browse action when files cannot be read', async () => {
    terminalEnvPermissionsState.canRead = false;
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/redeven',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    expect(host.querySelector('[data-testid="terminal-session-files-session-1"]')).toBeNull();
    expect(host.querySelector('[data-terminal-session-path="session-1"]')?.textContent).toContain('/workspace/redeven');
    expect(host.querySelector('[data-testid="terminal-session-path-copy-session-1"]')).toBeTruthy();
    expect(host.querySelector('[data-terminal-session-path="session-1"]')?.className).toContain('pointer-events-none');

    expect(openFileBrowserAtPathSpy).not.toHaveBeenCalled();

    const menu = await openSidebarContextMenu(host, 'Terminal 1');
    const filesButton = findContextMenuButton(menu, 'Files');
    expect(filesButton).toBeTruthy();
    expect(filesButton?.disabled).toBe(true);
  });

  it('opens sidebar context menu actions for the targeted terminal session', async () => {
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/alpha',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
      {
        id: 'session-2',
        name: 'Terminal 2',
        workingDir: '/workspace/beta',
        createdAtMs: 2,
        isActive: false,
        lastActiveAtMs: 20,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const firstMenu = await openSidebarContextMenu(host, 'Terminal 2');
    expect(Array.from(firstMenu.querySelectorAll('button')).map((button) => button.textContent?.trim())).toEqual([
      'Files',
      'Duplicate session',
      'Clear terminal content',
      'Ask Flower',
      'Delete session',
    ]);
    expect(firstMenu.querySelectorAll('[role="separator"]')).toHaveLength(1);

    findContextMenuButton(firstMenu, 'Files')?.click();
    await settleTerminalPanel();

    expect(openFileBrowserAtPathSpy).toHaveBeenCalledWith('/workspace/beta', {
      homePath: '/workspace',
      title: 'beta',
      openStrategy: undefined,
    });
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');

    const clearMenu = await openSidebarContextMenu(host, 'Terminal 2');
    findContextMenuButton(clearMenu, 'Clear terminal content')?.click();
    await settleTerminalPanel();

    expect(transportMocks.clear).toHaveBeenCalledWith('session-2');
    expect(transportMocks.sendInput).toHaveBeenCalledWith('session-2', '\r', 'conn-1');
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');

    const askMenu = await openSidebarContextMenu(host, 'Terminal 2');
    findContextMenuButton(askMenu, 'Ask Flower')?.click();
    await settleTerminalPanel();

    expect(openFlowerTurnLauncherSpy).toHaveBeenCalledTimes(1);
    expect(openFlowerTurnLauncherSpy.mock.calls[0]?.[0]).toMatchObject({
      source_surface: 'terminal',
      suggested_working_dir: '/workspace/beta',
      context_items: [
        {
          kind: 'terminal_selection',
          working_dir: '/workspace/beta',
          selection: '',
          selection_chars: 0,
        },
      ],
      context_action: {
        context: [
          {
            kind: 'terminal_selection',
            working_dir: '/workspace/beta',
            selection: '',
            selection_chars: 0,
          },
        ],
      },
    });

    const deleteMenu = await openSidebarContextMenu(host, 'Terminal 2');
    findContextMenuButton(deleteMenu, 'Delete session')?.click();
    await settleTerminalPanelAfterPaint();

    expect(sessionsCoordinatorMocks.deleteSession).toHaveBeenCalledWith('session-2');
  });

  it('duplicates a terminal session from the sidebar context menu using the target path', async () => {
    terminalSessionsState.sessions = [
      {
        id: 'session-1',
        name: 'Terminal 1',
        workingDir: '/workspace/redeven',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const menu = await openSidebarContextMenu(host, 'Terminal 1');
    findContextMenuButton(menu, 'Duplicate session')?.click();
    await settleTerminalPanelAfterPaint();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledWith('redeven', '/workspace/redeven');
  });

  it('disables clear and duplicate actions for pending sidebar terminal sessions', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-sidebar-add-session"]')?.click();
    await settleTerminalPanel();

    const menu = await openSidebarContextMenu(host, 'Terminal 2');
    expect(findContextMenuButton(menu, 'Duplicate session')?.disabled).toBe(true);
    expect(findContextMenuButton(menu, 'Clear terminal content')?.disabled).toBe(true);
  });

  it('configures TerminalCore with focus-triggered remote resize handoff enabled', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanelAfterPaint();

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

  it('uses the upstream paged output coordinator for activity panels', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanelAfterPaint();

    expect(createOutputCoordinatorSpy).toHaveBeenCalledTimes(1);
    expect(createOutputCoordinatorSpy.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      policy: expect.objectContaining({
        maxRetainedLiveChunks: 2048,
        maxRetainedLiveBytes: 8 * 1024 * 1024,
      }),
    }));
  });

  it('blocks initial input until the terminal parser commits the history baseline', async () => {
    terminalWriteCompletionState.deferHistory = true;
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      chunks: [{ sequence: 1, timestampMs: 10, data: textEncoder.encode('ready') }],
      firstSequence: 1,
      lastSequence: 1,
      coveredBytes: 5,
      totalBytes: 5,
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(terminalCoreInstances[0]?.writeHistory).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    transportMocks.sendInput.mockClear();
    core?.handlers?.onData?.('before-baseline\r');
    expect(transportMocks.sendInput).not.toHaveBeenCalled();

    terminalWriteCompletionState.historyCallbacks.shift()?.();
    await waitForTerminalPanelCondition(() => {
      expect(host.querySelector('[data-testid="terminal-status-bar"]')).toBeTruthy();
    });
    core?.handlers?.onData?.('after-baseline\r');
    expect(transportMocks.sendInput).toHaveBeenCalledWith('session-1', 'after-baseline\r', 'conn-1');
  });

  it('does not steal focus when another control takes focus before baseline commit', async () => {
    terminalWriteCompletionState.deferHistory = true;
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      chunks: [{ sequence: 1, timestampMs: 10, data: textEncoder.encode('ready') }],
      firstSequence: 1,
      lastSequence: 1,
      coveredBytes: 5,
      totalBytes: 5,
    }));
    const host = document.createElement('div');
    const otherControl = document.createElement('button');
    otherControl.textContent = 'Other control';
    document.body.append(host, otherControl);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(terminalCoreInstances[0]?.writeHistory).toHaveBeenCalledTimes(1);
    });

    focusSpy.mockClear();
    otherControl.focus();
    terminalWriteCompletionState.historyCallbacks.shift()?.();
    await settleTerminalPanelAfterPaint();

    expect(document.activeElement).toBe(otherControl);
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('gates panel-level focus restoration on the committed history baseline', async () => {
    terminalWriteCompletionState.deferHistory = true;
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      chunks: [{ sequence: 1, timestampMs: 10, data: textEncoder.encode('ready') }],
      firstSequence: 1,
      lastSequence: 1,
      coveredBytes: 5,
      totalBytes: 5,
    }));
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
    await waitForTerminalPanelCondition(() => {
      expect(terminalCoreInstances[0]?.writeHistory).toHaveBeenCalledTimes(1);
    });

    focusSpy.mockClear();
    (host as HTMLElement & { bumpWorkbenchActivation?: () => void }).bumpWorkbenchActivation?.();
    await settleTerminalPanelAfterPaint();
    expect(focusSpy).not.toHaveBeenCalled();

    terminalWriteCompletionState.historyCallbacks.shift()?.();
    await settleTerminalPanelAfterPaint();
    focusSpy.mockClear();
    (host as HTMLElement & { bumpWorkbenchActivation?: () => void }).bumpWorkbenchActivation?.();
    await settleTerminalPanelAfterPaint();
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps input available during background recovery and exposes manual retry after failure', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanelAfterPaint();

    const coordinatorOptions = createOutputCoordinatorSpy.mock.calls[0]?.[0];
    expect(coordinatorOptions).toBeTruthy();
    const baseSnapshot = {
      active: true,
      baselineReady: true,
      coveredThroughSequence: 4,
      retainedLiveChunks: 1,
      retainedLiveBytes: 12,
      retryAttempt: 1,
      retryScheduled: true,
      failure: {
        code: 'history_fetch_failed',
        phase: 'catch_up',
        retryable: true,
        attempt: 1,
        coveredSequence: 4,
        attachGeneration: 1,
      },
      lastError: null,
      disposed: false,
    };
    coordinatorOptions.onStateChange?.({ ...baseSnapshot, state: 'retry-wait' });
    expect(host.textContent).not.toContain('Syncing earlier output...');
    transportMocks.sendInput.mockClear();
    terminalCoreInstances[0]?.handlers?.onData?.('echo still-live\r');
    expect(transportMocks.sendInput).toHaveBeenCalledWith('session-1', 'echo still-live\r', 'conn-1');

    coordinatorOptions.onStateChange?.({
      ...baseSnapshot,
      state: 'failed',
      retryScheduled: false,
      failure: {
        code: 'history_fetch_failed',
        phase: 'catch_up',
        retryable: true,
        attempt: 3,
        coveredSequence: 4,
        attachGeneration: 1,
      },
      lastError: new Error('history temporarily unavailable'),
    });
    await settleTerminalPanel();

    expect(host.textContent).toContain('Some earlier output could not be restored.');
    expect(host.textContent).not.toContain('history temporarily unavailable');
    const recoveryMessage = host.querySelector('[data-testid="terminal-recovery-status-message"]');
    const recoveryActions = host.querySelector('[data-testid="terminal-recovery-status-actions"]');
    expect(recoveryMessage?.classList.contains('truncate')).toBe(true);
    expect(recoveryActions?.classList.contains('min-w-max')).toBe(true);
    expect(recoveryMessage?.contains(recoveryActions)).toBe(false);
    const retryButton = host.querySelector<HTMLButtonElement>('button[aria-label="Retry"]');
    expect(retryButton).toBeTruthy();

    const diagnosticsButton = host.querySelector<HTMLButtonElement>('button[aria-label="Diagnostics"]');
    expect(diagnosticsButton).toBeTruthy();
    diagnosticsButton?.click();
    expect(openDebugConsoleSpy).toHaveBeenCalledWith({
      query: expect.stringMatching(/^terminal-\d+ \d+ history_fetch_failed$/u),
    });

    retryButton?.click();
    expect(outputCoordinatorRetrySpy).toHaveBeenCalledTimes(1);
  });

  it('rebuilds a ready terminal after a blocking core failure', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanelAfterPaint();

    const failedCore = terminalCoreInstances[0];
    failedCore?.handlers?.onError?.(new Error('renderer failed'));
    await settleTerminalPanel();

    expect(host.textContent).toContain('This terminal could not be restored.');
    expect(getDebugConsoleClientEventRingSnapshot().events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'terminal_recovery',
        kind: 'blocking',
        detail: expect.objectContaining({ error_code: 'terminal_unavailable' }),
      }),
    ]));

    host.querySelector<HTMLButtonElement>('button[aria-label="Retry"]')?.click();
    await waitForTerminalPanelCondition(() => {
      expect(terminalCoreInstances.length).toBe(2);
    });
    expect(failedCore?.dispose).toHaveBeenCalledTimes(1);
    expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
  });

  it('keeps blocking recovery actions visible above the Floe mobile keyboard', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanelAfterPaint();

    terminalCoreInstances[0]?.handlers?.onError?.(new Error('renderer failed'));
    await settleTerminalPanel();

    expect(host.querySelector('[data-testid="mobile-keyboard"]')).toBeTruthy();
    const statusBar = host.querySelector('[data-testid="terminal-status-bar"]');
    expect(statusBar?.classList.contains('h-11')).toBe(true);
    expect(statusBar?.textContent).toContain('This terminal could not be restored.');
    expect(host.querySelector('button[aria-label="Retry"]')?.classList.contains('size-7')).toBe(true);
    expect(host.querySelector('button[aria-label="Diagnostics"]')?.classList.contains('size-7')).toBe(true);
  });

  it('keeps activity input live while the upstream output pipeline has inactive backlog', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanelAfterPaint();

    const core = terminalCoreInstances[0];
    expect(core).toBeDefined();

    viewActivationState.active = false;
    emitTerminalData('session-1', 'background output', 1);
    await settleTerminalPanel();

    viewActivationState.active = true;
    transportMocks.sendInput.mockClear();
    core?.handlers?.onData?.('echo __rdv_after_return__\r');

    expect(transportMocks.sendInput).toHaveBeenCalledWith(
      'session-1',
      'echo __rdv_after_return__\r',
      'conn-1',
    );
  });

  it('keeps history pages independent from previously committed live output', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanelAfterPaint();

    const coordinatorOptions = createOutputCoordinatorSpy.mock.calls[0]?.[0];
    const core = terminalCoreInstances[0];
    expect(coordinatorOptions).toBeTruthy();
    core?.write.mockClear();

    for (let sequence = 1; sequence <= 256; sequence += 1) {
      emitTerminalData('session-1', `live-${sequence}`, sequence);
      await settleTerminalPanelAfterPaint();
    }
    expect(core?.write).toHaveBeenCalledTimes(256);

    transportMocks.historyPage.mockResolvedValueOnce(makeTerminalHistoryPage({
      chunks: [{ sequence: 1, timestampMs: 10, data: textEncoder.encode('history-one') }],
      firstSequence: 1,
      lastSequence: 1,
      coveredBytes: 11,
      totalBytes: 11,
    }));
    const page = await coordinatorOptions.fetchPage({
      startSequence: 1,
      cursor: 1,
      signal: new AbortController().signal,
    });

    expect(page.chunks).toHaveLength(1);
    expect(page.chunks[0]?.data.byteLength).toBe(11);
    expect(textDecoder.decode(page.chunks[0]?.data)).toBe('history-one');
    expect(page.chunks[0]).not.toHaveProperty('pretransformed');
  });

  it('does not replay sparse initial history again before the next activity output', async () => {
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      chunks: [
        { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-a ') },
        { sequence: 4, timestampMs: 20, data: textEncoder.encode('history-b') },
      ],
      firstSequence: 2,
      lastSequence: 4,
      coveredBytes: 19,
      totalBytes: 19,
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
      expect(terminalCoreInstances[0]?.write).toHaveBeenCalled();
    });

    const core = terminalCoreInstances[0];
    core?.write.mockClear();

    emitTerminalData('session-1', 'live-c', 5);
    await drainTerminalPanelAsyncWork();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['live-c']);
  });

  it('uses filtered empty history metadata as the next activity sequence baseline', async () => {
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      lastSequence: 4,
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    core?.write.mockClear();
    emitTerminalData('session-1', 'live-five', 5);
    await drainTerminalPanelAsyncWork();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['live-five']);
  });

  it('advances the activity sequence baseline across sparse history pages', async () => {
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage.mockImplementation((_id: string, cursor: number) => {
      if (cursor === 0) {
        return Promise.resolve(makeTerminalHistoryPage({
          chunks: [
            { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-two ') },
          ],
          nextStartSeq: 4,
          hasMore: true,
          firstSequence: 2,
          lastSequence: 2,
          coveredBytes: 12,
          totalBytes: 24,
        }));
      }
      return Promise.resolve(makeTerminalHistoryPage({
        chunks: [
          { sequence: 4, timestampMs: 20, data: textEncoder.encode('history-four') },
        ],
        firstSequence: 4,
        lastSequence: 4,
        coveredBytes: 12,
        totalBytes: 24,
      }));
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage.mock.calls).toEqual([
        ['session-1', 0, -1],
        ['session-1', 4, -1],
      ]);
    });

    const core = terminalCoreInstances[0];
    core?.write.mockClear();
    emitTerminalData('session-1', 'live-five', 5);
    await drainTerminalPanelAsyncWork();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['live-five']);
  });

  it('accepts a non-one first activity sequence when initial history is empty', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    core?.write.mockClear();
    emitTerminalData('session-1', 'continued-session', 37);
    await drainTerminalPanelAsyncWork();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['continued-session']);
  });

  it('accepts a continued activity sequence after clearing history', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();

    const core = terminalCoreInstances[0];
    emitTerminalData('session-1', 'before-clear', 1);
    await drainTerminalPanelAsyncWork();

    core?.write.mockClear();
    host.querySelector<HTMLButtonElement>('button[title="Clear"]')?.click();
    await settleTerminalPanel();
    expect(transportMocks.clear).toHaveBeenCalledWith('session-1');

    emitTerminalData('session-1', 'after-clear', 37);
    await drainTerminalPanelAsyncWork();

    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['after-clear']);
  });

  it('settles sparse activity catchup at the history coverage boundary', async () => {
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage
      .mockResolvedValueOnce(makeTerminalHistoryPage({
        chunks: [
          { sequence: 1, timestampMs: 5, data: textEncoder.encode('initial ') },
        ],
        firstSequence: 1,
        lastSequence: 1,
        coveredBytes: 8,
        totalBytes: 8,
      }))
      .mockResolvedValueOnce(makeTerminalHistoryPage({
        chunks: [
          { sequence: 2, timestampMs: 10, data: textEncoder.encode('missing ') },
          { sequence: 5, timestampMs: 20, data: textEncoder.encode('after-gap') },
        ],
        firstSequence: 2,
        lastSequence: 5,
        coveredBytes: 17,
        totalBytes: 17,
      }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    core?.write.mockClear();
    emitTerminalData('session-1', 'after-gap', 5);

    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
      expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toContain('missing after-gap');
    });

    core?.write.mockClear();
    emitTerminalData('session-1', 'live-six', 6);
    await drainTerminalPanelAsyncWork();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['live-six']);
  });

  it('keeps the gap-triggering activity output when sparse catchup cannot replay it', async () => {
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage
      .mockResolvedValueOnce(makeTerminalHistoryPage({
        chunks: [
          { sequence: 1, timestampMs: 5, data: textEncoder.encode('initial ') },
        ],
        firstSequence: 1,
        lastSequence: 1,
        coveredBytes: 8,
        totalBytes: 8,
      }))
      .mockResolvedValue(makeTerminalHistoryPage({
        chunks: [
          { sequence: 2, timestampMs: 10, data: textEncoder.encode('missing') },
        ],
        firstSequence: 2,
        lastSequence: 4,
        coveredBytes: 7,
        totalBytes: 7,
      }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    core?.write.mockClear();
    emitTerminalData('session-1', 'after-gap', 5);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    });

    emitTerminalData('session-1', 'live-six', 6);
    await drainTerminalPanelAsyncWork();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual([
      'missing',
      'after-gap',
      'live-six',
    ]);
  });

  it('keeps sparse live output below the history coverage high-water without replaying covered live chunks', async () => {
    let releaseCatchupPage: (page: TestTerminalHistoryPage) => void = () => {};
    const catchupPage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseCatchupPage = resolve;
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage
      .mockResolvedValueOnce(makeTerminalHistoryPage({
        chunks: [
          { sequence: 1, timestampMs: 5, data: textEncoder.encode('initial ') },
        ],
        firstSequence: 1,
        lastSequence: 1,
        coveredBytes: 8,
        totalBytes: 8,
      }))
      .mockReturnValueOnce(catchupPage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    core?.write.mockClear();
    emitTerminalData('session-1', 'live-five', 5);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    });

    emitTerminalData('session-1', 'covered-live-six', 6);
    releaseCatchupPage(makeTerminalHistoryPage({
      chunks: [
        { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-two ') },
        { sequence: 6, timestampMs: 20, data: textEncoder.encode('history-six') },
      ],
      firstSequence: 2,
      lastSequence: 6,
      coveredBytes: 23,
      totalBytes: 23,
    }));
    await drainTerminalPanelAsyncWork();

    emitTerminalData('session-1', 'live-seven', 7);
    await drainTerminalPanelAsyncWork();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual([
      'history-two history-six',
      'live-five',
      'live-seven',
    ]);
  });

  it('does not reuse dropped catchup sequences after the output pipeline drains', async () => {
    let releaseFirstCatchupPage: (page: TestTerminalHistoryPage) => void = () => {};
    const firstCatchupPage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseFirstCatchupPage = resolve;
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage
      .mockResolvedValueOnce(makeTerminalHistoryPage({
        chunks: [
          { sequence: 1, timestampMs: 5, data: textEncoder.encode('initial') },
        ],
        firstSequence: 1,
        lastSequence: 1,
        coveredBytes: 7,
        totalBytes: 7,
      }))
      .mockReturnValueOnce(firstCatchupPage)
      .mockResolvedValue(makeTerminalHistoryPage({
        chunks: [
          { sequence: 265, timestampMs: 265, data: textEncoder.encode('missing-265') },
          { sequence: 266, timestampMs: 266, data: textEncoder.encode('live-266') },
        ],
        firstSequence: 265,
        lastSequence: 266,
        coveredBytes: 22,
        totalBytes: 22,
      }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    emitTerminalData('session-1', 'live-5', 5);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledWith('session-1', 2, -1);
    });
    for (let sequence = 6; sequence <= 264; sequence += 1) {
      emitTerminalData('session-1', `live-${sequence}`, sequence);
    }

    releaseFirstCatchupPage(makeTerminalHistoryPage({
      chunks: [
        { sequence: 2, timestampMs: 2, data: textEncoder.encode('history-2 ') },
        { sequence: 264, timestampMs: 264, data: textEncoder.encode('history-264') },
      ],
      firstSequence: 2,
      lastSequence: 264,
      coveredBytes: 24,
      totalBytes: 24,
    }));
    await drainTerminalPanelAsyncWork();

    emitTerminalData('session-1', 'live-266', 266);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledWith('session-1', 265, -1);
    });

    expect(transportMocks.historyPage.mock.calls).not.toContainEqual(['session-1', 5, -1]);
  });

  it('deduplicates activity live output buffered during sparse history replay', async () => {
    let releaseHistoryPage: (page: TestTerminalHistoryPage) => void = () => {};
    const historyPage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseHistoryPage = resolve;
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage.mockReturnValueOnce(historyPage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    emitTerminalData('session-1', 'duplicate-four', 4);
    emitTerminalData('session-1', 'fresh-five', 5);
    releaseHistoryPage(makeTerminalHistoryPage({
      chunks: [
        { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-two ') },
        { sequence: 4, timestampMs: 20, data: textEncoder.encode('duplicate-four') },
      ],
      firstSequence: 2,
      lastSequence: 4,
      coveredBytes: 26,
      totalBytes: 26,
    }));

    await waitForTerminalPanelCondition(() => {
      expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toContain('fresh-five');
    });

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual([
      'history-two duplicate-four',
      'fresh-five',
    ]);
  });

  it('keeps buffered activity live output below the initial history high-water', async () => {
    let releaseHistoryPage: (page: TestTerminalHistoryPage) => void = () => {};
    const historyPage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseHistoryPage = resolve;
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage.mockReturnValueOnce(historyPage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    emitTerminalData('session-1', 'live-five', 5);
    emitTerminalData('session-1', 'covered-live-six', 6);
    releaseHistoryPage(makeTerminalHistoryPage({
      chunks: [
        { sequence: 2, timestampMs: 10, data: textEncoder.encode('history-two ') },
        { sequence: 6, timestampMs: 20, data: textEncoder.encode('history-six') },
      ],
      firstSequence: 2,
      lastSequence: 6,
      coveredBytes: 23,
      totalBytes: 23,
    }));

    await waitForTerminalPanelCondition(() => {
      expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toContain('live-five');
    });

    emitTerminalData('session-1', 'live-seven', 7);
    await drainTerminalPanelAsyncWork();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual([
      'history-two history-six',
      'live-five',
      'live-seven',
    ]);
  });

  it('advances activity coverage for shell integration output with no display bytes', async () => {
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({ lastSequence: 4 }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    core?.write.mockClear();
    sessionsCoordinatorMocks.updateSessionMeta.mockClear();
    emitTerminalData('session-1', '\x1b]633;P;Cwd=/workspace/repo\u0007', 5);
    emitTerminalData('session-1', 'live-six', 6);
    await drainTerminalPanelAsyncWork();

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(sessionsCoordinatorMocks.updateSessionMeta).toHaveBeenCalledTimes(1);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['live-six']);
  });

  it('runs buffered activity catchup after loading settles and keeps input live', async () => {
    let releaseInitialHistoryPage: (page: TestTerminalHistoryPage) => void = () => {};
    const initialHistoryPage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseInitialHistoryPage = resolve;
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage
      .mockReturnValueOnce(initialHistoryPage)
      .mockResolvedValue(makeTerminalHistoryPage({
        chunks: [
          { sequence: 2, timestampMs: 10, data: textEncoder.encode('missing ') },
          { sequence: 3, timestampMs: 20, data: textEncoder.encode('after-gap') },
        ],
        firstSequence: 2,
        lastSequence: 3,
        coveredBytes: 17,
        totalBytes: 17,
      }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    expect(core).toBeDefined();
    emitTerminalData('session-1', 'after-gap', 3);
    await settleTerminalPanel();

    releaseInitialHistoryPage(makeTerminalHistoryPage({
      chunks: [
        { sequence: 1, timestampMs: 5, data: textEncoder.encode('initial ') },
      ],
      firstSequence: 1,
      lastSequence: 1,
      coveredBytes: 8,
      totalBytes: 8,
    }));

    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    });
    await waitForTerminalPanelCondition(() => {
      expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toContain('missing after-gap');
    });

    transportMocks.sendInput.mockClear();
    core?.handlers?.onData?.('echo __rdv_after_catchup__\r');

    expect(transportMocks.sendInput).toHaveBeenCalledWith(
      'session-1',
      'echo __rdv_after_catchup__\r',
      'conn-1',
    );
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
    expect(createOutputCoordinatorSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps workbench projected surfaces out of terminal render scale', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, lightHost);
    await settleTerminalPanel();

    expect(findTerminalWorkIndicator(lightHost)?.dataset.terminalWorkTheme).toBe('light');

    themeState.resolvedTheme = 'dark';
    terminalPrefsState.userTheme = 'light';
    const darkHost = document.createElement('div');
    document.body.appendChild(darkHost);

    render(() => <TerminalPanel variant="workbench" />, darkHost);
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
    await settleTerminalPanelAfterPaint();

    expect(terminalConfigState.values[0]?.fontSize).toBe(14);
    expect(terminalCoreInstances[0]?.setFontSize).toHaveBeenCalledWith(14);
    expect(terminalCoreInstances[0]?.setFontFamily).toHaveBeenCalledWith(expect.stringContaining('JetBrains Mono'));
  });

  it('uses the explicit floeterm font-family API instead of mutating terminal internals directly', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
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
    await settleTerminalPanelAfterPaint();

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
        variant="workbench"
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

    const workbenchHost = document.createElement('div');
    document.body.appendChild(workbenchHost);
    render(() => (
      <TerminalPanel
        variant="workbench"
        openSessionRequest={{
          requestId: 'request-workbench',
          workingDir: '/workspace/repo',
          preferredName: 'repo',
          targetMode: 'workbench',
        }}
        onOpenSessionRequestHandled={handledSpy}
      />
    ), workbenchHost);
    await settleTerminalPanelAfterPaint();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledWith('repo', '/workspace/repo');
    expect(handledSpy).toHaveBeenCalledWith('request-workbench');
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
    await settleTerminalPanelAfterPaint();

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

    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-2');
    expect(host.querySelector('[data-terminal-deferred-surface="true"]')).toBeTruthy();
    expect(terminalEventSourceState.dataHandlers.get('session-1')?.size).toBe(1);
    expect(terminalEventSourceState.dataHandlers.get('session-2')?.size ?? 0).toBe(0);
    expect(terminalCoreInstances).toHaveLength(1);
    expect(transportMocks.attach.mock.calls.every((call) => call[0] !== 'session-2')).toBe(true);

    await settleTerminalPanelAfterPaint();

    expect(host.querySelector('[data-terminal-deferred-surface="true"]')).toBeNull();
    expect(terminalCoreInstances).toHaveLength(2);
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
    await settleTerminalPanelAfterPaint();
    await vi.waitFor(() => {
      expect(terminalCoreInstances).toHaveLength(2);
    });

    const initialAttachCallCount = transportMocks.attach.mock.calls.length;
    const mountedCores = [...terminalCoreInstances];

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    const runningSpinner = findTerminalRunningSpinner(host, 'Terminal 2');
    expect(runningSpinner).not.toBeNull();

    terminalSessionsState.sessions = terminalSessionsState.sessions.map((session) => ({ ...session }));
    publishTerminalSessions();
    await settleTerminalPanel();

    expect(findTerminalRunningSpinner(host, 'Terminal 2')).toBe(runningSpinner);
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

    const addButton = host.querySelector('[data-testid="terminal-sidebar-add-session"]') as HTMLButtonElement | null;
    expect(addButton).toBeTruthy();

    addButton?.click();
    await settleTerminalPanelAfterPaint();

    expect(sessionOperations.createSession).toHaveBeenCalledWith('Terminal 2', '/workspace');
    expect(sessionsCoordinatorMocks.createSession).not.toHaveBeenCalled();
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).toBeNull();
    expect(host.querySelector('[data-testid="close-session-session-2"]')).toBeTruthy();

    await settleTerminalPanelAfterPaint();
    expect(terminalCoreInstances).toHaveLength(2);
    const mountedSecondCore = terminalCoreInstances[1];

    const closeButton = host.querySelector('[data-testid="close-session-session-2"]') as HTMLButtonElement | null;
    expect(closeButton).toBeTruthy();
    closeButton?.click();

    expect(findTerminalTab(host, 'Terminal 2')).toBeUndefined();
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');
    expect(sessionOperations.deleteSession).not.toHaveBeenCalled();
    expect(mountedSecondCore?.dispose).not.toHaveBeenCalled();

    await settleTerminalPanel();

    expect(sessionOperations.deleteSession).not.toHaveBeenCalled();
    expect(mountedSecondCore?.dispose).not.toHaveBeenCalled();
    expect(findTerminalTab(host, 'Terminal 2')).toBeUndefined();
    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-1');

    await settleTerminalPanelAfterPaint();

    expect(sessionOperations.deleteSession).toHaveBeenCalledWith('session-2');
    expect(sessionsCoordinatorMocks.deleteSession).not.toHaveBeenCalled();
    expect(mountedSecondCore?.dispose).toHaveBeenCalled();

    deletePromise.resolve?.();
    await settleTerminalPanel();
  });

  it('closes an unmounted terminal tab without mounting it first', async () => {
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

    const sessionOperations = {
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
    };

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
            sessionOperations={sessionOperations}
          />
        );
      })()
    ), host);
    await settleTerminalPanel();

    expect(terminalCoreInstances).toHaveLength(1);
    expect(findTerminalTab(host, 'Terminal 2')).toBeTruthy();

    const closeButton = host.querySelector('[data-testid="close-session-session-2"]') as HTMLButtonElement | null;
    expect(closeButton).toBeTruthy();
    closeButton?.click();
    await settleTerminalPanel();

    expect(findTerminalTab(host, 'Terminal 2')).toBeUndefined();
    expect(sessionOperations.deleteSession).not.toHaveBeenCalled();
    expect(terminalCoreInstances).toHaveLength(1);

    await settleTerminalPanelAfterPaint();

    expect(sessionOperations.deleteSession).toHaveBeenCalledWith('session-2');
    expect(terminalCoreInstances).toHaveLength(1);
    expect(transportMocks.attach.mock.calls.every((call) => call[0] !== 'session-2')).toBe(true);
  });

  it('creates a new terminal session without sending a fixed 80x24 create size', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const button = host.querySelector('[data-testid="terminal-sidebar-add-session"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();

    button?.click();
    await settleTerminalPanelAfterPaint();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledWith('Terminal 2', '/workspace');
  });

  it('shows an optimistic terminal tab immediately while session creation is pending', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const resolveCreateCallbacks: Array<(value: typeof terminalSessionsState.sessions[number]) => void> = [];
    sessionsCoordinatorMocks.createSession.mockImplementationOnce(async () => (
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanelAfterPaint();

    const addButton = host.querySelector('[data-testid="terminal-sidebar-add-session"]') as HTMLButtonElement | null;
    expect(addButton).toBeTruthy();

    addButton?.click();

    expect(findTerminalTab(host, 'Terminal 2')).toBeTruthy();
    expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('true');
    expect(sessionsCoordinatorMocks.createSession).not.toHaveBeenCalled();

    await settleTerminalPanelMicrotasks();

    expect(findTerminalTab(host, 'Terminal 2')).toBeTruthy();
    expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('true');
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).not.toBeNull();
    expect(host.textContent).toContain('Creating terminal...');
    const pendingSurface = host.querySelector('[data-terminal-pending-surface="true"]') as HTMLElement | null;
    expect(pendingSurface).toBeTruthy();
    expect(pendingSurface?.style.backgroundColor).toBe('rgb(17, 17, 17)');
    expect(pendingSurface?.style.color).toBe('rgb(238, 238, 238)');
    expect(pendingSurface?.style.getPropertyValue('--redeven-terminal-loading-background')).toBe('#111111');
    expect(pendingSurface?.style.getPropertyValue('--redeven-terminal-loading-foreground')).toBe('#eeeeee');
    const pendingCurtain = pendingSurface?.querySelector('.redeven-terminal-loading-curtain') as HTMLElement | null;
    expect(pendingCurtain).toBeTruthy();
    expect(pendingCurtain?.getAttribute('data-redeven-loading-curtain-stage')).toBe('creating');
    expect(pendingCurtain?.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Creating terminal');
    const statusBar = host.querySelector('[data-testid="terminal-status-bar"]') as HTMLElement | null;
    expect(statusBar).toBeTruthy();
    expect(statusBar?.classList.contains('h-7')).toBe(true);
    expect(statusBar?.classList.contains('min-h-7')).toBe(true);
    expect(statusBar?.classList.contains('max-h-7')).toBe(true);
    expect(statusBar?.classList.contains('overflow-hidden')).toBe(true);
    expect(statusBar?.textContent).toContain('Session: Creating terminal');
    expect(statusBar?.textContent).toContain('History: -');
    expect(pendingSurface?.contains(statusBar)).toBe(false);
    expect(statusBar?.style.backgroundColor).toBe('');
    expect(statusBar?.style.color).toBe('');
    expect(sessionsCoordinatorMocks.createSession).not.toHaveBeenCalled();

    await settleTerminalPanelAfterPaint();

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
    expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('true');
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).toBeNull();
    expect(host.querySelector('[data-testid="close-session-session-2"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-2');
    expect(host.querySelector('[data-terminal-deferred-surface="true"]')).toBeTruthy();
    expect(terminalCoreInstances).toHaveLength(1);
    expect(transportMocks.attach.mock.calls.every((call) => call[0] !== 'session-2')).toBe(true);

    await settleTerminalPanelAfterPaint();

    expect(host.querySelector('[data-terminal-deferred-surface="true"]')).toBeNull();
    expect(terminalCoreInstances).toHaveLength(2);
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const addButton = host.querySelector('[data-testid="terminal-sidebar-add-session"]') as HTMLButtonElement | null;
    addButton?.click();
    await settleTerminalPanelAfterPaint();

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
    expect(host.querySelector('[data-testid="close-session-session-2"]')).toBeTruthy();

    const completeCreate = resolveCreateRef.current;
    expect(completeCreate).not.toBeNull();
    if (!completeCreate) throw new Error('Missing create resolver');
    completeCreate(createdSession);
    await settleTerminalPanel();

    expect(findTerminalTabs(host, 'Terminal 2')).toHaveLength(1);
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'creating')).toBeNull();
    expect(host.querySelector('[data-testid="close-session-session-2"]')).toBeTruthy();
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const addButton = host.querySelector('[data-testid="terminal-sidebar-add-session"]') as HTMLButtonElement | null;
    addButton?.click();
    await settleTerminalPanelAfterPaint();

    expect(findTerminalTab(host, 'Terminal 2')).toBeTruthy();
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'failed')).not.toBeNull();
    expect(host.textContent).toContain('Terminal creation failed');
    expect(host.textContent).toContain('shell unavailable');

    const retryButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'Retry') as HTMLButtonElement | undefined;
    retryButton?.click();
    await settleTerminalPanelAfterPaint();

    expect(sessionsCoordinatorMocks.createSession).toHaveBeenCalledTimes(2);
    expect(findPendingTerminalTabStatus(host, 'Terminal 2', 'failed')).toBeNull();
    expect(host.querySelector('[data-testid="close-session-session-2"]')).toBeTruthy();
  });

  it('attaches with measured dimensions without a duplicate blocking resize', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    const terminalContent = host.querySelector('[data-testid="terminal-content"]') as HTMLElement | null;
    expect(terminalContent?.style.getPropertyValue('--redeven-terminal-loading-background')).toBe('#111111');
    expect(terminalContent?.style.getPropertyValue('--redeven-terminal-loading-foreground')).toBe('#eeeeee');
    await vi.waitFor(() => {
      expect(transportMocks.attach).toHaveBeenCalledWith('session-1', 80, 24);
    });
    expect(transportMocks.resize).toHaveBeenCalledTimes(1);
    expect(transportMocks.resize).toHaveBeenCalledWith('session-1', 80, 24);
  });

  it('opens the floating file preview from a modifier-click terminal file link', async () => {
    terminalBufferLinesState.lines.set(0, 'src/app/server.ts:18:4 failed to compile');

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    terminalCoreInstances[1]?.emitBell();
    await settleTerminalPanel();
    terminalCoreInstances[1]?.emitBell();
    await settleTerminalPanel();

    expect(notificationMocks.info).not.toHaveBeenCalled();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');
    const terminal2Tab = findTerminalTab(host, 'Terminal 2');
    expect(terminal2Tab?.querySelector('[data-terminal-tab-status="unread"]')).not.toBeNull();
    expect(host.textContent).not.toContain('! Terminal 2');

    terminal2Tab?.click();
    await settleTerminalPanel();

    const activeTerminal2Tab = findTerminalTab(host, 'Terminal 2');
    expect(activeTerminal2Tab?.querySelector('[data-terminal-tab-status="unread"]')).toBeNull();
  });

  it('shows pending background command activity until ordered shell state commits on activation', async () => {
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

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    let terminal2Tab = findTerminalTab(host, 'Terminal 2');
    const runningStatuses = Array.from(terminal2Tab?.parentElement?.querySelectorAll('[data-terminal-tab-status="running"]') ?? []);
    const runningStatusBadge = runningStatuses.find((status) => status.querySelector('svg'));
    expect(runningStatusBadge).not.toBeUndefined();
    expect(runningStatusBadge?.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');

    emitTerminalData('session-2', '\x1b]633;D;0\u0007', 2);
    await settleTerminalPanelAfterPaint();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();

    terminal2Tab = findTerminalTab(host, 'Terminal 2');
    expect(terminal2Tab?.querySelector('[data-terminal-tab-status="running"]')).toBeNull();
    expect(terminal2Tab?.querySelector('[data-terminal-tab-status="unread"]')).toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');
  });

  it('keeps the running sidebar spinner node mounted while switching workbench sessions', async () => {
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
    await settleTerminalPanelAfterPaint();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    const runningSpinner = findTerminalRunningSpinner(host, 'Terminal 2');
    expect(runningSpinner).not.toBeNull();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();

    expect(findTerminalRunningSpinner(host, 'Terminal 2')).toBe(runningSpinner);

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    expect(findTerminalRunningSpinner(host, 'Terminal 2')).toBe(runningSpinner);
  });

  it('falls back to unread when uncommitted background output goes quiet', async () => {
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
    await settleTerminalPanelAfterPaint();

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

  it('keeps a quiet background command marked running after the start grace window', async () => {
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
    await settleTerminalPanelAfterPaint();

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    await settleTerminalPanelAfterPaint();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('running');

    await new Promise<void>((resolve) => setTimeout(resolve, 1_700));
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('running');

    emitTerminalData('session-2', '\x1b]633;D;0\u0007', 2);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();

    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');
  });

  it('commits explicit program idle state only after the background session is activated', async () => {
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

    render(() => <TerminalPanel variant="panel" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();

    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;P;RedevenActivity=busy\u0007', 1);
    emitTerminalData('session-2', 'thinking...\n', 2);
    await settleTerminalPanel();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');

    emitTerminalData('session-2', '\x1b]633;P;RedevenActivity=idle\u0007', 3);
    await settleTerminalPanelAfterPaint();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();

    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).toBeNull();
    expect(findTerminalWorkIndicator(host)?.dataset.terminalWorkState).toBe('idle');
  });

  it('consumes cwd shell-integration markers without writing them to the terminal surface', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

  it('keeps ten opened terminal cores warm without a fixed core-count limit', async () => {
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
      await settleTerminalPanelAfterPaint();
    }

    expect(terminalCoreInstances).toHaveLength(10);
    expect(terminalWorkingSetState.runtimes.size).toBe(10);
    expect(terminalCoreInstances.every((core) => core.dispose.mock.calls.length === 0)).toBe(true);
  });

  it('filters 200 sessions by title, working directory, and session id without mounting their cores', async () => {
    terminalSessionsState.sessions = Array.from({ length: 200 }, (_, index) => ({
      id: `session-${index + 1}`,
      name: `Build Shell ${index + 1}`,
      workingDir: `/workspace/team-${index + 1}`,
      createdAtMs: index + 1,
      isActive: index === 0,
      lastActiveAtMs: 200 - index,
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    expect(host.querySelectorAll('[data-terminal-session-id]')).toHaveLength(200);
    expect(terminalCoreInstances).toHaveLength(1);

    const filter = host.querySelector('[data-testid="terminal-session-filter"]') as HTMLInputElement;
    filter.value = 'team-157';
    filter.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await settleTerminalPanel();

    const filteredRows = host.querySelectorAll('[data-terminal-session-id]');
    expect(filteredRows).toHaveLength(1);
    expect(filteredRows[0]?.getAttribute('data-terminal-session-id')).toBe('session-157');
    expect(terminalCoreInstances).toHaveLength(1);

    filter.value = 'session-42';
    filter.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await settleTerminalPanel();
    expect(host.querySelector('[data-terminal-session-id="session-42"]')).not.toBeNull();
  });

  it('uses a full-width mobile terminal with a dismissible session drawer and restores focus after selection', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'system';
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

    const sidebar = host.querySelector('[data-testid="mock-sidebar"]') as HTMLElement;
    expect(sidebar.classList.contains('hidden')).toBe(true);
    expect(host.querySelector('[data-testid="terminal-session-drawer-open"]')).not.toBeNull();

    (host.querySelector('[data-testid="terminal-session-drawer-open"]') as HTMLButtonElement).click();
    await settleTerminalPanel();
    expect(sidebar.classList.contains('hidden')).toBe(false);
    expect(host.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();
    expect(sidebar.classList.contains('hidden')).toBe(true);
    expect(findActiveTerminalTab(host)?.getAttribute('data-terminal-session-id')).toBe('session-2');
    expect(terminalCoreInstances.at(-1)?.focus).toHaveBeenCalled();

    (host.querySelector('[data-testid="terminal-session-drawer-open"]') as HTMLButtonElement).click();
    await settleTerminalPanel();
    sidebar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settleTerminalPanel();
    expect(sidebar.classList.contains('hidden')).toBe(true);
  });

  it('hibernates only the core and keeps background output subscribed', async () => {
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
    await settleTerminalPanelAfterPaint();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    await waitForTerminalPanelCondition(() => {
      expect(terminalWorkingSetState.runtimes.get('session-2')).toBeTruthy();
    });
    const runtime = terminalWorkingSetState.runtimes.get('session-2');
    const sleepingCore = terminalCoreInstances[1];
    transportMocks.attach.mockClear();
    transportMocks.historyPage.mockClear();
    const snapshot = await runtime.hibernate();

    expect(snapshot).toMatchObject({ version: 1, coveredThroughSequence: 0 });
    expect(sleepingCore?.dispose).toHaveBeenCalledTimes(1);
    expect(terminalEventSourceState.dataHandlers.get('session-2')?.size).toBe(1);

    expect(transportMocks.attach).not.toHaveBeenCalled();
    expect(transportMocks.historyPage).not.toHaveBeenCalled();
  });

  it('restores a working-set snapshot without resetting the interactive coordinator baseline', async () => {
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
    await settleTerminalPanelAfterPaint();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    await waitForTerminalPanelCondition(() => {
      expect(terminalWorkingSetState.runtimes.get('session-2')).toBeTruthy();
    });
    const runtime = terminalWorkingSetState.runtimes.get('session-2');
    const sleepingCore = terminalCoreInstances[1];
    vi.useFakeTimers();
    installRequestAnimationFrameMock('timer');
    const hibernate = runtime.hibernate();
    await vi.advanceTimersByTimeAsync(1);
    const snapshot = await hibernate;

    transportMocks.historyPage.mockClear();
    createOutputCoordinatorSpy.mockClear();
    await runtime.resume(snapshot);
    await settleTerminalPanelAfterPaint();

    const resumedCore = terminalCoreInstances.at(-1);
    expect(resumedCore).not.toBe(sleepingCore);
    expect(resumedCore?.restoreSnapshot).toHaveBeenCalledWith(snapshot);
    expect(createOutputCoordinatorSpy).not.toHaveBeenCalled();
    expect(transportMocks.historyPage).not.toHaveBeenCalled();
  });

  it('waits for the live writer before hibernating the terminal core', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanelAfterPaint();

    await waitForTerminalPanelCondition(() => {
      expect(terminalWorkingSetState.runtimes.get('session-1')).toBeTruthy();
    });
    const runtime = terminalWorkingSetState.runtimes.get('session-1');
    const sleepingCore = terminalCoreInstances[0];
    terminalWriteCompletionState.deferLive = true;
    emitTerminalData('session-1', 'before-pause', 1);
    await waitForTerminalPanelCondition(() => {
      expect(terminalWriteCompletionState.liveCallbacks).toHaveLength(1);
    });

    const hibernate = runtime.hibernate();
    await settleTerminalPanelMicrotasks();
    expect(sleepingCore?.dispose).not.toHaveBeenCalled();
    expect(sleepingCore?.captureRestorableSnapshot).not.toHaveBeenCalled();

    terminalWriteCompletionState.liveCallbacks.shift()?.();
    const snapshot = await hibernate;
    expect(snapshot).toMatchObject({ version: 1, coveredThroughSequence: 1 });
    expect(sleepingCore?.dispose).toHaveBeenCalledTimes(1);
  });

  it('catches up inactive mounted sessions without reloading the terminal core', async () => {
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    const inactiveCore = terminalCoreInstances[1];
    inactiveCore?.write.mockClear();
    inactiveCore?.clear.mockClear();
    inactiveCore?.startHistoryReplay.mockClear();
    inactiveCore?.initialize.mockClear();
    inactiveCore?.dispose.mockClear();
    transportMocks.attach.mockClear();
    transportMocks.historyPage.mockClear();

    emitTerminalData('session-2', 'background output', 1);
    await settleTerminalPanel();

    expect(inactiveCore?.write).not.toHaveBeenCalled();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'running')).not.toBeNull();
    expect(findTerminalTabStatus(host, 'Terminal 2', 'unread')).toBeNull();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();
    await settleTerminalPanel();

    expect(terminalCoreInstances).toHaveLength(2);
    expect(inactiveCore?.dispose).not.toHaveBeenCalled();
    expect(inactiveCore?.initialize).not.toHaveBeenCalled();
    expect(transportMocks.attach).not.toHaveBeenCalled();
    expect(transportMocks.historyPage).not.toHaveBeenCalled();
    expect(inactiveCore?.clear).not.toHaveBeenCalled();
    expect(inactiveCore?.startHistoryReplay).not.toHaveBeenCalled();
    const firstWrite = inactiveCore?.write.mock.calls[0]?.[0] as Uint8Array | undefined;
    expect(firstWrite ? new TextDecoder().decode(firstWrite) : '').toBe('background output');
  });

  it('keeps inactive catchup ordered and does not replay it twice across tab switches', async () => {
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    const inactiveCore = terminalCoreInstances[1];
    inactiveCore?.write.mockClear();
    transportMocks.historyPage.mockClear();

    emitTerminalData('session-2', 'alpha ', 1);
    emitTerminalData('session-2', 'beta', 2);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();
    await settleTerminalPanel();

    expect(transportMocks.historyPage).not.toHaveBeenCalled();
    expect(inactiveCore?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['alpha beta']);

    inactiveCore?.write.mockClear();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();
    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanel();

    expect(inactiveCore?.write).not.toHaveBeenCalled();
  });

  it('uses history catchup for inactive sequence gaps without recreating the terminal core', async () => {
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    const inactiveCore = terminalCoreInstances[1];
    inactiveCore?.write.mockClear();
    inactiveCore?.dispose.mockClear();
    transportMocks.attach.mockClear();
    transportMocks.historyPage.mockClear();
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      chunks: [
        { sequence: 1, timestampMs: 10, data: textEncoder.encode('one ') },
        { sequence: 2, timestampMs: 20, data: textEncoder.encode('two ') },
        { sequence: 3, timestampMs: 30, data: textEncoder.encode('three') },
      ],
      firstSequence: 1,
      lastSequence: 3,
      coveredBytes: 13,
      totalBytes: 13,
    }));

    emitTerminalData('session-2', 'one ', 1);
    emitTerminalData('session-2', 'three', 3);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledWith('session-2', 2, -1);
      expect(inactiveCore?.write).toHaveBeenCalled();
    });

    expect(terminalCoreInstances).toHaveLength(2);
    expect(inactiveCore?.dispose).not.toHaveBeenCalled();
    expect(transportMocks.attach).not.toHaveBeenCalled();
    expect(inactiveCore?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0])).join('')).toBe('one two three');
  });

  it('accepts input after inactive history catchup completes without live output', async () => {
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    const inactiveCore = terminalCoreInstances[1];
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      chunks: [
        { sequence: 1, timestampMs: 10, data: textEncoder.encode('one ') },
        { sequence: 2, timestampMs: 20, data: textEncoder.encode('two ') },
        { sequence: 3, timestampMs: 30, data: textEncoder.encode('three') },
      ],
      firstSequence: 1,
      lastSequence: 3,
      coveredBytes: 13,
      totalBytes: 13,
    }));

    emitTerminalData('session-2', 'one ', 1);
    emitTerminalData('session-2', 'three', 3);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledWith('session-2', 2, -1);
      expect(inactiveCore?.write).toHaveBeenCalled();
    });

    transportMocks.sendInput.mockClear();
    inactiveCore?.handlers?.onData?.('x');

    expect(transportMocks.sendInput).toHaveBeenCalledWith('session-2', 'x', 'conn-1');
  });

  it('clears and replays available history when inactive catchup falls behind retained history', async () => {
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();
    const inactiveCore = terminalCoreInstances[1];
    inactiveCore?.write.mockClear();
    emitTerminalData('session-2', 'before-overflow', 1);
    await settleTerminalPanel();
    await settleTerminalPanel();

    inactiveCore?.write.mockClear();
    inactiveCore?.clear.mockClear();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    transportMocks.historyPage.mockClear();
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      chunks: [
        { sequence: 250, timestampMs: 250, data: textEncoder.encode('retained') },
      ],
      firstSequence: 250,
      lastSequence: 299,
      coveredBytes: 8,
      totalBytes: 8,
    }));

    emitTerminalData('session-2', 'after-gap', 300);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledWith('session-2', 2, -1);
      expect(inactiveCore?.write).toHaveBeenCalled();
    });

    expect(inactiveCore?.clear).toHaveBeenCalled();
    expect(inactiveCore?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual([
      'retained',
      'after-gap',
    ]);
  });

  it('does not duplicate shell integration side effects during inactive history catchup', async () => {
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    findTerminalTab(host, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();
    findTerminalTab(host, 'Terminal 1')?.click();
    await settleTerminalPanel();

    const inactiveCore = terminalCoreInstances[1];
    inactiveCore?.write.mockClear();
    sessionsCoordinatorMocks.updateSessionMeta.mockClear();
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      chunks: [
        { sequence: 1, timestampMs: 10, data: textEncoder.encode('one ') },
        { sequence: 2, timestampMs: 20, data: textEncoder.encode('two ') },
        { sequence: 3, timestampMs: 30, data: textEncoder.encode('\x1b]633;P;Cwd=/workspace/repo\u0007three') },
      ],
      firstSequence: 1,
      lastSequence: 3,
      coveredBytes: 13,
      totalBytes: 13,
    }));

    emitTerminalData('session-2', '\x1b]633;P;Cwd=/workspace/repo\u0007three', 3);
    await settleTerminalPanel();

    expect(sessionsCoordinatorMocks.updateSessionMeta).not.toHaveBeenCalled();

    findTerminalTab(host, 'Terminal 2')?.click();
    await waitForTerminalPanelCondition(() => {
      expect(inactiveCore?.write).toHaveBeenCalled();
    });

    expect(sessionsCoordinatorMocks.updateSessionMeta).toHaveBeenCalledTimes(1);
    expect(sessionsCoordinatorMocks.updateSessionMeta).toHaveBeenCalledWith('session-2', { workingDir: '/workspace/repo' });
  });

  it('accepts fresh sequence-one output after clearing a terminal session', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const core = terminalCoreInstances[0];
    core?.write.mockClear();

    emitTerminalData('session-1', 'before-clear', 1);
    await settleTerminalPanel();
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['before-clear']);

    core?.write.mockClear();
    host.querySelector<HTMLButtonElement>('button[title="Clear"]')?.click();
    await settleTerminalPanel();

    expect(transportMocks.clear).toHaveBeenCalledWith('session-1');
    emitTerminalData('session-1', 'after-clear', 1);
    await settleTerminalPanel();

    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['after-clear']);
  });

  it('cancels remaining activity catchup history batches after clearing the terminal', async () => {
    let nextFrameId = 0;
    const frames: Array<{ id: number; callback: FrameRequestCallback }> = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frames.push({ id, callback });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const index = frames.findIndex((frame) => frame.id === id);
      if (index >= 0) frames.splice(index, 1);
    });
    const flushNextFrame = async () => {
      const frame = frames.shift();
      frame?.callback(0);
      await settleTerminalPanelMicrotasks();
    };
    const flushFramesUntil = async (assertion: () => void) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await settleTerminalPanelMicrotasks();
        try {
          assertion();
          return;
        } catch (error) {
          lastError = error;
        }
        await flushNextFrame();
      }
      throw lastError;
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="panel" />, host);
    await flushFramesUntil(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    emitTerminalData('session-1', 'initial', 1);
    await flushFramesUntil(() => {
      expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toContain('initial');
    });

    const catchupChunks = Array.from({ length: 130 }, (_, index) => ({
      sequence: index + 2,
      timestampMs: index + 10,
      data: textEncoder.encode(`chunk-${index + 2} `),
    }));
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage({
      chunks: catchupChunks,
      firstSequence: 2,
      lastSequence: 131,
      coveredBytes: catchupChunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0),
      totalBytes: catchupChunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0),
    }));
    transportMocks.historyPage.mockClear();
    core?.write.mockClear();

    emitTerminalData('session-1', 'chunk-131', 131);
    await flushFramesUntil(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
      expect(core?.write).toHaveBeenCalledTimes(1);
    });

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(core?.write).toHaveBeenCalledTimes(1);
    core?.write.mockClear();
    transportMocks.historyPage.mockResolvedValue(makeTerminalHistoryPage());
    host.querySelector<HTMLButtonElement>('button[title="Clear"]')?.click();
    await settleTerminalPanelMicrotasks();
    expect(transportMocks.clear).toHaveBeenCalledWith('session-1');

    while (frames.length > 0) {
      await flushNextFrame();
    }

    expect(core?.write).not.toHaveBeenCalled();
  });

  it('replays terminal history page-by-page and shows progress while a later page is loading', async () => {
    vi.useFakeTimers();
    installRequestAnimationFrameMock('timer');

    const sessionId = 'history-session';
    terminalSessionsState.sessions = [
      {
        id: sessionId,
        name: 'History terminal',
        workingDir: '/workspace',
        createdAtMs: 1,
        isActive: true,
        lastActiveAtMs: 10,
      },
    ];

    let releaseSecondPage: (page: TestTerminalHistoryPage) => void = () => {};
    const secondPage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseSecondPage = resolve;
    });
    const firstPage = makeTerminalHistoryPage({
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
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage.mockImplementation((id: string, cursor: number) => {
      if (id !== sessionId) {
        return Promise.resolve(makeTerminalHistoryPage());
      }
      if (cursor === 0) {
        return Promise.resolve(firstPage);
      }
      if (cursor === 2) {
        return secondPage;
      }
      return Promise.resolve(makeTerminalHistoryPage());
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage.mock.calls).toContainEqual([sessionId, 2, -1]);
    });

    await vi.advanceTimersByTimeAsync(170);
    await settleTerminalPanel();
    expect(host.textContent).toContain('Loading history 5 B / 10 B');

    const core = terminalCoreInstances.find((entry) => host.contains(entry.container));
    expect(core?.clear).toHaveBeenCalled();
    expect(core?.startHistoryReplay).not.toHaveBeenCalled();

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

    await waitForTerminalPanelCondition(() => {
      expect(core?.write).toHaveBeenCalledTimes(2);
    });
    expect(core?.writeHistory).toHaveBeenCalledTimes(2);

    const historySessionCalls = transportMocks.historyPage.mock.calls.filter((call) => call[0] === sessionId);
    expect(historySessionCalls).toEqual([
      [sessionId, 0, -1],
      [sessionId, 2, -1],
    ]);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['alpha', 'omega']);
  });

  it('ignores diagnostics and progress from an obsolete history request after refresh', async () => {
    let releaseObsoletePage: (page: TestTerminalHistoryPage) => void = () => {};
    const obsoletePage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseObsoletePage = resolve;
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage
      .mockReturnValueOnce(obsoletePage)
      .mockResolvedValue(makeTerminalHistoryPage({
        chunks: [{ sequence: 1, timestampMs: 20, data: textEncoder.encode('current') }],
        firstSequence: 1,
        lastSequence: 1,
        coveredBytes: 7,
        totalBytes: 7,
      }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <TerminalPanel variant="workbench" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    (host.querySelector('[data-testid="terminal-sidebar-refresh"]') as HTMLButtonElement)?.click();
    await waitForTerminalPanelCondition(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(2);
    });
    await waitForTerminalPanelCondition(() => {
      const historyEvents = getDebugConsoleClientEventRingSnapshot().events.filter((event) => (
        event.scope === 'terminal_recovery' && event.kind === 'history_page'
      ));
      expect(historyEvents).toHaveLength(1);
      expect(historyEvents[0]?.detail?.surface_generation).toBe(2);
    });

    releaseObsoletePage(makeTerminalHistoryPage({
      chunks: [{ sequence: 99, timestampMs: 10, data: textEncoder.encode('obsolete') }],
      firstSequence: 99,
      lastSequence: 99,
      coveredBytes: 8,
      totalBytes: 100,
    }));
    await drainTerminalPanelAsyncWork();

    const historyEvents = getDebugConsoleClientEventRingSnapshot().events.filter((event) => (
      event.scope === 'terminal_recovery' && event.kind === 'history_page'
    ));
    expect(historyEvents).toHaveLength(1);
    expect(historyEvents[0]?.detail).toMatchObject({
      surface_generation: 2,
      history_page_count: 1,
      history_chunk_count: 1,
      history_bytes: 7,
    });
    expect(host.textContent).not.toContain('Loading history 8 B / 100 B');
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

    render(() => <TerminalPanel variant="workbench" />, host);
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
      expect(core?.write).toHaveBeenCalledTimes(2);
    });
    expect(core?.writeHistory).toHaveBeenCalledTimes(1);

    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0]))).toEqual(['duplicate', 'fresh']);
  });

  it('preserves Workbench buffered live output omitted from sparse history pages', async () => {
    let releaseHistoryPage: (page: TestTerminalHistoryPage) => void = () => {};
    const historyPage = new Promise<TestTerminalHistoryPage>((resolve) => {
      releaseHistoryPage = resolve;
    });
    transportMocks.historyPage.mockReset();
    transportMocks.historyPage.mockReturnValueOnce(historyPage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await vi.waitFor(() => {
      expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    });

    const core = terminalCoreInstances[0];
    emitTerminalData('session-1', 'covered-by-high-water', 2);
    emitTerminalData('session-1', 'unsequenced-live');

    releaseHistoryPage(makeTerminalHistoryPage({
      chunks: [
        {
          sequence: 1,
          timestampMs: 10,
          data: textEncoder.encode('history-one'),
        },
      ],
      hasMore: false,
      firstSequence: 1,
      lastSequence: 2,
      coveredBytes: 11,
      totalBytes: 11,
    }));

    await waitForTerminalPanelCondition(() => {
      expect(core?.write).toHaveBeenCalledTimes(2);
    });
    expect(core?.writeHistory).toHaveBeenCalledTimes(1);

    expect(transportMocks.historyPage).toHaveBeenCalledTimes(1);
    expect(core?.write.mock.calls.map((call: unknown[]) => decodeTerminalWrite(call[0])).join('')).toBe(
      'history-onecovered-by-high-waterunsequenced-live',
    );
  });

  it('does not recreate a session when the same open-session request id is replayed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handledSpy = vi.fn();
    const [request, setRequest] = createSignal({
      requestId: 'request-1',
      workingDir: '/workspace/repo',
      preferredName: 'repo',
      targetMode: 'workbench' as const,
    });

    render(() => (
      <TerminalPanel
        variant="workbench"
        openSessionRequest={request()}
        onOpenSessionRequestHandled={handledSpy}
      />
    ), host);
    await settleTerminalPanelAfterPaint();

    setRequest({
      requestId: 'request-1',
      workingDir: '/workspace/repo',
      preferredName: 'repo-again',
      targetMode: 'workbench',
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

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanelAfterPaint();
    focusSpy.mockClear();

    (host.querySelector('[data-testid="dropdown-item-settings"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    expect(host.querySelector('[data-testid="dialog"]')?.className).toContain('h-[calc(100dvh-0.5rem)]');

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Close'))?.click();
    await settleTerminalPanelAfterPaint();

    expect(focusSpy).toHaveBeenCalled();
  });

  it('re-sends terminal resize when focus is restored after closing settings', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'system';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();
    focusSpy.mockClear();
    transportMocks.resize.mockClear();

    (host.querySelector('[data-testid="dropdown-item-settings"]') as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Close'))?.click();
    await settleTerminalPanelAfterPaint();

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
    let terminalSurfaceScrollTop = 73;
    const terminalSurfaceScrollTopSetter = vi.fn((value: number) => {
      terminalSurfaceScrollTop = value;
    });
    Object.defineProperty(terminalSurface!, 'scrollTop', {
      configurable: true,
      get: () => terminalSurfaceScrollTop,
      set: terminalSurfaceScrollTopSetter,
    });

    terminalSurface?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await settleTerminalPanel();

    expect(focusSpy).toHaveBeenCalled();
    expect(terminalSurfaceScrollTopSetter).not.toHaveBeenCalled();
    expect(terminalSurface?.scrollTop).toBe(73);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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

    render(() => <TerminalPanel variant="workbench" />, host);
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
    expect(menu?.querySelectorAll('[role="separator"]')).toHaveLength(1);

    const browseButton = menuButtons.find((button) => button.textContent?.includes('Browse files'));
    expect(browseButton).toBeTruthy();

    browseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settleTerminalPanel();

    expect(openFileBrowserAtPathSpy).toHaveBeenCalledWith('/workspace', {
      homePath: '/workspace',
    });
  });

  it('opens Ask Flower with short terminal selection text from the terminal context menu', async () => {
    terminalSelectionState.text = '  go test \u{1F9EA}\n';
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

    const askButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Ask Flower')) as HTMLButtonElement | undefined;
    expect(askButton).toBeTruthy();

    askButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settleTerminalPanel();

    expect(openFlowerTurnLauncherSpy).toHaveBeenCalledWith(expect.objectContaining({
      source_surface: 'terminal',
      context_items: [
        {
          kind: 'terminal_selection',
          working_dir: '/workspace',
          selection: 'go test \u{1F9EA}',
          selection_chars: Array.from('go test \u{1F9EA}').length,
        },
      ],
      pending_attachments: [],
    }), expect.anything());
  });

  it('opens Ask Flower with metadata-only context for large terminal selections', async () => {
    const largeSelection = 'x'.repeat(10_001);
    terminalSelectionState.text = largeSelection;
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

    const askButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Ask Flower')) as HTMLButtonElement | undefined;
    expect(askButton).toBeTruthy();

    askButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settleTerminalPanel();

    expect(openFlowerTurnLauncherSpy).toHaveBeenCalledWith(expect.objectContaining({
      source_surface: 'terminal',
      context_items: [
        {
          kind: 'terminal_selection',
          working_dir: '/workspace',
          selection: '',
          selection_chars: largeSelection.length,
        },
      ],
      pending_attachments: [],
      notes: ['Large terminal selection was linked by length only.'],
    }), expect.anything());
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
      'Copy selection',
    ]);
    expect(menu?.querySelectorAll('[role="separator"]')).toHaveLength(1);

    const browseButton = menuButtons.find((button) => button.textContent?.includes('Browse files'));
    expect(browseButton).toBeUndefined();
  });

  it('opens terminal search with Cmd+F on macOS without stealing Ctrl+F', async () => {
    setNavigatorUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15');
    terminalSelectionState.text = 'pnpm test';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    const ctrlEvent = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      key: 'f',
    });
    await settleTerminalPanel();

    expect(ctrlEvent.defaultPrevented).toBe(false);
    expect(host.querySelector('input[placeholder="Search..."]')).toBeNull();

    const cmdEvent = dispatchTerminalKeydown(terminalSurface!, {
      metaKey: true,
      key: 'f',
    });
    await settleTerminalPanel();

    expect(cmdEvent.defaultPrevented).toBe(true);
    const searchInput = host.querySelector('input[placeholder="Search..."]') as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();
  });

  it('opens terminal search with Ctrl+F off macOS without stealing Cmd+F', async () => {
    setNavigatorUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
    terminalSelectionState.text = 'pnpm test';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    const cmdEvent = dispatchTerminalKeydown(terminalSurface!, {
      metaKey: true,
      key: 'f',
    });
    await settleTerminalPanel();

    expect(cmdEvent.defaultPrevented).toBe(false);
    expect(host.querySelector('input[placeholder="Search..."]')).toBeNull();

    const ctrlEvent = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      key: 'f',
    });
    await settleTerminalPanel();

    expect(ctrlEvent.defaultPrevented).toBe(true);
    const searchInput = host.querySelector('input[placeholder="Search..."]') as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();
  });

  it('renders terminal sessions in a floe sidebar instead of tabs', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    expect(host.querySelector('[data-testid="mock-tabs"]')).toBeNull();
    expect(host.querySelector('[data-testid="mock-sidebar"]')).toBeTruthy();
    const listRoot = findTerminalTabsRoot(host);
    expect(listRoot).toBeTruthy();
    expect(listRoot?.querySelector('[data-floe-canvas-wheel-interactive="true"][data-redeven-workbench-wheel-role="local-scroll-viewport"]')).toBeTruthy();
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');
    expect(listRoot?.textContent).not.toContain('Running');
    expect(listRoot?.textContent).not.toContain('Unread');
    expect(listRoot?.textContent).not.toContain('History');
  });

  it('switches terminal sessions with the platform primary digit shortcut', async () => {
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

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();
    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-1');

    const event = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      key: '2',
    });

    expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('true');
    expect(findActiveTerminalTab(host)?.textContent).toContain('Terminal 2');
    expect(terminalCoreInstances).toHaveLength(1);

    await settleTerminalPanel();

    expect(event.defaultPrevented).toBe(true);
    expect(findTerminalTab(host, 'Terminal 2')?.dataset.terminalSessionActive).toBe('true');
    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-2');
    expect(host.querySelector('[data-terminal-deferred-surface="true"]')).toBeTruthy();
    expect(terminalCoreInstances).toHaveLength(1);
    expect(transportMocks.attach.mock.calls.every((call) => call[0] !== 'session-2')).toBe(true);

    await settleTerminalPanelAfterPaint();

    expect(host.querySelector('[data-terminal-deferred-surface="true"]')).toBeNull();
    expect(terminalCoreInstances).toHaveLength(2);
  });

  it('keeps rapid terminal digit shortcuts visually on the final tab without mounting skipped tabs', async () => {
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
      {
        id: 'session-3',
        name: 'Terminal 3',
        workingDir: '/workspace/logs',
        createdAtMs: 3,
        isActive: false,
        lastActiveAtMs: 3,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();
    expect(terminalCoreInstances).toHaveLength(1);

    const secondEvent = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      key: '2',
    });
    const thirdEvent = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      key: '3',
    });
    const firstEvent = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      key: '1',
    });

    expect(secondEvent.defaultPrevented).toBe(true);
    expect(thirdEvent.defaultPrevented).toBe(true);
    expect(firstEvent.defaultPrevented).toBe(true);
    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');
    expect(findActiveTerminalTab(host)?.textContent).toContain('Terminal 1');
    expect(terminalCoreInstances).toHaveLength(1);

    await settleTerminalPanelAfterPaint();

    expect(findTerminalTab(host, 'Terminal 1')?.dataset.terminalSessionActive).toBe('true');
    expect(terminalCoreInstances).toHaveLength(1);
    expect(transportMocks.attach.mock.calls.every((call) => call[0] !== 'session-2' && call[0] !== 'session-3')).toBe(true);
  });

  it('does not prevent default for terminal digit shortcuts outside the visible tab range', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
    await settleTerminalPanel();

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    const event = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      key: '9',
    });
    await settleTerminalPanel();

    expect(event.defaultPrevented).toBe(false);
    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-1');
  });

  it('does not steal shifted primary digit shortcuts from shell navigation commands', async () => {
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

    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    const event = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      shiftKey: true,
      key: '1',
    });
    await settleTerminalPanel();

    expect(event.defaultPrevented).toBe(false);
    expect(host.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-1');
  });

  it('keeps controlled workbench tab visuals instant while parent group state catches up', async () => {
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
      {
        id: 'session-3',
        name: 'Terminal 3',
        workingDir: '/workspace/logs',
        createdAtMs: 3,
        isActive: false,
        lastActiveAtMs: 3,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const groupStateSpy = vi.fn();
    let applyLatestPanelAState: () => void = () => {
      throw new Error('Panel A state applier was not initialized');
    };

    render(() => (
      (() => {
        const [groupA, setGroupA] = createSignal({
          sessionIds: ['session-1', 'session-2'],
          activeSessionId: 'session-1' as string | null,
        });
        const [groupB, setGroupB] = createSignal({
          sessionIds: ['session-3'],
          activeSessionId: 'session-3' as string | null,
        });

        applyLatestPanelAState = () => {
          const calls = groupStateSpy.mock.calls;
          const next = calls[calls.length - 1]?.[0];
          if (next) setGroupA(next);
        };

        return (
          <>
            <div data-testid="terminal-panel-a">
              <TerminalPanel
                variant="workbench"
                sessionGroupState={groupA()}
                onSessionGroupStateChange={(next) => {
                  groupStateSpy(next);
                }}
              />
            </div>
            <div data-testid="terminal-panel-b">
              <TerminalPanel
                variant="workbench"
                sessionGroupState={groupB()}
                onSessionGroupStateChange={setGroupB}
              />
            </div>
          </>
        );
      })()
    ), host);
    await settleTerminalPanel();

    const panelA = host.querySelector('[data-testid="terminal-panel-a"]') as HTMLElement | null;
    const panelB = host.querySelector('[data-testid="terminal-panel-b"]') as HTMLElement | null;
    expect(panelA).toBeTruthy();
    expect(panelB).toBeTruthy();
    expect(findActiveTerminalTab(panelA!)?.textContent).toContain('Terminal 1');
    expect(findActiveTerminalTab(panelB!)?.textContent).toContain('Terminal 3');

    const terminalSurface = panelA?.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    const event = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      key: '2',
    });

    expect(event.defaultPrevented).toBe(true);
    expect(groupStateSpy).not.toHaveBeenCalled();
    expect(findActiveTerminalTab(panelA!)?.textContent).toContain('Terminal 2');
    expect(findActiveTerminalTab(panelB!)?.textContent).toContain('Terminal 3');

    await settleTerminalPanelMicrotasks();

    expect(groupStateSpy).toHaveBeenLastCalledWith({
      sessionIds: ['session-1', 'session-2'],
      activeSessionId: 'session-2',
    });

    applyLatestPanelAState();
    await settleTerminalPanel();

    expect(findActiveTerminalTab(panelA!)?.textContent).toContain('Terminal 2');
    expect(findActiveTerminalTab(panelB!)?.textContent).toContain('Terminal 3');
  });

  it('previews controlled workbench sidebar selection before the parent group state catches up', async () => {
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
      {
        id: 'session-3',
        name: 'Terminal 3',
        workingDir: '/workspace/logs',
        createdAtMs: 3,
        isActive: false,
        lastActiveAtMs: 3,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const groupStateSpy = vi.fn();
    let applyLatestPanelAState: () => void = () => {
      throw new Error('Panel A state applier was not initialized');
    };

    render(() => (
      (() => {
        const [groupA, setGroupA] = createSignal({
          sessionIds: ['session-1', 'session-2'],
          activeSessionId: 'session-1' as string | null,
        });
        const [groupB, setGroupB] = createSignal({
          sessionIds: ['session-3'],
          activeSessionId: 'session-3' as string | null,
        });

        applyLatestPanelAState = () => {
          const calls = groupStateSpy.mock.calls;
          const next = calls[calls.length - 1]?.[0];
          if (next) setGroupA(next);
        };

        return (
          <>
            <div data-testid="terminal-panel-a">
              <TerminalPanel
                variant="workbench"
                sessionGroupState={groupA()}
                onSessionGroupStateChange={(next) => {
                  groupStateSpy(next);
                }}
              />
            </div>
            <div data-testid="terminal-panel-b">
              <TerminalPanel
                variant="workbench"
                sessionGroupState={groupB()}
                onSessionGroupStateChange={setGroupB}
              />
            </div>
          </>
        );
      })()
    ), host);
    await settleTerminalPanel();

    const panelA = host.querySelector('[data-testid="terminal-panel-a"]') as HTMLElement | null;
    const panelB = host.querySelector('[data-testid="terminal-panel-b"]') as HTMLElement | null;
    expect(panelA).toBeTruthy();
    expect(panelB).toBeTruthy();

    const terminal2Button = panelA?.querySelector<HTMLButtonElement>('button[data-terminal-session-id="session-2"]');
    expect(terminal2Button).toBeTruthy();

    dispatchTerminalPointerDown(terminal2Button!);

    expect(groupStateSpy).not.toHaveBeenCalled();
    expect(findActiveTerminalTab(panelA!)?.textContent).toContain('Terminal 2');
    expect(panelA?.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-1');
    expect(findActiveTerminalTab(panelB!)?.textContent).toContain('Terminal 3');

    terminal2Button?.click();
    await settleTerminalPanel();

    expect(groupStateSpy).toHaveBeenLastCalledWith({
      sessionIds: ['session-1', 'session-2'],
      activeSessionId: 'session-2',
    });
    expect(findActiveTerminalTab(panelA!)?.textContent).toContain('Terminal 2');
    expect(panelA?.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-2');
    expect(findActiveTerminalTab(panelB!)?.textContent).toContain('Terminal 3');

    applyLatestPanelAState();
    await settleTerminalPanel();

    expect(findActiveTerminalTab(panelA!)?.textContent).toContain('Terminal 2');
    expect(findActiveTerminalTab(panelB!)?.textContent).toContain('Terminal 3');
  });

  it('keeps a running sidebar spinner mounted while controlled workbench group state catches up', async () => {
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
      {
        id: 'session-3',
        name: 'Terminal 3',
        workingDir: '/workspace/logs',
        createdAtMs: 3,
        isActive: false,
        lastActiveAtMs: 3,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const groupStateSpy = vi.fn();
    let applyLatestPanelAState: () => void = () => {
      throw new Error('Panel A state applier was not initialized');
    };

    render(() => (
      (() => {
        const [groupA, setGroupA] = createSignal({
          sessionIds: ['session-1', 'session-2'],
          activeSessionId: 'session-1' as string | null,
        });
        const [groupB, setGroupB] = createSignal({
          sessionIds: ['session-3'],
          activeSessionId: 'session-3' as string | null,
        });

        applyLatestPanelAState = () => {
          const calls = groupStateSpy.mock.calls;
          const next = calls[calls.length - 1]?.[0];
          if (next) setGroupA(next);
        };

        return (
          <>
            <div data-testid="terminal-panel-a">
              <TerminalPanel
                variant="workbench"
                sessionGroupState={groupA()}
                onSessionGroupStateChange={(next) => {
                  groupStateSpy(next);
                }}
              />
            </div>
            <div data-testid="terminal-panel-b">
              <TerminalPanel
                variant="workbench"
                sessionGroupState={groupB()}
                onSessionGroupStateChange={setGroupB}
              />
            </div>
          </>
        );
      })()
    ), host);
    await settleTerminalPanel();

    const panelA = host.querySelector('[data-testid="terminal-panel-a"]') as HTMLElement | null;
    const panelB = host.querySelector('[data-testid="terminal-panel-b"]') as HTMLElement | null;
    expect(panelA).toBeTruthy();
    expect(panelB).toBeTruthy();

    findTerminalTab(panelA!, 'Terminal 2')?.click();
    await settleTerminalPanelAfterPaint();
    applyLatestPanelAState();
    await settleTerminalPanel();

    findTerminalTab(panelA!, 'Terminal 1')?.click();
    await settleTerminalPanel();
    applyLatestPanelAState();
    await settleTerminalPanel();

    emitTerminalData('session-2', '\x1b]633;B\u0007', 1);
    await settleTerminalPanel();

    const runningSpinner = findTerminalRunningSpinner(panelA!, 'Terminal 2');
    expect(runningSpinner).not.toBeNull();
    expect(findTerminalRunningSpinner(panelB!, 'Terminal 2')).toBeNull();

    groupStateSpy.mockClear();
    const terminal2Button = panelA!.querySelector<HTMLButtonElement>('button[data-terminal-session-id="session-2"]');
    expect(terminal2Button).toBeTruthy();

    dispatchTerminalPointerDown(terminal2Button!);

    expect(findTerminalRunningSpinner(panelA!, 'Terminal 2')).toBe(runningSpinner);
    expect(groupStateSpy).not.toHaveBeenCalled();

    terminal2Button?.click();
    await settleTerminalPanel();

    expect(groupStateSpy).toHaveBeenLastCalledWith({
      sessionIds: ['session-1', 'session-2'],
      activeSessionId: 'session-2',
    });
    expect(findTerminalRunningSpinner(panelA!, 'Terminal 2')).toBe(runningSpinner);
    expect(findTerminalRunningSpinner(panelB!, 'Terminal 2')).toBeNull();

    applyLatestPanelAState();
    await settleTerminalPanel();

    expect(findTerminalRunningSpinner(panelA!, 'Terminal 2')).toBe(runningSpinner);
    expect(findActiveTerminalTab(panelA!)?.textContent).toContain('Terminal 2');
    expect(findActiveTerminalTab(panelB!)?.textContent).toContain('Terminal 3');
  });

  it('keeps terminal digit shortcuts scoped to the owning workbench terminal panel', async () => {
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
      {
        id: 'session-3',
        name: 'Terminal 3',
        workingDir: '/workspace/logs',
        createdAtMs: 3,
        isActive: false,
        lastActiveAtMs: 3,
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      (() => {
        const [groupA, setGroupA] = createSignal({
          sessionIds: ['session-1', 'session-2'],
          activeSessionId: 'session-1' as string | null,
        });
        const [groupB, setGroupB] = createSignal({
          sessionIds: ['session-3'],
          activeSessionId: 'session-3' as string | null,
        });

        return (
          <>
            <div data-testid="terminal-panel-a">
              <TerminalPanel
                variant="workbench"
                sessionGroupState={groupA()}
                onSessionGroupStateChange={setGroupA}
              />
            </div>
            <div data-testid="terminal-panel-b">
              <TerminalPanel
                variant="workbench"
                sessionGroupState={groupB()}
                onSessionGroupStateChange={setGroupB}
              />
            </div>
          </>
        );
      })()
    ), host);
    await settleTerminalPanel();

    const panelA = host.querySelector('[data-testid="terminal-panel-a"]') as HTMLElement | null;
    const panelB = host.querySelector('[data-testid="terminal-panel-b"]') as HTMLElement | null;
    expect(panelA).toBeTruthy();
    expect(panelB).toBeTruthy();
    expect(panelA?.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-1');
    expect(panelB?.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-3');

    const terminalSurface = panelA?.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    const event = dispatchTerminalKeydown(terminalSurface!, {
      ctrlKey: true,
      key: '2',
    });
    await settleTerminalPanel();

    expect(event.defaultPrevented).toBe(true);
    expect(panelA?.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-2');
    expect(panelB?.querySelector('[data-testid="terminal-status-bar"]')?.textContent).toContain('Session: session-3');
  });

  it('does not keep a product-owned Cmd/Ctrl+C copy workaround at the panel shell', async () => {
    terminalSelectionState.text = 'pnpm test';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="workbench" />, host);
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
