import { FileBrowserDragProvider, FloeProvider, NotificationContainer, useTheme } from '@floegence/floe-webapp-core';
import { onCleanup } from 'solid-js';
import { CommandPalette } from '@floegence/floe-webapp-core/ui';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { EnvAppShell } from './EnvAppShell';
import { redevenV1Contract } from './protocol/redeven_v1';
import { createUIStorageAdapter, isDesktopStateStorageAvailable } from './services/uiStorage';
import { createDesktopThemeStorageAdapter, desktopThemeBridge } from './services/desktopTheme';
import { installDesktopWindowChromeDocumentSync } from './services/desktopWindowChrome';
import { resolveEnvAppStorageBinding } from './services/uiPersistence';
import { TerminalSessionsLifecycleSync } from './services/terminalSessionsLifecycleSync';
import { REDEVEN_DECK_LAYOUT_IDS, redevenDeckPresets } from './deck/redevenDeckPresets';

function readSessionStorage(key: string): string {
  try {
    const v = sessionStorage.getItem(key);
    return v ? v.trim() : '';
  } catch {
    return '';
  }
}

installDesktopWindowChromeDocumentSync();

const envID = readSessionStorage('redeven_env_public_id');
const persistenceBinding = resolveEnvAppStorageBinding({
  envID,
  desktopStateStorageAvailable: isDesktopStateStorageAvailable(),
});

function buildFloeConfig() {
  const shellTheme = desktopThemeBridge();

  return {
    storage: {
      namespace: persistenceBinding.namespace,
      adapter: createDesktopThemeStorageAdapter(
        createUIStorageAdapter(),
        persistenceBinding.namespace,
        'theme',
        shellTheme,
      ),
    },
    theme: {
      storageKey: 'theme',
      defaultTheme: shellTheme?.getSnapshot().source ?? 'system',
    },
    // Users frequently type in Terminal/Editor; command palette should always be available (Cmd/Ctrl+K).
    commands: { ignoreWhenTyping: false },
    accessibility: {
      mainContentId: 'redeven-env-main',
      skipLinkLabel: 'Skip to Redeven environment content',
      topBarLabel: 'Redeven environment toolbar',
      primaryNavigationLabel: 'Redeven environment navigation',
      mobileNavigationLabel: 'Redeven environment navigation',
      sidebarLabel: 'Redeven environment sidebar',
      mainLabel: 'Redeven environment content',
    },
    deck: {
      storageKey: persistenceBinding.deckStorageKey,
      defaultActiveLayoutId: REDEVEN_DECK_LAYOUT_IDS.default,
      presetsMode: 'immutable',
      presets: redevenDeckPresets,
    },
  } as const;
}

function DesktopThemeSync() {
  const theme = useTheme();
  const shellTheme = desktopThemeBridge();

  if (shellTheme) {
    const applyShellTheme = (next: Readonly<{ source: 'system' | 'light' | 'dark' }>) => {
      if (theme.theme() !== next.source) {
        theme.setTheme(next.source);
      }
    };
    applyShellTheme(shellTheme.getSnapshot());
    const unsubscribe = shellTheme.subscribe(applyShellTheme);
    onCleanup(unsubscribe);
  }

  return null;
}

export function App() {
  return (
    <FloeProvider
      config={buildFloeConfig()}
      wrapAfterTheme={(renderChildren) => (
        <>
          <DesktopThemeSync />
          <ProtocolProvider contract={redevenV1Contract}>
            <TerminalSessionsLifecycleSync />
            <FileBrowserDragProvider>
              {renderChildren()}
            </FileBrowserDragProvider>
          </ProtocolProvider>
        </>
      )}
    >
      <>
        <EnvAppShell />
        <CommandPalette />
        <NotificationContainer />
      </>
    </FloeProvider>
  );
}
