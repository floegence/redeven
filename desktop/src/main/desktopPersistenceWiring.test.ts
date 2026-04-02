import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readDesktopFile(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

describe('desktop persistence wiring', () => {
  it('keeps the preload state bridge enabled for desktop browser windows', () => {
    const preloadSrc = readDesktopFile('../preload/browser.ts');

    expect(preloadSrc).toContain("import { bootstrapDesktopAskFlowerHandoffBridge } from './askFlowerHandoff';");
    expect(preloadSrc).toContain('bootstrapDesktopAskFlowerHandoffBridge();');
    expect(preloadSrc).toContain("import { bootstrapDesktopLauncherBridge } from './desktopLauncher';");
    expect(preloadSrc).toContain('bootstrapDesktopLauncherBridge();');
    expect(preloadSrc).toContain("import { bootstrapDesktopSettingsBridge } from './desktopSettingsBridge';");
    expect(preloadSrc).toContain('bootstrapDesktopSettingsBridge();');
    expect(preloadSrc).toContain("import { bootstrapDesktopShellBridge } from './desktopShell';");
    expect(preloadSrc).toContain('bootstrapDesktopShellBridge();');
    expect(preloadSrc).toContain("import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';");
    expect(preloadSrc).toContain('bootstrapDesktopStateStorageBridge();');
  });

  it('keeps electron main wired to the desktop state store and ipc channels', () => {
    const mainSrc = readDesktopFile('./main.ts');

    expect(mainSrc).toContain("from './desktopStateStore';");
    expect(mainSrc).toContain('defaultDesktopStateStorePath');
    expect(mainSrc).toContain('DesktopStateStore');
    expect(mainSrc).toContain("from './windowState';");
    expect(mainSrc).toContain('applyRestoredWindowState');
    expect(mainSrc).toContain('attachDesktopWindowStatePersistence');
    expect(mainSrc).toContain('restoreBrowserWindowBounds');
    expect(mainSrc).toContain('ipcMain.on(DESKTOP_STATE_GET_CHANNEL');
    expect(mainSrc).toContain('ipcMain.on(DESKTOP_STATE_SET_CHANNEL');
    expect(mainSrc).toContain('ipcMain.on(DESKTOP_STATE_REMOVE_CHANNEL');
    expect(mainSrc).toContain('ipcMain.on(DESKTOP_STATE_KEYS_CHANNEL');
    expect(mainSrc).toContain('DESKTOP_ASK_FLOWER_HANDOFF_REQUEST_CHANNEL');
    expect(mainSrc).toContain('DESKTOP_ASK_FLOWER_HANDOFF_DELIVER_CHANNEL');
    expect(mainSrc).toContain('normalizeDesktopAskFlowerHandoffPayload');
    expect(mainSrc).toContain('DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL');
    expect(mainSrc).toContain('DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL');
    expect(mainSrc).toContain('normalizeDesktopLauncherActionRequest');
    expect(mainSrc).toContain('DESKTOP_SHELL_OPEN_WINDOW_CHANNEL');
    expect(mainSrc).toContain('normalizeDesktopShellOpenWindowRequest');
    expect(mainSrc).toContain('DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL');
    expect(mainSrc).toContain('normalizeDesktopShellOpenExternalURLRequest');
    expect(mainSrc).toContain('openDesktopWelcomeWindow');
    expect(mainSrc).toContain('openAdvancedSettingsWindow');
    expect(mainSrc).toContain('resolveWelcomeRendererPath');
    expect(mainSrc).toContain("const browserPreloadPath = resolveBrowserPreloadPath({ appPath: app.getAppPath() });");
    expect(mainSrc).toContain('preload: browserPreloadPath,');
    expect(mainSrc).not.toContain('usesDesktopWindowThemeOverlay(process.platform)');
    expect(mainSrc).toContain("const win = createBrowserWindow(targetURL, undefined, '', 'window:main');");
    expect(mainSrc).toContain('queueMainWindowAskFlowerHandoff(payload);');
    expect(mainSrc).toContain('focusMainWindow({ stealAppFocus: true });');
    expect(mainSrc).toContain('registerWindowStatePersistence(win, windowStateKey);');
  });
});
