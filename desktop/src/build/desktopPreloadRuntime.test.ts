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
const linuxElectronLaunchArgs = ['--no-sandbox', '--disable-setuid-sandbox'] as const;

function getElectronRuntimeLaunchArgs(
  platform: NodeJS.Platform,
  runtimeScript: string,
  preloadScript: string,
): string[] {
  const scriptArgs = [runtimeScript, preloadScript];
  if (platform !== 'linux') {
    return scriptArgs;
  }
  // Linux CI runners cannot use Electron's downloaded chrome-sandbox helper,
  // but the renderer windows under test still keep `sandbox: true` enabled.
  return [...linuxElectronLaunchArgs, ...scriptArgs];
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
    expect(getElectronRuntimeLaunchArgs('linux', 'runtime.js', 'browser.js')).toEqual([
      '--no-sandbox',
      '--disable-setuid-sandbox',
      'runtime.js',
      'browser.js',
    ]);
  });

  it('keeps the default runtime launch arguments on non-Linux platforms', () => {
    expect(getElectronRuntimeLaunchArgs('darwin', 'runtime.js', 'browser.js')).toEqual([
      'runtime.js',
      'browser.js',
    ]);
  });

  it('exposes desktop bridges in sandboxed main and detached child windows', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preload-runtime-'));
    tempDirs.push(tempDir);

    const outDir = path.join(tempDir, 'preload');
    await buildDesktopPreloads({
      desktopRoot: process.cwd(),
      outDir,
    });

    const runtimeScript = path.join(tempDir, 'runtime.js');
    await fs.writeFile(runtimeScript, `
const { app, BrowserWindow } = require('electron');

const preload = process.argv[2];

function snapshotBridgeState() {
  return JSON.stringify({
    hasAskFlowerBridge: typeof window.redevenDesktopAskFlowerHandoff === 'object'
      && typeof window.redevenDesktopAskFlowerHandoff?.requestMainWindowHandoff === 'function'
      && typeof window.redevenDesktopAskFlowerHandoff?.onMainWindowHandoff === 'function',
    hasStateStorageBridge: typeof window.redevenDesktopStateStorage === 'object',
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
      process.stdout.write(JSON.stringify({ main, child }));
      await app.quit();
    });
    return { action: 'deny' };
  });

  await mainWindow.loadURL('data:text/html,<html><body>main</body></html>');
  await mainWindow.webContents.executeJavaScript('window.open("data:text/html,<html><body>child</body></html>", "redeven_detached_file_preview", "noopener,noreferrer")');
});
`, 'utf8');

    const { stdout } = await execFileAsync(
      String(electronPath),
      getElectronRuntimeLaunchArgs(process.platform, runtimeScript, path.join(outDir, 'browser.js')),
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        },
        timeout: electronRuntimeIntegrationTimeoutMs,
        maxBuffer: 1024 * 1024,
      },
    );

    const payload = JSON.parse(stdout.trim()) as {
      main: { hasAskFlowerBridge: boolean; hasStateStorageBridge: boolean };
      child: { hasAskFlowerBridge: boolean; hasStateStorageBridge: boolean };
    };

    expect(payload.main.hasAskFlowerBridge).toBe(true);
    expect(payload.main.hasStateStorageBridge).toBe(true);
    expect(payload.child.hasAskFlowerBridge).toBe(true);
    expect(payload.child.hasStateStorageBridge).toBe(true);
  }, electronRuntimeIntegrationTimeoutMs);
});
