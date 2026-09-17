import { BrowserWindow, session } from 'electron';
import { CodeSpaceNativeWindow } from '../../src/main/codespaceNativeWindows';
import { createNativeCodeSpaceGateway, type NativeCodeSpaceGateway, type NativeCodeSpaceRoute } from '../../src/main/codespaceNativeGateway';
import { NativeCodeSpaceProfiles } from '../../src/main/codespaceNativeProfiles';
import { installNativeCodeSpaceSession } from '../../src/main/codespaceNativeSession';
import { buildCodespaceLoadingDocumentURL } from '../../src/main/codespaceLoadingDocument';
import { desktopSemanticPaletteForShellTheme, desktopWindowThemeSnapshotForShellTheme } from '../../src/main/desktopTheme';

/** Real Electron adapter around the same navigation owner used by Desktop main. */
export function createNativeFixtureWindow(options: {
  identity: string;
  profileFile: string;
  route: () => Promise<NativeCodeSpaceRoute>;
  show?: boolean;
}) {
  const partition = `persist:native-fixture:${options.identity}`;
  const webSession = session.fromPartition(partition);
  const window = new BrowserWindow({
    show: options.show ?? false, width: 1440, height: 1000,
    webPreferences: { partition, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  let gateway: NativeCodeSpaceGateway;
  let loadingFinished = false;
  let ready = false;
  window.webContents.on('did-finish-load', () => {
    if (window.webContents.getURL().startsWith('data:')) loadingFinished = true;
  });
  const owner = new CodeSpaceNativeWindow({
    identity: options.identity,
    profiles: () => new NativeCodeSpaceProfiles(options.profileFile),
    window: {
      loadURL: (url) => window.loadURL(url),
      getURL: () => window.webContents.getURL(),
      isDestroyed: () => window.isDestroyed(),
      present: () => { if (options.show) window.show(); },
      stop: () => window.webContents.stop(),
      destroy: () => window.destroy(),
      prepareSession: () => webSession.setProxy({ mode: 'direct' }),
      installSession: (nextGateway) => installNativeCodeSpaceSession(webSession, nextGateway, window.webContents.id),
    },
    loadingURL: (copy) => buildCodespaceLoadingDocumentURL('native-smoke', {
      source: 'light', resolvedTheme: 'light', activeShellTheme: 'mist',
      shellThemes: { version: 1, light: 'mist', dark: 'forest' },
      window: desktopWindowThemeSnapshotForShellTheme('mist'), semantic: desktopSemanticPaletteForShellTheme('mist'),
    }, copy),
    createRoute: () => {
      if (!loadingFinished) throw new Error('editor route started before the loading document finished');
      return options.route();
    },
    createGateway: async (route, port) => {
      gateway = await createNativeCodeSpaceGateway(route, port);
      return gateway;
    },
    onReady: () => {
      if (new URL(window.webContents.getURL()).origin !== gateway.origin) throw new Error('editor acknowledged the loading document');
      ready = true;
    },
    onFailure: (failure) => console.error('Native window failure:', JSON.stringify(failure)),
  });
  window.once('closed', () => { void owner.close(false); });
  return { window, owner, get gateway() { return gateway; }, get ready() { return ready; } };
}
