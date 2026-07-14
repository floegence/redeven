import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';

import electronPath from 'electron';
import { afterEach, describe, expect, it } from 'vitest';

import { buildDesktopPreloads } from './desktopPreloadBundle';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const electronRuntimeIntegrationTimeoutMs = 60_000;
const electronRuntimeIntegrationTestTimeoutMs = electronRuntimeIntegrationTimeoutMs * 3;
const electronRuntimePreloadEnvName = 'REDEVEN_DESKTOP_TEST_PRELOAD_PATH';
const electronRuntimePayloadStartMarker = '__REDEVEN_DESKTOP_RUNTIME_PAYLOAD_START__';
const electronRuntimePayloadEndMarker = '__REDEVEN_DESKTOP_RUNTIME_PAYLOAD_END__';
const linuxElectronLaunchArgs = ['--no-sandbox', '--disable-setuid-sandbox'] as const;

function getElectronRuntimeLaunch(
  platform: NodeJS.Platform,
  electronBinary: string,
  runtimeScript: string,
  hasDisplayServer: boolean,
  userDataDir: string,
): { command: string; args: string[] } {
  const isolatedProfileArg = `--user-data-dir=${userDataDir}`;
  const electronArgs = platform === 'linux'
    ? [...linuxElectronLaunchArgs, isolatedProfileArg, runtimeScript]
    : [isolatedProfileArg, runtimeScript];

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
    expect(getElectronRuntimeLaunch('linux', 'electron', 'runtime.js', true, '/tmp/runtime-profile')).toEqual({
      command: 'electron',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--user-data-dir=/tmp/runtime-profile', 'runtime.js'],
    });
  });

  it('wraps headless Linux launches in xvfb-run', () => {
    expect(getElectronRuntimeLaunch('linux', 'electron', 'runtime.js', false, '/tmp/runtime-profile')).toEqual({
      command: 'xvfb-run',
      args: ['-a', 'electron', '--no-sandbox', '--disable-setuid-sandbox', '--user-data-dir=/tmp/runtime-profile', 'runtime.js'],
    });
  });

  it('keeps the default runtime launch on non-Linux platforms', () => {
    expect(getElectronRuntimeLaunch('darwin', 'electron', 'runtime.js', false, '/tmp/runtime-profile')).toEqual({
      command: 'electron',
      args: ['--user-data-dir=/tmp/runtime-profile', 'runtime.js'],
    });
  });

  it('extracts the marked runtime payload from noisy stdout', () => {
    const payload = '{"main":{"hasDesktopShellBridge":true},"child":{"hasDesktopShellBridge":true}}';
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

ipcMain.on('redeven-desktop:language-get-snapshot', (event) => {
  event.returnValue = {
    preference: 'system',
    resolved_locale: 'en-US',
    source: 'fallback',
    system_candidates: [],
  };
});

ipcMain.on('redeven-desktop:language-set-preference', (event, preference) => {
  event.returnValue = {
    preference,
    resolved_locale: preference === 'system' ? 'en-US' : preference,
    source: preference === 'system' ? 'fallback' : 'explicit',
    system_candidates: [],
  };
});

ipcMain.on('redeven-desktop:window-chrome-get-snapshot', (event) => {
  event.returnValue = {
    mode: 'hidden-inset',
    controlsSide: 'left',
    titleBarHeight: 40,
    contentInsetStart: 84,
    contentInsetEnd: 16,
  };
});

ipcMain.on('redeven-desktop:session-context-get', (event) => {
  event.returnValue = {
    local_environment_id: 'local',
    renderer_storage_scope_id: 'local',
  };
});

function snapshotBridgeState() {
  return JSON.stringify({
    hasDesktopLauncherBridge: typeof window.redevenDesktopLauncher === 'object'
      && typeof window.redevenDesktopLauncher?.performAction === 'function'
      && typeof window.redevenDesktopLauncher?.getSnapshot === 'function',
    hasDesktopSettingsBridge: typeof window.redevenDesktopSettings === 'object'
      && typeof window.redevenDesktopSettings?.save === 'function'
      && typeof window.redevenDesktopSettings?.cancel === 'function'
      && typeof window.redevenDesktopSettings?.requestRuntimeFlower === 'function',
    hasDesktopSessionContextBridge: typeof window.redevenDesktopSessionContext === 'object'
      && typeof window.redevenDesktopSessionContext?.getSnapshot === 'function'
      && typeof window.redevenDesktopSessionContext?.notifyAppReady === 'function',
    hasDesktopEmbeddedDragBridge: typeof window.redevenDesktopEmbeddedDragRegions === 'object'
      && typeof window.redevenDesktopEmbeddedDragRegions?.setSnapshot === 'function'
      && typeof window.redevenDesktopEmbeddedDragRegions?.clear === 'function',
    hasDesktopShellBridge: typeof window.redevenDesktopShell === 'object'
      && typeof window.redevenDesktopShell?.openConnectionCenter === 'function'
      && typeof window.redevenDesktopShell?.openAdvancedSettings === 'function'
      && typeof window.redevenDesktopShell?.openDashboard === 'function'
      && typeof window.redevenDesktopShell?.closeWindow === 'function'
      && typeof window.redevenDesktopShell?.minimizeWindow === 'function'
      && typeof window.redevenDesktopShell?.toggleFullScreenWindow === 'function'
      && typeof window.redevenDesktopShell?.getRuntimeMaintenanceContext === 'function'
      && typeof window.redevenDesktopShell?.performRuntimeMaintenanceAction === 'function'
      && typeof window.redevenDesktopShell?.restartManagedRuntime === 'function',
    hasDesktopDownloadsBridge: typeof window.redevenDesktopDownloads === 'object'
      && typeof window.redevenDesktopDownloads?.prepare === 'function'
      && typeof window.redevenDesktopDownloads?.write === 'function'
      && typeof window.redevenDesktopDownloads?.complete === 'function'
      && typeof window.redevenDesktopDownloads?.abort === 'function'
      && typeof window.redevenDesktopDownloads?.reveal === 'function'
      && typeof window.redevenDesktopDownloads?.open === 'function',
    hasDesktopCodeWorkspaceBridge: typeof window.redevenDesktopCodeWorkspace === 'object'
      && typeof window.redevenDesktopCodeWorkspace?.prepareWorkspaceEngine === 'function'
      && typeof window.redevenDesktopCodeWorkspace?.prepareWorkspaceEnginePackage === 'function'
      && typeof window.redevenDesktopCodeWorkspace?.readWorkspaceEnginePackageChunk === 'function'
      && typeof window.redevenDesktopCodeWorkspace?.disposeWorkspaceEnginePackage === 'function',
    hasStateStorageBridge: typeof window.redevenDesktopStateStorage === 'object',
    hasDesktopThemeBridge: typeof window.redevenDesktopTheme === 'object'
      && typeof window.redevenDesktopTheme?.getSnapshot === 'function'
      && typeof window.redevenDesktopTheme?.setSource === 'function'
      && typeof window.redevenDesktopTheme?.subscribe === 'function',
    hasDesktopLanguageBridge: typeof window.redevenDesktopLanguage === 'object'
      && typeof window.redevenDesktopLanguage?.getSnapshot === 'function'
      && typeof window.redevenDesktopLanguage?.setPreference === 'function'
      && typeof window.redevenDesktopLanguage?.subscribe === 'function',
    hasDesktopWindowChromeBridge: typeof window.redevenDesktopWindowChrome === 'object'
      && typeof window.redevenDesktopWindowChrome?.getSnapshot === 'function'
      && typeof window.redevenDesktopWindowChrome?.subscribe === 'function',
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
  try {
    const mainWindow = createBrowserWindow();
    const childWindow = createBrowserWindow();

    await mainWindow.loadURL('data:text/html,<html><body>main</body></html>');
    await childWindow.loadURL('data:text/html,<html><body>child</body></html>');
    const child = JSON.parse(await childWindow.webContents.executeJavaScript('(' + snapshotBridgeState.toString() + ')()'));
    const main = JSON.parse(await mainWindow.webContents.executeJavaScript('(' + snapshotBridgeState.toString() + ')()'));
    await new Promise((resolve) => {
      process.stdout.write('${electronRuntimePayloadStartMarker}' + JSON.stringify({ main, child }) + '${electronRuntimePayloadEndMarker}', resolve);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  } finally {
    await app.quit();
  }
}).catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
  app.quit();
});
`, 'utf8');

    type RuntimeBridgeSnapshot = {
      main: {
        hasDesktopLauncherBridge: boolean;
        hasDesktopSettingsBridge: boolean;
        hasDesktopSessionContextBridge: boolean;
        hasDesktopEmbeddedDragBridge: boolean;
        hasDesktopShellBridge: boolean;
        hasDesktopDownloadsBridge: boolean;
        hasDesktopCodeWorkspaceBridge: boolean;
        hasStateStorageBridge: boolean;
        hasDesktopThemeBridge: boolean;
        hasDesktopLanguageBridge: boolean;
        hasDesktopWindowChromeBridge: boolean;
      };
      child: {
        hasDesktopLauncherBridge: boolean;
        hasDesktopSettingsBridge: boolean;
        hasDesktopSessionContextBridge: boolean;
        hasDesktopEmbeddedDragBridge: boolean;
        hasDesktopShellBridge: boolean;
        hasDesktopDownloadsBridge: boolean;
        hasDesktopCodeWorkspaceBridge: boolean;
        hasStateStorageBridge: boolean;
        hasDesktopThemeBridge: boolean;
        hasDesktopLanguageBridge: boolean;
        hasDesktopWindowChromeBridge: boolean;
      };
    };

    async function runSnapshot(preloadPath: string): Promise<RuntimeBridgeSnapshot> {
      const profileName = path.basename(preloadPath, path.extname(preloadPath));
      const electronRuntimeLaunch = getElectronRuntimeLaunch(
        process.platform,
        String(electronPath),
        runtimeScript,
        Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
        path.join(tempDir, `electron-user-data-${profileName}`),
      );

      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(electronRuntimeLaunch.command, electronRuntimeLaunch.args, {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
            [electronRuntimePreloadEnvName]: preloadPath,
          },
          timeout: electronRuntimeIntegrationTimeoutMs,
          maxBuffer: 1024 * 1024,
        }));
      } catch (error) {
        const executionError = error as ExecFileException & { stdout?: string; stderr?: string };
        throw new Error([
          `Electron preload runtime failed for ${path.basename(preloadPath)}.`,
          `exitCode=${String(executionError.code ?? 'unknown')} signal=${String(executionError.signal ?? 'none')}`,
          `stdout:\n${String(executionError.stdout ?? '').trim() || '<empty>'}`,
          `stderr:\n${String(executionError.stderr ?? '').trim() || '<empty>'}`,
        ].join('\n'), { cause: error });
      }

      return JSON.parse(extractElectronRuntimePayload(stdout)) as RuntimeBridgeSnapshot;
    }

    const utility = await runSnapshot(path.join(outDir, 'utility.js'));
    expect(utility.main.hasDesktopLauncherBridge).toBe(true);
    expect(utility.main.hasDesktopSettingsBridge).toBe(true);
    expect(utility.main.hasDesktopSessionContextBridge).toBe(false);
    expect(utility.main.hasDesktopEmbeddedDragBridge).toBe(false);
    expect(utility.main.hasDesktopShellBridge).toBe(true);
    expect(utility.main.hasDesktopDownloadsBridge).toBe(true);
    expect(utility.main.hasDesktopCodeWorkspaceBridge).toBe(false);
    expect(utility.main.hasStateStorageBridge).toBe(true);
    expect(utility.main.hasDesktopThemeBridge).toBe(true);
    expect(utility.main.hasDesktopLanguageBridge).toBe(true);
    expect(utility.main.hasDesktopWindowChromeBridge).toBe(true);
    expect(utility.child).toEqual(utility.main);

    const session = await runSnapshot(path.join(outDir, 'session.js'));
    expect(session.main.hasDesktopLauncherBridge).toBe(false);
    expect(session.main.hasDesktopSettingsBridge).toBe(false);
    expect(session.main.hasDesktopSessionContextBridge).toBe(true);
    expect(session.main.hasDesktopEmbeddedDragBridge).toBe(true);
    expect(session.main.hasDesktopShellBridge).toBe(true);
    expect(session.main.hasDesktopDownloadsBridge).toBe(true);
    expect(session.main.hasDesktopCodeWorkspaceBridge).toBe(true);
    expect(session.main.hasStateStorageBridge).toBe(true);
    expect(session.main.hasDesktopThemeBridge).toBe(true);
    expect(session.main.hasDesktopLanguageBridge).toBe(true);
    expect(session.main.hasDesktopWindowChromeBridge).toBe(true);
    expect(session.child).toEqual(session.main);
  }, electronRuntimeIntegrationTestTimeoutMs);
});
