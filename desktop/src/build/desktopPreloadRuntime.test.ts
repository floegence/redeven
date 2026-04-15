import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import electronPath from 'electron';
import { afterEach, describe, expect, it } from 'vitest';

import { buildDesktopPreloads } from './desktopPreloadBundle';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const electronRuntimeIntegrationTimeoutMs = 30_000;
const electronRuntimePreloadEnvName = 'REDEVEN_DESKTOP_TEST_PRELOAD_PATH';
const electronRuntimePayloadStartMarker = '__REDEVEN_DESKTOP_RUNTIME_PAYLOAD_START__';
const electronRuntimePayloadEndMarker = '__REDEVEN_DESKTOP_RUNTIME_PAYLOAD_END__';
const linuxElectronLaunchArgs = ['--no-sandbox', '--disable-setuid-sandbox'] as const;

function getElectronRuntimeLaunch(
  platform: NodeJS.Platform,
  electronBinary: string,
  runtimeScript: string,
  hasDisplayServer: boolean,
): { command: string; args: string[] } {
  const electronArgs = platform === 'linux'
    ? [...linuxElectronLaunchArgs, runtimeScript]
    : [runtimeScript];

  if (platform === 'linux' && !hasDisplayServer) {
    // Headless Linux CI needs a virtual display before BrowserWindow can start.
    return {
      command: 'xvfb-run',
      args: ['-a', electronBinary, ...electronArgs],
    };
  }

  if (platform === 'linux') {
    // Linux CI cannot use Electron's downloaded chrome-sandbox helper.
    return {
      command: electronBinary,
      args: electronArgs,
    };
  }

  return {
    command: electronBinary,
    args: electronArgs,
  };
}

