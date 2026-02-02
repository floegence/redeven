import { CommandPalette, FileBrowserDragProvider, FloeProvider, NotificationContainer } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { EnvAppShell } from './EnvAppShell';
import { REDEVEN_DECK_LAYOUT_IDS, redevenDeckPresets } from './deck/redevenDeckPresets';

function readSessionStorage(key: string): string {
  try {
    const v = sessionStorage.getItem(key);
    return v ? v.trim() : '';
  } catch {
    return '';
  }
}

const envID = readSessionStorage('redeven_env_public_id');
const storageNamespace = envID ? `redeven-envapp:${envID}` : 'redeven-envapp';
const deckStorageKey = envID ? `deck:${envID}` : 'deck';

const floeConfig = {
  storage: { namespace: storageNamespace },
  // Users frequently type in Terminal/Editor; command palette should always be available (Cmd/Ctrl+K).
  commands: { ignoreWhenTyping: false },
  deck: {
    storageKey: deckStorageKey,
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
        <ProtocolProvider>
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
