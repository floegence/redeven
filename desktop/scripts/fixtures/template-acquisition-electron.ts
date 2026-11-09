import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DesktopTemplateSources } from '../../src/main/templateSources';
import { TEMPLATE_SOURCE_ACQUIRE_CHANNEL, TEMPLATE_SOURCE_CANCEL_CHANNEL } from '../../src/shared/desktopTemplateSources';

async function run() {
  const directory = process.env.REDEVEN_OFFICIAL_TEMPLATE_EVIDENCE!;
  const catalog = JSON.parse(await readFile(path.join(directory, 'desktop-catalog.json'), 'utf8'));
  const items = catalog.data.filter((item: { classification: string }) => item.classification === 'official');
  assert.equal(items.length, 4);
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { preload: process.env.REDEVEN_TEMPLATE_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const sources = new DesktopTemplateSources();
  ipcMain.handle(TEMPLATE_SOURCE_ACQUIRE_CHANNEL, (event, request) => {
    assert.equal(event.sender.id, window.webContents.id);
    assert.equal(event.senderFrame, event.sender.mainFrame);
    return sources.acquire(event.sender.id, request);
  });
  ipcMain.handle(TEMPLATE_SOURCE_CANCEL_CHANNEL, (event, operationID) => sources.cancel(event.sender.id, operationID));
  const owner = window.webContents.id;
  window.webContents.once('destroyed', () => sources.cancelOwner(owner));
  await window.loadURL('about:blank');
  const request = async (input: unknown) => window.webContents.executeJavaScript(`window.redevenDesktopTemplateSources.acquire(${JSON.stringify(input)})`);
  const nativeFetch = globalThis.fetch;
  const calls: { host: string; status: number }[] = [];
  globalThis.fetch = async (input, options) => {
    const host = new URL(String(input)).hostname;
    assert.equal(new Headers(options?.headers).has('Authorization'), false, 'default acquisition cannot use a token');
    assert.equal(host, 'codeload.github.com', 'pinned public acquisition cannot consume REST quota');
    const response = await nativeFetch(input, options);
    calls.push({ host, status: response.status });
    return response;
  };
  const templates = [];
  for (const item of items) {
    const expected = { repository_id: item.source.repository_id, commit_sha: item.source.commit_sha, sha256: item.sha256 };
    const start = calls.length;
    const response = await request({ operation_id: item.document_template_id, action: 'capture', source: item.source, expected });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.snapshot.sha256, item.sha256);
    await writeFile(path.join(directory, item.document_template_id + '.snapshot.json'), JSON.stringify(response.snapshot), { mode: 0o600 });
    templates.push({ id: item.document_template_id, revision: item.revision, sha256: item.sha256, files: response.snapshot.files.length, requests: calls.slice(start) });
    console.log(JSON.stringify(templates.at(-1)));
  }
  assert.deepEqual(await request({ operation_id: '../invalid' }), { ok: false, error_code: 'REQUEST_INVALID' });
  globalThis.fetch = nativeFetch;
  await writeFile(path.join(directory, 'desktop-acquisition.json'), JSON.stringify({ bridge: 'sandboxed Electron preload -> IPC -> DesktopTemplateSources -> published SDK', token: false, templates }, null, 2));
  console.log('Assertions complete: anonymous Desktop source acquisition');
  window.destroy();
  app.quit();
}
run().catch(error => { console.error(error); app.exit(1); });
