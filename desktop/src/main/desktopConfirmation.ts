import { pathToFileURL } from 'node:url';

import { app, BrowserWindow } from 'electron';

import { desktopPaletteForResolvedTheme } from './desktopTheme';
import { buildDesktopWindowChromeOptions } from './windowChrome';
import { resolveConfirmationRendererPath } from './paths';
import type { DesktopResolvedTheme } from '../shared/desktopTheme';
import {
  desktopConfirmationActionFromURL,
  type DesktopConfirmationDialogModel,
  type DesktopConfirmationResult,
} from '../shared/desktopConfirmationContract';

function desktopConfirmationWindowHeight(model: DesktopConfirmationDialogModel): number {
  return model.detail === '' ? 224 : 244;
}

export function buildDesktopConfirmationPageURL(args: Readonly<{
  appPath: string;
  model: DesktopConfirmationDialogModel;
  resolvedTheme: DesktopResolvedTheme;
}>): string {
  const url = pathToFileURL(resolveConfirmationRendererPath({ appPath: args.appPath }));
  url.searchParams.set('theme', args.resolvedTheme);
  url.searchParams.set('model', JSON.stringify(args.model));
  return url.toString();
}

export async function showDesktopConfirmationDialog(args: Readonly<{
  model: DesktopConfirmationDialogModel;
  resolvedTheme: DesktopResolvedTheme;
  parentWindow?: BrowserWindow | null;
  platform?: NodeJS.Platform;
}>): Promise<DesktopConfirmationResult> {
  const actualParent = args.parentWindow && !args.parentWindow.isDestroyed()
    ? args.parentWindow
    : undefined;
  const platform = args.platform ?? process.platform;
  const height = desktopConfirmationWindowHeight(args.model);
  const win = new BrowserWindow({
    width: 520,
    height,
    minWidth: 480,
    minHeight: height,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    title: args.model.title,
    modal: Boolean(actualParent),
    parent: actualParent,
    autoHideMenuBar: true,
    skipTaskbar: true,
    ...buildDesktopWindowChromeOptions(platform, desktopPaletteForResolvedTheme(args.resolvedTheme).nativeWindow),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  return await new Promise<DesktopConfirmationResult>((resolve) => {
    let settled = false;

    const handleClosed = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve('cancel');
    };

    const cleanup = () => {
      win.removeListener('closed', handleClosed);
      win.webContents.removeListener('will-navigate', handleWillNavigate);
      win.webContents.removeListener('did-fail-load', handleDidFailLoad);
    };

    const settle = (result: DesktopConfirmationResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
      if (!win.isDestroyed()) {
        win.destroy();
      }
    };

    const handleDidFailLoad = () => {
      settle('cancel');
    };

    const handleNavigationAction = (rawURL: string): DesktopConfirmationResult | null => {
      return desktopConfirmationActionFromURL(rawURL);
    };

    const handleWillNavigate = (event: Electron.Event, url: string) => {
      const action = handleNavigationAction(url);
      if (!action) {
        return;
      }
      event.preventDefault();
      settle(action);
    };

    win.on('closed', handleClosed);
    win.webContents.on('will-navigate', handleWillNavigate);
    win.webContents.on('did-fail-load', handleDidFailLoad);
    win.webContents.setWindowOpenHandler(({ url }) => {
      const action = handleNavigationAction(url);
      if (action) {
        settle(action);
      }
      return { action: 'deny' };
    });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });

    const pageURL = buildDesktopConfirmationPageURL({
      appPath: app.getAppPath(),
      model: args.model,
      resolvedTheme: args.resolvedTheme,
    });
    void win.loadURL(pageURL).catch(() => {
      settle('cancel');
    });
  });
}
