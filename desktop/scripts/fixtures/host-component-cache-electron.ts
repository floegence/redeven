import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HostApplicationComponents } from '../../src/main/hostApplicationComponents';
import { HOST_APPLICATION_COMPONENTS_CHANNEL, HOST_APPLICATION_COMPONENTS_PROGRESS, type HostApplicationComponentsRequest, type HostApplicationComponentsProgress } from '../../src/shared/hostApplicationComponents';

async function run() {
  await app.whenReady();
  assert.ok(app.requestSingleInstanceLock());
  const executable = process.env.REDEVEN_COMPONENT_RUNTIME!;
  const directory = process.env.REDEVEN_COMPONENT_EVIDENCE!;
  const phase = process.env.REDEVEN_COMPONENT_PHASE!;
  const endpoints: string[] = JSON.parse(process.env.REDEVEN_COMPONENT_ENDPOINTS!);
  const manager = new HostApplicationComponents(() => executable, () => path.join(app.getPath('userData'), 'native-application-components'));
  await manager.maintainCache();
  const window = new BrowserWindow({ show: false, webPreferences: { preload: process.env.REDEVEN_COMPONENT_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const progress: HostApplicationComponentsProgress[] = [];
  ipcMain.handle(HOST_APPLICATION_COMPONENTS_CHANNEL, async (event, request: HostApplicationComponentsRequest) => {
    assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, event.sender.mainFrame);
    const owner = event.sender.id;
    if (request.action === 'capabilities') return { ok: true, supports_transfer_plan: true, supports_cache_progress: true };
    if (request.action === 'cancel') { await manager.cancel(owner); return { ok: true }; }
    if (request.action === 'read') return manager.read(owner, request.offset);
    return manager.acquire(owner, request.architecture, value => { progress.push(value); event.sender.send(HOST_APPLICATION_COMPONENTS_PROGRESS, value); }, request.plan);
  });
  await window.loadURL('data:text/html,<title>Host component cache acceptance</title><main>Isolated component transfer acceptance</main>');
  const request = (value: HostApplicationComponentsRequest) => window.webContents.executeJavaScript(`window.redevenDesktopShell.applicationComponents(${JSON.stringify(value)})`);
  const evidence: unknown[] = [];
  for (let index = 0; index < endpoints.length; index++) {
    const endpoint = endpoints[index];
    const origin = await (await fetch(`${endpoint}/ready`)).text();
    const api = async (suffix: string, init: RequestInit = {}) => {
      const response = await fetch(`${endpoint}/_redeven_proxy/api/host-applications/setup${suffix}`, { ...init, headers: { Origin: origin, 'Content-Type': 'application/json', ...init.headers } });
      const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body)); assert.equal(body.ok, true, JSON.stringify(body)); return body.data;
    };
    const planPath = path.join(directory, `receiver-${index}.json`);
    const plan = phase === 'restart' ? JSON.parse(await fs.readFile(planPath, 'utf8')) : await api('/plan');
    if (phase !== 'restart') await fs.writeFile(planPath, JSON.stringify(plan));
    progress.length = 0;
    const bundle = await request({ action: 'acquire', architecture: plan.architecture, plan });
    assert.equal(bundle.ok, true); assert.ok(bundle.size > plan.missing_bytes);
    const last = progress.at(-1)!; assert.equal(last.phase, 'packing');
    if (phase === 'restart' || index > 0) { assert.equal(last.downloaded_bytes, 0); assert.equal(last.cached_bytes, plan.missing_bytes); }
    else { assert.equal(last.downloaded_bytes, plan.missing_bytes); assert.equal(last.cached_bytes, 0); }
    if (phase !== 'restart') {
      let state = await api('', { method: 'POST', body: JSON.stringify({ request_id: `acceptance-${index}`, source: 'upload', size_bytes: bundle.size, package_digest: plan.package_digest }) });
      let offset = state.received_bytes;
      while (offset < bundle.size) {
        const chunk = await request({ action: 'read', offset }); assert.equal(chunk.ok, true);
        const data = Uint8Array.from(chunk.data); assert.ok(data.length > 0 && data.length <= 256 * 1024);
        state = await api(`/${state.operation_id}/content?offset=${offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
        assert.equal(state.received_bytes, offset + data.length); offset = state.received_bytes;
      }
      state = await api(`/${state.operation_id}/complete`, { method: 'POST' });
      const deadline = Date.now() + 120_000;
      while (!['ready', 'failed'].includes(state.state) && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 250)); state = await api(''); }
      assert.equal(state.state, 'ready', JSON.stringify(state)); assert.equal(state.installed.ready, true);
      assert.equal((await api('/plan')).missing_bytes, 0);
    }
    await request({ action: 'cancel' });
    evidence.push({ endpoint, phase, index, plan, bundle_bytes: bundle.size, final_progress: last, stages: [...new Set(progress.map(value => value.phase))] });
    console.log(`PASS ${phase} receiver ${index}: download=${last.downloaded_bytes}, cache=${last.cached_bytes}, ZIP=${bundle.size}`);
  }
  await fs.writeFile(path.join(directory, `${phase}.json`), JSON.stringify(evidence, null, 2));
  window.destroy(); app.quit();
}
run().catch(error => { console.error(error); app.exit(1); });
