// @vitest-environment jsdom

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
}));

const focusSpy = vi.hoisted(() => vi.fn());
const forceResizeSpy = vi.hoisted(() => vi.fn());
const scrollLinesSpy = vi.hoisted(() => vi.fn());
const terminalInputSpy = vi.hoisted(() => vi.fn());
const terminalScrollState = vi.hoisted(() => ({
  alternateScreen: false,
  scrollbackLength: 200,
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

const sessionsCoordinatorMocks = vi.hoisted(() => {
  const sessions = [
    {
      id: 'session-1',
      name: 'Terminal 1',
      workingDir: '/workspace',
      isActive: true,
      lastActiveAtMs: 10,
    },
  ];

  return {
    refresh: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    updateSessionMeta: vi.fn(),
    subscribe: (callback: (value: typeof sessions) => void) => {
      callback(sessions);
      return () => undefined;
    },
  };
});

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  useCurrentWidgetId: () => null,
  useLayout: () => ({
    isMobile: () => layoutState.mobile,
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
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
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
  MobileKeyboard: (props: any) => (
    <Show when={props.visible}>
      <div
        data-testid="mobile-keyboard"
        ref={(el) => {
          Object.defineProperty(el, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
              width: 320,
              height: 132,
              top: 0,
              left: 0,
              right: 320,
              bottom: 132,
              x: 0,
              y: 0,
              toJSON: () => undefined,
            }),
          });
          props.ref?.(el);
        }}
      >
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
      </div>
    </Show>
  ),
  Tabs: (props: any) => (
    <div>
      {props.items.map((item: any) => (
        <button type="button" onClick={() => props.onChange?.(item.id)}>
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
    terminal = {
      options: {},
      scrollLines: scrollLinesSpy,
      getScrollbackLength: () => terminalScrollState.scrollbackLength,
      isAlternateScreen: () => terminalScrollState.alternateScreen,
      input: terminalInputSpy,
    };

    constructor(container: HTMLDivElement) {
      this.container = container;
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
    focus = focusSpy;
    setFontSize = vi.fn();
    setSearchResultsCallback = vi.fn();
    clearSearch = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
    clear = vi.fn();
  }

  return {
    TerminalCore: MockTerminalCore,
    getDefaultTerminalConfig: vi.fn(() => ({})),
    getThemeColors: vi.fn(() => ({ background: '#111111', foreground: '#eeeeee' })),
  };
});

vi.mock('../services/terminalTransport', () => ({
  createRedevenTerminalTransport: () => transportMocks,
  createRedevenTerminalEventSource: () => ({
    onTerminalData: () => () => undefined,
    onTerminalNameUpdate: () => () => undefined,
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
    () => ({ permissions: { can_execute: true } }),
    { state: 'ready' },
  );

  return {
    useEnvContext: () => ({
      env: envAccessor,
      openAskFlowerComposer: vi.fn(),
    }),
  };
});

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
}));

describe('TerminalPanel', () => {
  beforeEach(() => {
    terminalPrefsState.userTheme = 'system';
    terminalPrefsState.fontSize = 12;
    terminalPrefsState.fontFamilyId = 'iosevka';
    terminalPrefsState.mobileInputMode = 'floe';
    focusSpy.mockClear();
    forceResizeSpy.mockClear();
    scrollLinesSpy.mockClear();
    terminalInputSpy.mockClear();
    terminalScrollState.alternateScreen = false;
    terminalScrollState.scrollbackLength = 200;
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
    sessionsCoordinatorMocks.refresh.mockClear();
    sessionsCoordinatorMocks.updateSessionMeta.mockClear();

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
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
  });

  afterEach(() => {
    document.body.innerHTML = '';
    layoutState.mobile = false;
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
    await Promise.resolve();
    await Promise.resolve();
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
    await Promise.resolve();
    await Promise.resolve();

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
    await Promise.resolve();

    expect(host.querySelector('[data-testid="mobile-keyboard"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="dropdown-item-hide_floe_keyboard"]')).toBeTruthy();
    expect(sessionViewport?.style.getPropertyValue('--terminal-bottom-inset')).toBe('132px');
    expect(forceResizeSpy).toHaveBeenCalled();
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

  it('suppresses the system IME and matches the terminal inset to the Floe keyboard height', async () => {
    layoutState.mobile = true;
    terminalPrefsState.mobileInputMode = 'floe';

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <TerminalPanel variant="deck" />, host);
    await Promise.resolve();
    await Promise.resolve();

    const terminalInput = host.querySelector('textarea[aria-label="Terminal input"]') as HTMLTextAreaElement | null;
    expect(terminalInput?.getAttribute('inputmode')).toBe('none');
    expect(terminalInput?.getAttribute('virtualkeyboardpolicy')).toBe('manual');

    const terminalContent = host.querySelector('[data-testid="terminal-content"]') as HTMLDivElement | null;
    const terminalSurface = host.querySelector('.redeven-terminal-surface') as HTMLDivElement | null;
    const sessionViewport = terminalSurface?.parentElement as HTMLDivElement | null;

    expect(terminalContent?.style.paddingBottom).toBe('');
    expect(sessionViewport?.style.getPropertyValue('--terminal-bottom-inset')).toBe('132px');
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
    expect(terminalSurface?.style.touchAction).toBe('pan-x pinch-zoom');
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
});
