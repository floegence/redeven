// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const protocolMocks = vi.hoisted(() => ({
  onSessionsChanged: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', async () => {
  const { createContext, useContext } = await import('solid-js');
  const NotificationContext = createContext<any>();
  const notification = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() };

  function NotificationProvider(props: any) {
    return (
      <NotificationContext.Provider value={notification}>
        {props.children}
      </NotificationContext.Provider>
    );
  }

  return {
    FileBrowserDragProvider: (props: any) => <>{props.children}</>,
    FloeProvider: (props: any) => {
      const renderChildren = () => <NotificationProvider>{props.children}</NotificationProvider>;
      return props.wrapAfterTheme ? props.wrapAfterTheme(renderChildren) : renderChildren();
    },
    NotificationContainer: () => <div data-testid="notification-container" />,
    useNotification: () => {
      const value = useContext(NotificationContext);
      if (!value) {
        throw new Error('NotificationContext not found');
      }
      return value;
    },
    useTheme: () => ({
      theme: () => 'system',
      setTheme: vi.fn(),
    }),
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock('@floegence/floe-webapp-protocol', async () => {
  const { createContext, useContext } = await import('solid-js');
  const ProtocolContext = createContext<any>();
  const client = { id: 'client-1' };

  return {
    ProtocolProvider: (props: any) => (
      <ProtocolContext.Provider value={{ client: () => client }}>
        {props.children}
      </ProtocolContext.Provider>
    ),
    useProtocol: () => {
      const value = useContext(ProtocolContext);
      if (!value) {
        throw new Error('ProtocolContext not found');
      }
      return value;
    },
  };
});

vi.mock('./EnvAppShell', () => ({
  EnvAppShell: () => <main data-testid="env-app-shell" />,
}));

vi.mock('./protocol/redeven_v1', () => ({
  redevenV1Contract: {},
  useRedevenRpc: () => ({
    terminal: {
      onSessionsChanged: protocolMocks.onSessionsChanged,
    },
  }),
}));

vi.mock('./services/terminalSessions', () => ({
  refreshRedevenTerminalSessionsCoordinator: vi.fn(),
}));

vi.mock('./services/uiStorage', () => ({
  createUIStorageAdapter: () => ({}),
  isDesktopStateStorageAvailable: () => false,
}));

vi.mock('./services/desktopTheme', () => ({
  createDesktopThemeStorageAdapter: () => ({}),
  desktopThemeBridge: () => null,
}));

vi.mock('./services/desktopEmbeddedDragRegions', () => ({
  installDesktopEmbeddedDragRegionSync: () => ({ dispose: vi.fn() }),
}));

vi.mock('./services/desktopWindowChrome', () => ({
  installDesktopWindowChromeDocumentSync: vi.fn(),
}));

vi.mock('./services/uiPersistence', () => ({
  resolveEnvAppStorageBinding: () => ({
    namespace: 'test-env',
    deckStorageKey: 'test-env:deck',
  }),
}));

vi.mock('./deck/redevenDeckPresets', () => ({
  REDEVEN_DECK_LAYOUT_IDS: { default: 'default' },
  redevenDeckPresets: [],
}));

describe('App provider composition', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    protocolMocks.onSessionsChanged.mockReset();
    protocolMocks.onSessionsChanged.mockReturnValue(protocolMocks.unsubscribe);
    protocolMocks.unsubscribe.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts terminal lifecycle sync inside protocol and notification providers', async () => {
    const { App } = await import('./App');
    const dispose = render(() => <App />, host);

    expect(host.querySelector('[data-testid="env-app-shell"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="notification-container"]')).not.toBeNull();
    expect(protocolMocks.onSessionsChanged).toHaveBeenCalledTimes(1);

    dispose();
    expect(protocolMocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
