import type { DesktopRendererThemeSnapshot } from '../shared/desktopTheme';
import type { RedevenLocale } from '../shared/i18n/localeMeta';
import { desktopWindowChromeSnapshotForWindow } from './windowChrome';
import type { BrowserWindow, IpcMainEvent, WebContents } from 'electron';
import { HOST_APPLICATION_WINDOW_ACTION_CHANNEL, HOST_APPLICATION_WINDOW_STATE_CHANNEL, isHostApplicationWindowAction } from '../shared/hostApplicationWindowIPC';

export function attachHostApplicationWindow(win: BrowserWindow, contents: WebContents, entryURL: string, appearance?: () => Readonly<{theme: DesktopRendererThemeSnapshot; locale: RedevenLocale}>): () => void {
  const entry = new URL(entryURL);
  const isBootstrap = (url: string): boolean => {
    try {
      const current = new URL(url);
      return current.origin === entry.origin && current.pathname === entry.pathname
        && current.pathname.endsWith('/_redeven_host_app/');
    } catch { return false; }
  };
  const publish = (): void => {
    if (win.isDestroyed() || contents.isDestroyed() || !isBootstrap(contents.getURL())) return;
    contents.send(HOST_APPLICATION_WINDOW_STATE_CHANNEL, {
      maximized: win.isMaximized() || win.isFullScreen(), minimized: win.isMinimized(),
      chrome: desktopWindowChromeSnapshotForWindow(win),
      ...appearance?.(),
    });
  };
  const receive = (event: IpcMainEvent, channel: string, action: unknown): void => {
    if (channel !== HOST_APPLICATION_WINDOW_ACTION_CHANNEL || !isHostApplicationWindowAction(action)) return;
    if (win.isDestroyed() || contents.isDestroyed() || event.sender !== contents
      || event.senderFrame !== contents.mainFrame || !isBootstrap(event.senderFrame.url)) return;
    switch (action) {
      case 'close': win.close(); return;
      case 'minimize': win.minimize(); break;
      case 'maximize': win.maximize(); break;
      case 'unmaximize':
        if (win.isFullScreen()) win.setFullScreen(false);
        else win.unmaximize();
        break;
      case 'state': break;
    }
    publish();
  };
  contents.on('ipc-message', receive);
  win.on('maximize', publish).on('unmaximize', publish).on('minimize', publish)
    .on('restore', publish).on('enter-full-screen', publish).on('leave-full-screen', publish);
  contents.once('destroyed', () => {
    contents.removeListener('ipc-message', receive);
    win.removeListener('maximize', publish).removeListener('unmaximize', publish).removeListener('minimize', publish)
      .removeListener('restore', publish).removeListener('enter-full-screen', publish).removeListener('leave-full-screen', publish);
  });
  return publish;
}
