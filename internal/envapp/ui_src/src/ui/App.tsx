import { FileBrowserDragProvider, FloeProvider, NotificationContainer, useTheme } from '@floegence/floe-webapp-core';
import { onCleanup, onMount } from 'solid-js';
import { CommandPalette } from '@floegence/floe-webapp-core/ui';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { EnvAppShell } from './EnvAppShell';
import { redevenV1Contract } from './protocol/redeven_v1';
import { createUIStorageAdapter, isDesktopStateStorageAvailable } from './services/uiStorage';
import {
  createDesktopThemeStorageAdapter,
  desktopThemeBridge,
  type DesktopThemeSnapshot,
} from './services/desktopTheme';
import { installDesktopEmbeddedDragRegionSync } from './services/desktopEmbeddedDragRegions';
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
      presetsMode: 'mutable',
      presets: redevenDeckPresets,
    },
  } as const;
}

function desktopThemeSnapshotKey(snapshot: DesktopThemeSnapshot): string {
  return [
    snapshot.source,
    snapshot.resolvedTheme,
    snapshot.window.backgroundColor,
    snapshot.window.symbolColor,
  ].join(':');
}

function DesktopThemeSync() {
  const theme = useTheme();
  const shellTheme = desktopThemeBridge();

  if (shellTheme) {
    let clearThemeSwitchingFrame: number | null = null;
    let removeThemeSwitchingFrame: number | null = null;
    let lastThemeSnapshotKey = desktopThemeSnapshotKey(shellTheme.getSnapshot());

    const requestFrame = (callback: FrameRequestCallback): number => {
      if (typeof window.requestAnimationFrame === 'function') {
        return window.requestAnimationFrame(callback);
      }
      return window.setTimeout(() => callback(window.performance?.now() ?? Date.now()), 16);
    };

    const cancelFrame = (handle: number) => {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(handle);
        return;
      }
      window.clearTimeout(handle);
    };

    const clearThemeSwitching = () => {
      if (clearThemeSwitchingFrame !== null) {
        cancelFrame(clearThemeSwitchingFrame);
        clearThemeSwitchingFrame = null;
      }
      if (removeThemeSwitchingFrame !== null) {
        cancelFrame(removeThemeSwitchingFrame);
        removeThemeSwitchingFrame = null;
      }
      delete document.documentElement.dataset.themeSwitching;
    };

    const markThemeSwitching = () => {
      document.documentElement.dataset.themeSwitching = 'true';
      if (clearThemeSwitchingFrame !== null) {
        cancelFrame(clearThemeSwitchingFrame);
        clearThemeSwitchingFrame = null;
      }
      if (removeThemeSwitchingFrame !== null) {
        cancelFrame(removeThemeSwitchingFrame);
        removeThemeSwitchingFrame = null;
      }
      clearThemeSwitchingFrame = requestFrame(() => {
        clearThemeSwitchingFrame = null;
        removeThemeSwitchingFrame = requestFrame(() => {
          removeThemeSwitchingFrame = null;
          delete document.documentElement.dataset.themeSwitching;
        });
      });
    };

    const applyShellTheme = (next: DesktopThemeSnapshot) => {
      const nextThemeSnapshotKey = desktopThemeSnapshotKey(next);
      if (nextThemeSnapshotKey !== lastThemeSnapshotKey) {
        lastThemeSnapshotKey = nextThemeSnapshotKey;
        markThemeSwitching();
      }
      if (theme.theme() !== next.source) {
        theme.setTheme(next.source);
      }
    };
    applyShellTheme(shellTheme.getSnapshot());
    const unsubscribe = shellTheme.subscribe(applyShellTheme);
    onCleanup(() => {
      unsubscribe();
      clearThemeSwitching();
    });
  }

  return null;
}

export function App() {
  onMount(() => {
    const dragRegionSync = installDesktopEmbeddedDragRegionSync();
    onCleanup(() => {
      dragRegionSync?.dispose();
    });
  });

  return (
    <FloeProvider
      config={buildFloeConfig()}
      wrapAfterTheme={(renderChildren) => (
        <>
          <DesktopThemeSync />
          <ProtocolProvider contract={redevenV1Contract}>
            <FileBrowserDragProvider>
              {renderChildren()}
            </FileBrowserDragProvider>
          </ProtocolProvider>
        </>
      )}
    >
      <>
        <TerminalSessionsLifecycleSync />
        <EnvAppShell />
        <CommandPalette />
        <NotificationContainer />
      </>
    </FloeProvider>
  );
}
