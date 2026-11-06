import { render } from 'solid-js/web';
import { builtInShellThemePresets, FloeConfigProvider, LayoutProvider, NotificationProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { FilePreviewHost } from '../../../internal/envapp/ui_src/src/ui/widgets/FilePreviewHost';
import { FilePreviewContext } from '../../../internal/envapp/ui_src/src/ui/widgets/FilePreviewContext';
import { createFilePreviewWorkspace } from '../../../internal/envapp/ui_src/src/ui/widgets/createFilePreviewWorkspace';
import { EnvContext, type EnvContextValue } from '../../../internal/envapp/ui_src/src/ui/pages/EnvContext';
import { DownloadContext } from '../../../internal/envapp/ui_src/src/ui/downloads/DownloadContext';
import type { DownloadManager } from '../../../internal/envapp/ui_src/src/ui/downloads/types';
import '../../../internal/envapp/ui_src/src/index.css';

declare global { interface Window { filePreviewAcceptance: {
  files: Map<string, Uint8Array>; reads: number; open: (name: string, bytes: number[]) => Promise<void>; close: () => void;
} } }
window.filePreviewAcceptance = { files: new Map(), reads: 0, open: async () => undefined, close: () => undefined };
render(() => {
  const workspace = createFilePreviewWorkspace({ client: () => ({} as never), rpc: () => null, canWrite: () => false });
  window.filePreviewAcceptance.open = async (name, bytes) => {
    const path = '/acceptance/' + name;
    window.filePreviewAcceptance.files.set(path, new Uint8Array(bytes));
    await workspace.openPreview({ id: path, path, name, type: 'file' });
  };
  window.filePreviewAcceptance.close = () => workspace.requestClose();
  return <FloeConfigProvider config={{ storage: { enabled: false }, theme: { defaultTheme: 'light', defaultSurfaceStyle: 'soft-neumorphic', shellPresets: builtInShellThemePresets, defaultShellPreset: { light: 'porcelain-light', dark: 'classic-dark' } } }}>
    <ThemeProvider><LayoutProvider><NotificationProvider>
      <EnvContext.Provider value={{ openFlowerTurnLauncher: () => undefined, openFileBrowserAtPath: () => undefined } as unknown as EnvContextValue}>
        <DownloadContext.Provider value={{ enqueue: () => undefined } as unknown as DownloadManager}>
          <FilePreviewContext.Provider value={{ workspace, get controller() { return workspace.activeController(); }, openPreview: workspace.openPreview, closePreview: workspace.requestClose }}>
            <FilePreviewHost />
          </FilePreviewContext.Provider>
        </DownloadContext.Provider>
      </EnvContext.Provider>
    </NotificationProvider></LayoutProvider></ThemeProvider>
  </FloeConfigProvider>;
}, document.getElementById('root')!);
