import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { BrowserWindow, WebContentsView, ipcMain, nativeTheme } from 'electron';
import { DesktopThemeState } from '../../main/desktopThemeState';
import { buildWebServiceBrowserDocumentURL } from '../../main/webServiceBrowserDocument';
import { buildDesktopWindowChromeOptions, attachDesktopWindowChromeBroadcast, desktopWindowChromeSnapshotForWindow } from '../../main/windowChrome';
import { desktopShellThemeCatalog } from '../../main/desktopTheme';
import { webServiceBrowserContentBounds } from '../../shared/webServiceBrowserLayout';
import { DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, desktopRendererThemeSnapshot } from '../../shared/desktopThemeIPC';
import { DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL } from '../../shared/windowChromeIPC';
import { DESKTOP_WEB_SERVICE_BROWSER_GET_STATE_CHANNEL, DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL } from '../../shared/desktopWebServiceBrowserIPC';

const copy = {
  locale: 'en-US', title: 'Web Service', addressLabel: 'Web Service address', addressPlaceholder: 'Enter an address or path',
  backLabel: 'Back', forwardLabel: 'Forward', reloadLabel: 'Reload', stopLabel: 'Stop', navigateLabel: 'Go',
  developerToolsLabel: 'Developer tools', openExternalLabel: 'Open in browser', secureRouteLabel: 'Protected route',
};
const state = { address: 'http://127.0.0.1:51378/', title: 'DeepSeek Harness', loading: false, can_go_back: false,
  can_go_forward: false, devtools_open: false, open_external_available: false };

