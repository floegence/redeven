import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const url = process.env.REDEVEN_PROGRESS_PREVIEW_URL!;
  const output = process.env.REDEVEN_PROGRESS_ELECTRON_OUTPUT!;
  await mkdir(output, { recursive: true });
  const window = new BrowserWindow({ width: 1100, height: 800, show: true, webPreferences: { contextIsolation: true, sandbox: true } });
  const cases: unknown[] = [];
  try {
    await window.loadURL(url);
    assert.equal(window.webContents.getURL(), url);
    await window.webContents.executeJavaScript(`new Promise(resolve => {
      const check = () => window.progressFixture ? resolve(true) : requestAnimationFrame(check); check();
    })`);
    for (const [name, mode] of [['classic-light', 'light'], ['classic-dark', 'dark'], ['nord', 'dark'], ['hc-light', 'light']]) {
      await window.webContents.executeJavaScript(`window.progressFixture.theme.selectShellTheme(${JSON.stringify(mode)}, ${JSON.stringify(name)})`);
      await new Promise(resolve => setTimeout(resolve, 800));
      const state = await window.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('.redeven-split-action-primary button');
        const text = document.querySelector('.flower-model-status-text');
        return { buttonAnimation: getComputedStyle(button, '::before').animationName,
          textAnimation: getComputedStyle(text).animationName, clip: getComputedStyle(text).backgroundClip,
          background: getComputedStyle(text).backgroundColor, enabled: !button.disabled };
      })()`);
      assert.equal(state.buttonAnimation, 'floe-progress-shimmer');
      assert.equal(state.textAnimation, 'floe-progress-shimmer');
      assert.equal(state.clip, 'text'); assert.equal(state.background, 'rgba(0, 0, 0, 0)'); assert.equal(state.enabled, true);
      cases.push({ name, mode, state });
      await writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    }
    const expanded = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.redeven-split-action-primary button').click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      return document.querySelector('.redeven-split-action-primary button').getAttribute('aria-expanded');
    })()`);
    assert.equal(expanded, 'true');
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', url, electron: process.versions.electron, cases }, null, 2));
    window.destroy(); app.exit(0);
  } catch (error) {
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', cases, error: String(error) }, null, 2));
    console.error(error); window.destroy(); app.exit(1);
  }
}).catch(error => { console.error(error); app.exit(1); });
