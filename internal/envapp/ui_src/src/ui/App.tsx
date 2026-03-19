import { FileBrowserDragProvider, FloeProvider, NotificationContainer } from '@floegence/floe-webapp-core';
import { CommandPalette } from '@floegence/floe-webapp-core/ui';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { EnvAppShell } from './EnvAppShell';
import { redevenV1Contract } from './protocol/redeven_v1';
import { createUIStorageAdapter, isDesktopStateStorageAvailable } from './services/uiStorage';
import { resolveEnvAppStorageBinding } from './services/uiPersistence';
import { TerminalSessionsLifecycleSync } from './services/terminalSessionsLifecycleSync';
import { REDEVEN_DECK_LAYOUT_IDS, redevenDeckPresets } from './deck/redevenDeckPresets';
import { envChartThemePresets } from './chartThemePresets';

function readSessionStorage(key: string): string {
  try {
    const v = sessionStorage.getItem(key);
    return v ? v.trim() : '';
  } catch {
    return '';
  }
}

const envID = readSessionStorage('redeven_env_public_id');
const persistenceBinding = resolveEnvAppStorageBinding({
  envID,
  desktopStateStorageAvailable: isDesktopStateStorageAvailable(),
});

const floeConfig = {
  storage: {
    namespace: persistenceBinding.namespace,
    adapter: createUIStorageAdapter(),
  },
  // Users frequently type in Terminal/Editor; command palette should always be available (Cmd/Ctrl+K).
  commands: { ignoreWhenTyping: false },
  theme: {
    defaultPreset: 'default',
    presets: envChartThemePresets,
  },
  deck: {
    storageKey: persistenceBinding.deckStorageKey,
    defaultActiveLayoutId: REDEVEN_DECK_LAYOUT_IDS.default,
    presetsMode: 'immutable',
    presets: redevenDeckPresets,
  },
} as const;

export function App() {
  return (
    <FloeProvider
      config={floeConfig}
      wrapAfterTheme={(renderChildren) => (
        <ProtocolProvider contract={redevenV1Contract}>
          <TerminalSessionsLifecycleSync />
          <FileBrowserDragProvider>
            {renderChildren()}
          </FileBrowserDragProvider>
        </ProtocolProvider>
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