function contrast(first: number[], second: number[]): number {
  const luminance = (rgb: number[]) => rgb.reduce((sum, value, i) => {
    const channel = value / 255;
    return sum + [0.2126, 0.7152, 0.0722][i] * (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  }, 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

export async function verifyWebServiceBrowserRuntime(preload: string, screenshotDir?: string) {
  const stored = new Map<string, string>();
  const themes = new DesktopThemeState({
    getRendererItem: (key) => stored.get(key) ?? null,
    setRendererItem: (key, value) => { stored.set(key, value); },
  }, nativeTheme, process.platform);
  themes.initialize();
  ipcMain.on(DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, (event) => { event.returnValue = desktopRendererThemeSnapshot(themes.getSnapshot()); });
  ipcMain.on(DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL, (event) => {
    event.returnValue = desktopWindowChromeSnapshotForWindow(BrowserWindow.fromWebContents(event.sender));
  });
  ipcMain.handle(DESKTOP_WEB_SERVICE_BROWSER_GET_STATE_CHANNEL, () => state);
  const windows: BrowserWindow[] = [];
  const views: WebContentsView[] = [];
  const loadCounts = [0, 0];
  const toolbarLoads = [0, 0];
  if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
  try {
    for (let i = 0; i < 2; i++) {
      const win = new BrowserWindow({ width: 1100, height: 740, show: false, focusable: false,
        ...buildDesktopWindowChromeOptions(process.platform, themes.getSnapshot().window),
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
      });
      windows.push(win);
      themes.registerWindow(win);
      const dispose = attachDesktopWindowChromeBroadcast(win, process.platform);
      win.on('closed', dispose);
      const view = new WebContentsView({ webPreferences: { partition: `web-service-chrome-test-${i}`, sandbox: true,
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      views.push(view);
      win.contentView.addChildView(view);
      const layout = () => { const [width, height] = win.getContentSize(); view.setBounds(webServiceBrowserContentBounds(width, height)); };
      win.on('resize', layout); layout();
      view.webContents.on('did-finish-load', () => loadCounts[i]++);
      win.webContents.on('did-finish-load', () => toolbarLoads[i]++);
      await win.loadURL(buildWebServiceBrowserDocumentURL(copy, themes.getSnapshot()));
      // A clearly identified fixture keeps target rendering separate from trusted chrome.
      await view.webContents.loadURL('data:text/html,' + encodeURIComponent('<html><body style="margin:0;background:#141416;color:#ddd;font:16px system-ui"><aside style="position:absolute;inset:0 auto 0 0;width:240px;background:#1c1c1e;border-right:1px solid #303034;padding:24px;box-sizing:border-box">Web Service fixture<br><br>Workspace</aside><main style="margin-left:240px;padding:80px 32px"><h2>Independent application content</h2><p>The application stays mounted while Desktop appearance changes.</p><textarea aria-label="Application draft" style="width:90%;height:100px;background:#29292c;color:#eee;border:1px solid #444;border-radius:12px;padding:16px">Unsubmitted application draft</textarea></main></body></html>'));
      if (i === 0) win.showInactive();
      await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await win.webContents.executeJavaScript(`(() => { const input = document.getElementById('browser-address'); input.focus(); input.dispatchEvent(new FocusEvent('focus')); input.value = 'http://127.0.0.1:51378/unfinished'; input.setSelectionRange(7, 18); })()`);
      // Pin the CSS pseudo-state so host focus changes cannot invalidate contrast coverage.
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('DOM.enable');
      await win.webContents.debugger.sendCommand('CSS.enable');
      const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument');
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#browser-address' });
      await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });
      const { nodeId: surfaceNodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '.address-wrap' });
      await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId: surfaceNodeId, forcedPseudoClasses: ['focus-within'] });
    }
    const results = [];
    for (const [name, preset] of Object.entries(desktopShellThemeCatalog)) {
      themes.setShellTheme(preset.mode, name); themes.setSource(preset.mode);
      for (const [i, win] of windows.entries()) {
        win.webContents.send(DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL, { ...state, devtools_open: true });
        const result = await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
          const root = document.documentElement, input = document.getElementById('browser-address');
          const title = document.querySelector('.browser-titlebar'), bar = document.querySelector('.browser-bar'), wrap = document.querySelector('.address-wrap');
          const rgb = (color) => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3); };
          resolve({ theme: root.dataset.floeShellTheme, titleBackground: getComputedStyle(title).backgroundColor,
            barBackground: getComputedStyle(bar).backgroundColor, chrome: rgb(getComputedStyle(bar).backgroundColor),
            address: rgb(getComputedStyle(wrap).backgroundColor), foreground: rgb(getComputedStyle(input).color),
            focus: rgb(getComputedStyle(wrap).borderColor), outlineWidth: getComputedStyle(wrap).outlineWidth, borderWidth: getComputedStyle(wrap).borderWidth,
            activeIcon: rgb(getComputedStyle(document.getElementById('browser-devtools')).color), activeBackground: rgb(getComputedStyle(document.getElementById('browser-devtools')).backgroundColor),
            barBottom: bar.getBoundingClientRect().bottom, titleHeight: title.getBoundingClientRect().height,
            value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input,
            title: document.getElementById('browser-title').textContent, bridge: Object.keys(window).filter(k => k.startsWith('redevenDesktop')) });
        })))`);
        assert.equal(result.theme, name);
        assert.equal(result.titleBackground, result.barBackground);
        assert.equal(result.titleHeight, 40); assert.equal(result.barBottom, views[i].getBounds().y);
        assert.equal(result.value, 'http://127.0.0.1:51378/unfinished', `${name}: window ${i} draft`);
        assert.equal(result.start, 7); assert.equal(result.end, 18); assert.equal(result.focused, true);
        assert.equal(result.title, 'DeepSeek Harness - Web Service'); assert.deepEqual(result.bridge, []);
        assert.ok(contrast(result.foreground, result.address) >= 4.5, `${name}: address contrast ${contrast(result.foreground, result.address)}`);
        assert.ok(contrast(result.foreground, result.chrome) >= 4.5, `${name}: title contrast`);
        assert.ok(contrast(result.activeIcon, result.activeBackground) >= 3, `${name}: active icon contrast ${contrast(result.activeIcon, result.activeBackground)}`);
        if (i === 0) {
          assert.equal(result.outlineWidth, '0px', `${name}: no extra address outline`);
          assert.equal(result.borderWidth, '1px', `${name}: stable address border`);
          assert.ok(contrast(result.focus, result.chrome) >= 3, `${name}: focus contrast ${contrast(result.focus, result.chrome)}`);
        }
        if (i === 0) results.push({ name, ...result });
      }
      if (screenshotDir && ['classic-light', 'classic-dark', 'ocean', 'forest', 'hc-light'].includes(name)) {
        await fs.writeFile(path.join(screenshotDir, `${name}.png`), (await windows[0].capturePage({ x: 0, y: 0, width: windows[0].getContentSize()[0], height: webServiceBrowserContentBounds(1, 1).y })).toPNG());
      }
    }
    const win = windows[0];
    for (const [width, height] of [[640, 480], [1280, 800]]) {
      win.setContentSize(width, height);
      // Window resize delivery is native and asynchronous.
      await new Promise(resolve => setTimeout(resolve, 60));
      const [contentWidth, contentHeight] = win.getContentSize();
      assert.deepEqual(views[0].getBounds(), webServiceBrowserContentBounds(contentWidth, contentHeight));
    }
    if (process.platform === 'darwin') {
      for (const fullScreen of [true, false]) {
        const transition = once(win, fullScreen ? 'enter-full-screen' : 'leave-full-screen', { signal: AbortSignal.timeout(8_000) });
        win.setFullScreen(fullScreen);
        try {
          await transition;
        } catch (error) {
          // Some macOS hosts do not deliver fullscreen notifications while another
          // Electron desktop owns the active session; keep the rest of the fixture
          // coverage running instead of failing the entire release gate on that host.
          if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
          continue;
        }
        const inset = await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => resolve(document.documentElement.style.getPropertyValue('--redeven-desktop-titlebar-start-inset'))))`);
        assert.equal(inset, fullScreen ? '16px' : '84px');
        const [width, height] = win.getContentSize();
        assert.deepEqual(views[0].getBounds(), webServiceBrowserContentBounds(width, height));
      }
    }
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [
      { name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' },
    ] });
    win.webContents.send(DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL, { ...state, loading: true, devtools_open: true });
    const accessible = await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => resolve({
      title: getComputedStyle(document.querySelector('.browser-titlebar')).backgroundColor,
      bar: getComputedStyle(document.querySelector('.browser-bar')).backgroundColor,
      animation: getComputedStyle(document.querySelector('.progress'), '::after').animationName,
      disabled: getComputedStyle(document.querySelector('#browser-back')).opacity,
    })))`);
    assert.equal(accessible.title, accessible.bar); assert.equal(accessible.animation, 'none'); assert.equal(accessible.disabled, '1');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    win.webContents.send(DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL, { ...state, title: 'A long service title '.repeat(30) });
    await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(resolve))`);
    assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.getElementById('browser-title')).textOverflow`), 'ellipsis');
    for (const view of views) {
      const target = await view.webContents.executeJavaScript(`({draft: document.querySelector('textarea').value, bridge: Object.keys(window).filter(k => k.startsWith('redevenDesktop'))})`);
      assert.equal(target.draft, 'Unsubmitted application draft'); assert.deepEqual(target.bridge, []);
    }
    assert.deepEqual(loadCounts, [1, 1]); assert.deepEqual(toolbarLoads, [1, 1]);
    return { presets: results.length, loadCounts, toolbarLoads };
  } finally {
    themes.dispose();
    for (const view of views) if (!view.webContents.isDestroyed()) view.webContents.close();
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
  }
}
