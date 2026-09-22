import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildCodespaceLoadingDocumentURL } from '../../src/main/codespaceLoadingDocument';
import { buildWebServiceUnavailableDocumentURL, isWebServiceUnavailableRetryIntent, showWebServiceRetryFeedback } from '../../src/main/webServiceUnavailableDocument';
import { desktopSemanticPaletteForShellTheme, desktopWindowThemeSnapshotForShellTheme } from '../../src/main/desktopTheme';
import { createDesktopI18n, type RedevenLocale } from '../../src/shared/i18n';
import type { DesktopThemeSnapshot } from '../../src/shared/desktopTheme';

app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const output = process.env.REDEVEN_WINDOW_STATUS_OUTPUT!;
  await mkdir(output, { recursive: true });
  const window = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  let serviceRequests = 0;
  const server = createServer((_request, response) => {
    serviceRequests += 1;
    response.end('<!doctype html><title>Recovered service</title><main class="floe-window-status"><span class="idle-status">Service ready</span></main>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serviceURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  await writeFile(path.join(output, 'service-runtime.json'), JSON.stringify({ pid: process.pid, port: (server.address() as AddressInfo).port, state: app.getPath('userData') }, null, 2));
  const cases: unknown[] = [];
  let stage = 'starting';
  try {
    for (const [name, mode] of [['classic-light', 'light'], ['classic-dark', 'dark'], ['nord', 'dark'], ['hc-light', 'light'], ['github-light', 'light']] as const) {
      const theme: DesktopThemeSnapshot = { source: mode, resolvedTheme: mode, shellThemes: { version: 1, light: 'classic-light', dark: 'classic-dark' }, activeShellTheme: name, window: desktopWindowThemeSnapshotForShellTheme(name), semantic: desktopSemanticPaletteForShellTheme(name) };
      for (const locale of ['en-US', 'zh-CN', 'de-DE'] as RedevenLocale[]) {
        const i18n = createDesktopI18n(locale);
        const copy = {
          locale, documentTitle: i18n.t('webServiceBrowser.unavailableDocumentTitle'),
          eyebrow: i18n.t('webServiceBrowser.unavailableEyebrow'), title: i18n.t('webServiceBrowser.unavailableTitle'), summary: i18n.t('webServiceBrowser.unavailableSummary'),
          targetLabel: i18n.t('webServiceBrowser.unavailableTargetLabel'), checksTitle: i18n.t('webServiceBrowser.unavailableChecksTitle'), serviceCheck: i18n.t('webServiceBrowser.unavailableServiceCheck'), portCheck: i18n.t('webServiceBrowser.unavailablePortCheck'), retryLabel: i18n.t('webServiceBrowser.retry'), retryingLabel: i18n.t('webServiceBrowser.retrying'),
        };
        const documents = {
          editor: buildCodespaceLoadingDocumentURL('acceptance-project', theme, { locale, title: 'Codespace', detail: i18n.t('windowStatus.preparingEditor') }),
          'editor-failed': buildCodespaceLoadingDocumentURL('acceptance-project', theme, { locale, state: 'error', title: 'Codespace', detail: i18n.t('codespaceNative.unavailable') }),
          browser: buildWebServiceUnavailableDocumentURL(copy, 'http://localhost:3000', theme),
          application: buildWebServiceUnavailableDocumentURL({ ...copy, documentTitle: 'Outline', title: i18n.t('hostApplications.unavailableTitle'), summary: i18n.t('hostApplications.unavailableSummary'), retryLabel: i18n.t('hostApplications.retry') }, 'http://localhost:3000', theme, 'application'),
        };
        for (const width of [1280, 390]) {
          window.setSize(width, 800);
          for (const [kind, url] of Object.entries(documents)) {
            stage = `${name}/${locale}/${width}/${kind}: initial document`;
            await window.loadURL(url);
            assert.equal(window.webContents.getURL(), url);
            const state = await window.webContents.executeJavaScript(`(() => {
              const root = document.querySelector('main');
              const text = document.querySelector('[data-floe-progress-shimmer]');
              return { overflow: root.scrollWidth > root.clientWidth, top: document.querySelector('h1').getBoundingClientRect().top,
                blur: getComputedStyle(root).backdropFilter, progressBars: document.querySelectorAll('[role="progressbar"]').length,
                title: document.querySelector('h1').textContent, shimmer: text && getComputedStyle(text).animationName,
                scripts: document.scripts.length, locale: document.documentElement.lang };
            })()`);
            assert.equal(state.overflow, false); assert.ok(state.top >= 0); assert.equal(state.blur, 'none');
            assert.equal(state.progressBars, 0); assert.equal(state.scripts, 0); assert.equal(state.locale, locale);
            if (kind === 'editor') assert.equal(state.shimmer, 'floe-progress-shimmer');
            const evidence = locale === 'zh-CN' && name.startsWith('classic-') && width === 1280;
            if (evidence) {
              await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
              await writeFile(path.join(output, `${kind}-${mode}.png`), (await window.webContents.capturePage()).toPNG());
              await writeFile(path.join(output, `${kind}-${mode}.html`), decodeURIComponent(url.slice(url.indexOf(',') + 1)));
            }
            if (kind === 'browser' || kind === 'application') {
              let receivedIntent = false;
              let retryFlow: Promise<void> | undefined;
              let feedbackError: unknown;
              const navigation = new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Native retry intent was not received')), 5000);
                window.webContents.once('will-navigate', (event, nextURL) => {
                  event.preventDefault();
                  if (!isWebServiceUnavailableRetryIntent(nextURL, window.webContents.getURL(), url)) {
                    clearTimeout(timer); reject(new Error('Untrusted retry navigation')); return;
                  }
                  receivedIntent = true;
                  clearTimeout(timer);
                  resolve();
                  stage = `${name}/${locale}/${width}/${kind}: retry feedback`;
                  retryFlow = showWebServiceRetryFeedback(window.webContents, url, () => !window.isDestroyed())
                    .then(async (current) => {
                      assert.equal(current, true);
                      stage = `${name}/${locale}/${width}/${kind}: recovered service`;
                      await window.loadURL(serviceURL);
                    }).catch((error) => { feedbackError = error; clearTimeout(timer); reject(error); });
                });
              });
              // Handle the promise immediately, including events arriving during the input dispatch.
              void navigation.catch(() => {});
              const point = await window.webContents.executeJavaScript('(() => { const r = document.querySelector("#retry").getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()');
              window.webContents.debugger.attach('1.3');
              await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
              await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
              window.webContents.debugger.detach();
              await navigation;
              assert.equal(receivedIntent, true);
              assert.equal(window.webContents.getURL(), url);
              await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
                const deadline = performance.now() + 400;
                const check = () => {
                  if (getComputedStyle(document.querySelector('.retrying-label')).display !== 'none') resolve();
                  else if (performance.now() > deadline) reject(new Error('Working feedback was not rendered'));
                  else requestAnimationFrame(check);
                };
                check();
              })`);
              const retry = await window.webContents.executeJavaScript(`(() => {
                const text = document.querySelector('[data-floe-progress-shimmer]');
                return { text: text.textContent, animation: getComputedStyle(text).animationName,
                  statusVisible: getComputedStyle(document.querySelector('.retrying-label')).display !== 'none',
                  iconAnimation: getComputedStyle(document.querySelector('#retry svg')).animationName,
                  iconPaths: document.querySelectorAll('#retry svg path').length };
              })()`);
              assert.equal(retry.text, i18n.t('windowStatus.checkingService'));
              assert.equal(retry.statusVisible, true); assert.equal(retry.animation, 'floe-progress-shimmer');
              assert.equal(retry.iconAnimation, 'none'); assert.equal(retry.iconPaths, 4);
              await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
              if (evidence) await writeFile(path.join(output, `${kind}-working-${mode}.png`), (await window.webContents.capturePage()).toPNG());
              await retryFlow;
              if (feedbackError) throw feedbackError;
              assert.equal(window.webContents.getURL(), serviceURL);
              assert.equal(await window.webContents.executeJavaScript('document.querySelector("main").textContent'), 'Service ready');
              assert.notEqual(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector(".idle-status")).display'), 'none');
            }
            cases.push({ name, locale, width, kind, state });
          }
        }
      }
    }
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', electron: process.versions.electron, serviceURL, serviceRequests, cases }, null, 2));
    console.log(`Window status Electron: ${cases.length} document/theme/locale/viewport cases passed`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    window.destroy(); app.exit(0);
  } catch (error) {
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', stage, cases, error: String(error).split('data:text/html')[0] }, null, 2));
    console.error(stage, String(error).split('data:text/html')[0], error instanceof Error ? error.stack?.split('\n').slice(1).join('\n').slice(0, 1000) : ''); server.close(); window.destroy(); app.exit(1);
  }
}).catch(error => { console.error(error); app.exit(1); });
