import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DesktopThemeState } from '../../src/main/desktopThemeState';
import { DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, DESKTOP_THEME_SET_SOURCE_CHANNEL, DESKTOP_THEME_SET_SHELL_THEME_CHANNEL, desktopRendererThemeSnapshot } from '../../src/shared/desktopThemeIPC';
import { resolveDesktopWindowChromeSnapshot } from '../../src/shared/windowChromePlatform';
import { DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL } from '../../src/shared/windowChromeIPC';

app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const output = process.env.REDEVEN_APPEARANCE_OUTPUT!;
  const url = process.env.REDEVEN_APPEARANCE_URL!;
  await mkdir(output, { recursive: true });
  const storage = new Map<string, string>();
  const state = new DesktopThemeState({ getRendererItem: key => storage.get(key) ?? null, setRendererItem: (key, value) => { storage.set(key, value); } }, nativeTheme);
  let requests = 0;
  let rejectNext = false;
  const delay = () => new Promise(resolve => setTimeout(resolve, 300));
  ipcMain.on(DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, event => { event.returnValue = desktopRendererThemeSnapshot(state.getSnapshot()); });
  ipcMain.on(DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL, event => { event.returnValue = resolveDesktopWindowChromeSnapshot(process.platform); });
  ipcMain.handle(DESKTOP_THEME_SET_SOURCE_CHANNEL, async (_event, source) => { requests++; await delay(); return desktopRendererThemeSnapshot(state.setSource(source)); });
  ipcMain.handle(DESKTOP_THEME_SET_SHELL_THEME_CHANNEL, async (_event, mode, preset) => {
    requests++; await delay();
    if (rejectNext) { rejectNext = false; throw new Error('Simulated theme persistence failure'); }
    return desktopRendererThemeSnapshot(state.setShellTheme(mode, preset));
  });
  const windows: BrowserWindow[] = [];
  const metrics: unknown[] = [];
  const read = (win: BrowserWindow, script: string) => win.webContents.executeJavaScript(script);
  const waitFor = (win: BrowserWindow, expression: string) => read(win, `new Promise((resolve, reject) => {
    const deadline = performance.now() + 5000;
    const check = () => { if (${expression}) return resolve(true); if (performance.now() > deadline) return reject(new Error('Appearance condition timed out')); requestAnimationFrame(check); }; check();
  })`);
  try {
    assert.deepEqual(state.getSnapshot().shellThemes, { version: 1, light: 'porcelain-light', dark: 'porcelain-dark' });
    state.setSource('dark');
    for (let i = 0; i < 2; i++) {
      const win = new BrowserWindow({ width: 1240, height: 900, show: true, webPreferences: { contextIsolation: true, sandbox: true, preload: process.env.REDEVEN_APPEARANCE_PRELOAD } });
      windows.push(win); state.registerWindow(win); await win.loadURL(url);
      assert.equal(win.webContents.getURL(), url);
      await waitFor(win, `document.querySelector('[data-appearance-draft]') && document.documentElement.dataset.floeShellTheme === 'porcelain-dark'`);
      await read(win, `window.appearanceDraft = document.querySelector('[data-appearance-draft]'); window.appearanceDraft.value = 'Keep this unsaved draft'; window.appearanceDraft.setSelectionRange(2, 6);`);
    }
    const [first, second] = windows;
    first.focus();
    await writeFile(path.join(output, 'porcelain-dark.png'), (await first.webContents.capturePage()).toPNG());
    const openPicker = async () => {
      await read(first, `document.querySelector('[aria-haspopup="dialog"]').click()`);
      await waitFor(first, `document.querySelector('.redeven-theme-picker__theme') && document.activeElement?.getAttribute('role') === 'radio'`);
    };
    await openPicker();
    assert.equal(await read(first, `document.querySelector('[data-desktop-theme-preset]').dataset.desktopThemePreset`), 'porcelain-dark');
    const beforeRequests = requests;
    const feedback = await read(first, `(async () => {
      const target = document.querySelector('[data-desktop-theme-preset="nord"]');
      const start = performance.now(); target.click(); target.click();
      const immediate = target.getAttribute('aria-busy');
      await new Promise(requestAnimationFrame);
      return { immediate, elapsed: performance.now() - start, pending: target.getAttribute('aria-busy'), checked: target.getAttribute('aria-checked'), loading: document.querySelector('[role="status"]').textContent, spinnerVisibility: getComputedStyle(target.querySelector('.redeven-theme-picker__spinner')).visibility };
    })()`);
    assert.equal(feedback.immediate, 'true'); assert.equal(feedback.pending, 'true'); assert.equal(feedback.checked, 'false');
    assert.ok(feedback.elapsed < 150, `Feedback took ${feedback.elapsed}ms`);
    assert.ok(feedback.loading.includes('正在切换外观'));
    assert.equal(feedback.spinnerVisibility, 'visible', 'The pending option must paint its loading indicator');
    metrics.push({ feedback });
    await writeFile(path.join(output, 'switching.png'), (await first.webContents.capturePage()).toPNG());
    await read(first, `document.querySelector('.redeven-theme-picker__close').click()`);
    assert.equal(await read(first, `Boolean(document.querySelector('[role="dialog"]'))`), false);
    await waitFor(first, `document.documentElement.dataset.floeShellTheme === 'nord'`);
    await waitFor(second, `document.documentElement.dataset.floeShellTheme === 'nord'`);
    assert.equal(requests - beforeRequests, 1, 'Rapid repeated clicks make one write');
    await openPicker(); rejectNext = true;
    await read(first, `document.querySelector('[data-desktop-theme-preset="graphite"]').click()`);
    await waitFor(first, `document.querySelector('[role="alert"]')`);
    assert.equal(state.getSnapshot().activeShellTheme, 'nord');
    assert.equal(await read(first, `document.querySelector('[data-desktop-theme-preset="nord"]').getAttribute('aria-checked')`), 'true');
    await read(first, `document.querySelector('[data-desktop-theme-preset="graphite"]').click()`);
    await waitFor(first, `document.documentElement.dataset.floeShellTheme === 'graphite' && !document.querySelector('[aria-haspopup="dialog"][aria-busy="true"]')`);
    await read(first, `document.querySelector('[data-desktop-theme-preset="porcelain-dark"]').click()`);
    await waitFor(first, `document.documentElement.dataset.floeShellTheme === 'porcelain-dark' && !document.querySelector('[aria-haspopup="dialog"][aria-busy="true"]')`);
    await writeFile(path.join(output, 'porcelain-dark-picker.png'), (await first.webContents.capturePage()).toPNG());
    await read(first, `document.querySelector('[id$="-mode-light"]').click()`);
    await waitFor(first, `document.documentElement.dataset.floeShellTheme === 'porcelain-light' && !document.querySelector('[aria-haspopup="dialog"][aria-busy="true"]')`);
    await waitFor(second, `document.documentElement.dataset.floeShellTheme === 'porcelain-light'`);
    assert.equal(await read(first, `document.querySelector('[data-desktop-theme-preset]').dataset.desktopThemePreset`), 'porcelain-light');
    await read(first, `document.querySelector('.redeven-theme-picker__close').click()`);
    await writeFile(path.join(output, 'porcelain-light.png'), (await first.webContents.capturePage()).toPNG());
    for (const win of windows) {
      assert.deepEqual(await read(win, `({ same: window.appearanceDraft === document.querySelector('[data-appearance-draft]'), text: window.appearanceDraft.value, start: window.appearanceDraft.selectionStart, end: window.appearanceDraft.selectionEnd })`), { same: true, text: 'Keep this unsaved draft', start: 2, end: 6 });
    }
    await delay();
    assert.equal(state.getSnapshot().activeShellTheme, 'porcelain-light', 'Delayed renderer persistence must not revert the latest selection');
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', electron: process.versions.electron, requests, metrics, checks: ['defaults', 'immediate feedback', 'duplicate clicks', 'close while pending', 'failure and retry', 'two-window synchronization', 'draft preservation', 'delayed persistence'] }, null, 2));
    state.dispose(); for (const win of windows) win.destroy(); app.exit(0);
  } catch (error) {
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', metrics, error: String(error) }, null, 2));
    console.error(error); state.dispose(); for (const win of windows) win.destroy(); app.exit(1);
  }
}).catch(error => { console.error(error); app.exit(1); });
