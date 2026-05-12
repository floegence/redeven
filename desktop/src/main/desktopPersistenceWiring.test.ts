import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readDesktopFile(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

describe('desktop persistence wiring', () => {
  it('splits utility and session preload surfaces by bridge responsibility', () => {
    const utilityPreloadSrc = readDesktopFile('../preload/utility.ts');
    const sessionPreloadSrc = readDesktopFile('../preload/session.ts');

    expect(utilityPreloadSrc).toContain("import { bootstrapDesktopLauncherBridge } from './desktopLauncher';");
    expect(utilityPreloadSrc).toContain('bootstrapDesktopLauncherBridge();');
    expect(utilityPreloadSrc).toContain("import { bootstrapDesktopSettingsBridge } from './desktopSettingsBridge';");
    expect(utilityPreloadSrc).toContain('bootstrapDesktopSettingsBridge();');
    expect(utilityPreloadSrc).toContain("import { bootstrapDesktopShellBridge } from './desktopShell';");
    expect(utilityPreloadSrc).toContain('bootstrapDesktopShellBridge();');
    expect(utilityPreloadSrc).toContain("import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';");
    expect(utilityPreloadSrc).toContain('bootstrapDesktopStateStorageBridge();');
    expect(utilityPreloadSrc).not.toContain('bootstrapDesktopAskFlowerHandoffBridge');
    expect(utilityPreloadSrc).not.toContain('bootstrapDesktopSessionContextBridge');

    expect(sessionPreloadSrc).toContain("import { bootstrapDesktopEmbeddedDragHostBridge } from './desktopEmbeddedDragHost';");
    expect(sessionPreloadSrc).toContain('bootstrapDesktopEmbeddedDragHostBridge();');
    expect(sessionPreloadSrc).toContain("import { bootstrapDesktopSessionContextBridge } from './desktopSessionContext';");
    expect(sessionPreloadSrc).toContain('bootstrapDesktopSessionContextBridge();');
    expect(sessionPreloadSrc).toContain("import { bootstrapDesktopShellBridge } from './desktopShell';");
    expect(sessionPreloadSrc).toContain('bootstrapDesktopShellBridge();');
    expect(sessionPreloadSrc).toContain("import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';");
    expect(sessionPreloadSrc).toContain('bootstrapDesktopStateStorageBridge();');
    expect(sessionPreloadSrc).toContain("import { bootstrapDesktopThemeBridge } from './windowTheme';");
    expect(sessionPreloadSrc).toContain('bootstrapDesktopThemeBridge();');
    expect(sessionPreloadSrc).not.toContain('bootstrapDesktopAskFlowerHandoffBridge');
    expect(sessionPreloadSrc).not.toContain('bootstrapDesktopLauncherBridge');
    expect(sessionPreloadSrc).not.toContain('bootstrapDesktopSettingsBridge');
  });

  it('keeps electron main wired to the desktop state store, utility windows, and session-scoped ownership maps', () => {
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
    expect(mainSrc).toContain('ipcMain.on(DESKTOP_SESSION_CONTEXT_GET_CHANNEL');
    expect(mainSrc).toContain('ipcMain.on(DESKTOP_SESSION_APP_READY_CHANNEL');
    expect(mainSrc).toContain('DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL');
    expect(mainSrc).toContain('DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL');
    expect(mainSrc).toContain('DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL');
    expect(mainSrc).toContain('normalizeDesktopLauncherActionRequest');
    expect(mainSrc).toContain('DESKTOP_SHELL_OPEN_WINDOW_CHANNEL');
    expect(mainSrc).toContain('normalizeDesktopShellOpenWindowRequest');
    expect(mainSrc).toContain('DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL');
    expect(mainSrc).toContain('normalizeDesktopShellWindowCommandRequest');
    expect(mainSrc).toContain('DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL');
    expect(mainSrc).toContain('DESKTOP_SHELL_OPEN_DASHBOARD_CHANNEL');
    expect(mainSrc).toContain('normalizeDesktopShellOpenExternalURLRequest');
    expect(mainSrc).toContain('const utilityWindowKindByWebContentsID = new Map<number, DesktopUtilityWindowKind>();');
    expect(mainSrc).toContain("from './windowRecord';");
    expect(mainSrc).toContain('DesktopTrackedWindow');
    expect(mainSrc).toContain('trackBrowserWindow');
    expect(mainSrc).toContain('liveTrackedBrowserWindow');
    expect(mainSrc).toContain("const UTILITY_WINDOW_KINDS = ['launcher'] as const;");
    expect(mainSrc).toContain('const sessionKeyByWebContentsID = new Map<number, DesktopSessionKey>();');
    expect(mainSrc).toContain('const DESKTOP_GPU_TILE_MEMORY_BUDGET_MB = 2048;');
    expect(mainSrc).toContain("app.commandLine.appendSwitch('force-gpu-mem-available-mb', String(DESKTOP_GPU_TILE_MEMORY_BUDGET_MB));");
    expect(mainSrc).toContain("function windowSurfaceForRole(role: CreateBrowserWindowArgs['role']): DesktopWindowSurface {");
    expect(mainSrc).toContain("return role === 'launcher' ? 'utility' : 'session';");
    expect(mainSrc).toContain("const preloadPath = surface === 'utility'");
    expect(mainSrc).toContain("resolveUtilityPreloadPath({ appPath: app.getAppPath() })");
    expect(mainSrc).toContain("resolveSessionPreloadPath({ appPath: app.getAppPath() })");
    expect(mainSrc).toContain('preload: preloadPath,');
    expect(mainSrc).toContain("stateKey: utilityWindowStateKey()");
    expect(mainSrc).toContain("stateKey: sessionWindowStateKey(sessionKey)");
    expect(mainSrc).toContain('sessionChildWindowStateKey(sessionKey, childKey)');
    expect(mainSrc).toContain('child_windows: Map<string, DesktopTrackedWindow>;');
    expect(mainSrc).toContain("setLauncherViewState({");
    expect(mainSrc).toContain("surface: 'connect_environment',");
    expect(mainSrc).not.toContain('handoffAskFlowerToOwningSession');
  });
});