function extractElectronRuntimePayload(stdout: string): string {
  const startIndex = stdout.lastIndexOf(electronRuntimePayloadStartMarker);
  if (startIndex === -1) {
    throw new Error(`Missing runtime payload start marker in stdout:\n${stdout}`);
  }

  const payloadStartIndex = startIndex + electronRuntimePayloadStartMarker.length;
  const endIndex = stdout.indexOf(electronRuntimePayloadEndMarker, payloadStartIndex);
  if (endIndex === -1) {
    throw new Error(`Missing runtime payload end marker in stdout:\n${stdout}`);
  }

  return stdout.slice(payloadStartIndex, endIndex);
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (!tempDir) continue;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe('desktop preload runtime', () => {
  it('adds Linux-only Electron launch flags for the spawned runtime process', () => {
    expect(getElectronRuntimeLaunch('linux', 'electron', 'runtime.js', true)).toEqual({
      command: 'electron',
      args: ['--no-sandbox', '--disable-setuid-sandbox', 'runtime.js'],
    });
  });

  it('wraps headless Linux launches in xvfb-run', () => {
    expect(getElectronRuntimeLaunch('linux', 'electron', 'runtime.js', false)).toEqual({
      command: 'xvfb-run',
      args: ['-a', 'electron', '--no-sandbox', '--disable-setuid-sandbox', 'runtime.js'],
    });
  });

  it('keeps the default runtime launch on non-Linux platforms', () => {
    expect(getElectronRuntimeLaunch('darwin', 'electron', 'runtime.js', false)).toEqual({
      command: 'electron',
      args: ['runtime.js'],
    });
  });

  it('extracts the marked runtime payload from noisy stdout', () => {
    const payload = '{"main":{"hasAskFlowerBridge":true},"child":{"hasAskFlowerBridge":true}}';
    expect(
      extractElectronRuntimePayload(
        `noise before\n${electronRuntimePayloadStartMarker}${payload}${electronRuntimePayloadEndMarker}\nnoise after`,
      ),
    ).toBe(payload);
  });

  it('exposes the expected desktop bridges for utility and session preload surfaces', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preload-runtime-'));
    tempDirs.push(tempDir);

    const outDir = path.join(tempDir, 'preload');
    await buildDesktopPreloads({
      desktopRoot: process.cwd(),
      outDir,
    });

    const runtimeScript = path.join(tempDir, 'runtime.js');
    await fs.writeFile(runtimeScript, `
const { app, BrowserWindow, ipcMain } = require('electron');

const preload = process.env.${electronRuntimePreloadEnvName};

if (!preload) {
  throw new Error('Missing ${electronRuntimePreloadEnvName}');
}

let themeSource = 'system';

function resolveTheme(source) {
  return source === 'dark' ? 'dark' : 'light';
}

function buildThemeSnapshot(source = themeSource) {
  const resolvedTheme = resolveTheme(source);
  return {
    source,
    resolvedTheme,
    window: {
      backgroundColor: resolvedTheme === 'dark' ? '#0e121b' : '#f3e5de',
      symbolColor: resolvedTheme === 'dark' ? '#f9fafb' : '#181311',
    },
  };
}

ipcMain.on('redeven-desktop:theme-get-snapshot', (event) => {
  event.returnValue = buildThemeSnapshot();
});

ipcMain.on('redeven-desktop:theme-set-source', (event, nextSource) => {
  if (nextSource === 'system' || nextSource === 'light' || nextSource === 'dark') {
    themeSource = nextSource;
  }
  event.returnValue = buildThemeSnapshot();
});

function snapshotBridgeState() {
  return JSON.stringify({
    hasAskFlowerBridge: typeof window.redevenDesktopAskFlowerHandoff === 'object'
      && typeof window.redevenDesktopAskFlowerHandoff?.requestMainWindowHandoff === 'function'
      && typeof window.redevenDesktopAskFlowerHandoff?.onMainWindowHandoff === 'function',
    hasDesktopLauncherBridge: typeof window.redevenDesktopLauncher === 'object'
      && typeof window.redevenDesktopLauncher?.performAction === 'function'
      && typeof window.redevenDesktopLauncher?.getSnapshot === 'function',
    hasDesktopSettingsBridge: typeof window.redevenDesktopSettings === 'object'
      && typeof window.redevenDesktopSettings?.save === 'function'
      && typeof window.redevenDesktopSettings?.cancel === 'function',
    hasDesktopSessionContextBridge: typeof window.redevenDesktopSessionContext === 'object'
      && typeof window.redevenDesktopSessionContext?.getSnapshot === 'function',
    hasDesktopShellBridge: typeof window.redevenDesktopShell === 'object'
      && typeof window.redevenDesktopShell?.openConnectionCenter === 'function'
      && typeof window.redevenDesktopShell?.openAdvancedSettings === 'function'
      && typeof window.redevenDesktopShell?.restartManagedRuntime === 'function',
    hasStateStorageBridge: typeof window.redevenDesktopStateStorage === 'object',
    hasDesktopThemeBridge: typeof window.redevenDesktopTheme === 'object'
      && typeof window.redevenDesktopTheme?.getSnapshot === 'function'
      && typeof window.redevenDesktopTheme?.setSource === 'function'
      && typeof window.redevenDesktopTheme?.subscribe === 'function',
  });
}

function createBrowserWindow() {
  return new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
}

app.commandLine.appendSwitch('headless');
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const mainWindow = createBrowserWindow();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const childWindow = createBrowserWindow();
    void childWindow.loadURL(url);
    void childWindow.webContents.once('did-finish-load', async () => {
      const child = JSON.parse(await childWindow.webContents.executeJavaScript('(' + snapshotBridgeState.toString() + ')()'));
      const main = JSON.parse(await mainWindow.webContents.executeJavaScript('(' + snapshotBridgeState.toString() + ')()'));
      process.stdout.write('${electronRuntimePayloadStartMarker}' + JSON.stringify({ main, child }) + '${electronRuntimePayloadEndMarker}');
      await app.quit();
    });
    return { action: 'deny' };
  });

  await mainWindow.loadURL('data:text/html,<html><body>main</body></html>');
  await mainWindow.webContents.executeJavaScript('window.open("data:text/html,<html><body>child</body></html>", "redeven_detached_file_preview", "noopener,noreferrer")');
});
`, 'utf8');

    type RuntimeBridgeSnapshot = {
      main: {
        hasAskFlowerBridge: boolean;
        hasDesktopLauncherBridge: boolean;
        hasDesktopSettingsBridge: boolean;
        hasDesktopSessionContextBridge: boolean;
        hasDesktopShellBridge: boolean;
        hasStateStorageBridge: boolean;
        hasDesktopThemeBridge: boolean;
      };
      child: {
        hasAskFlowerBridge: boolean;
        hasDesktopLauncherBridge: boolean;
        hasDesktopSettingsBridge: boolean;
        hasDesktopSessionContextBridge: boolean;
        hasDesktopShellBridge: boolean;
        hasStateStorageBridge: boolean;
        hasDesktopThemeBridge: boolean;
      };
    };

    async function runSnapshot(preloadPath: string): Promise<RuntimeBridgeSnapshot> {
      const electronRuntimeLaunch = getElectronRuntimeLaunch(
        process.platform,
        String(electronPath),
        runtimeScript,
        Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
      );

      const { stdout } = await execFileAsync(electronRuntimeLaunch.command, electronRuntimeLaunch.args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
          [electronRuntimePreloadEnvName]: preloadPath,
        },
        timeout: electronRuntimeIntegrationTimeoutMs,
        maxBuffer: 1024 * 1024,
      });

      return JSON.parse(extractElectronRuntimePayload(stdout)) as RuntimeBridgeSnapshot;
    }

    const utility = await runSnapshot(path.join(outDir, 'utility.js'));
    expect(utility.main.hasDesktopLauncherBridge).toBe(true);
    expect(utility.main.hasDesktopSettingsBridge).toBe(true);
    expect(utility.main.hasAskFlowerBridge).toBe(false);
    expect(utility.main.hasDesktopSessionContextBridge).toBe(false);
    expect(utility.main.hasDesktopShellBridge).toBe(true);
    expect(utility.main.hasStateStorageBridge).toBe(true);
    expect(utility.main.hasDesktopThemeBridge).toBe(true);
    expect(utility.child).toEqual(utility.main);

    const session = await runSnapshot(path.join(outDir, 'session.js'));
    expect(session.main.hasDesktopLauncherBridge).toBe(false);
    expect(session.main.hasDesktopSettingsBridge).toBe(false);
    expect(session.main.hasAskFlowerBridge).toBe(true);
    expect(session.main.hasDesktopSessionContextBridge).toBe(true);
    expect(session.main.hasDesktopShellBridge).toBe(true);
    expect(session.main.hasStateStorageBridge).toBe(true);
    expect(session.main.hasDesktopThemeBridge).toBe(true);
    expect(session.child).toEqual(session.main);
  }, electronRuntimeIntegrationTimeoutMs);
});
