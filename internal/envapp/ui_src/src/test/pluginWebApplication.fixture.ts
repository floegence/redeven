import { PluginBridgeClient, PluginResourceError, describePluginResources, pluginDatabase, pluginFiles, pluginKV, pluginSettings } from '@floegence/redevplugin-ui/plugin';

const bridge = new PluginBridgeClient();
bridge.onBeforeClose(() => false);
await bridge.ready();
const { increment } = await import('./pluginWebCounter.fixture');
const button = document.querySelector<HTMLButtonElement>('button')!;
let count = 0;
button.addEventListener('click', () => { button.textContent = String(count = increment(count)); });
button.click();
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const workerValue = await new Promise<number>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Worker did not answer')), 5000);
  worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
  worker.onerror = reject;
  worker.postMessage(count);
});
worker.terminate();
const canvas = document.querySelector('canvas')!;
const drawing = canvas.getContext('2d')!;
drawing.fillStyle = '#ff0000';
drawing.fillRect(0, 0, 1, 1);
let parentDenied = false;
try { void window.parent.document.body; } catch { parentDenied = true; }
const managementStatus = (await fetch('/api/local/runtime')).status;

// Deterministic resource assertions run through the same published SDK and
// dedicated-origin transport as an ordinary backend-free application.
const resources = await describePluginResources();
const notes = pluginKV<{ revision: number }>('notes');
const before = await notes.read('visits');
const revision = (before?.value.revision ?? 0) + 1;
const saved = await notes.put('visits', { revision }, { expectedETag: before?.etag ?? '' });
let kvConflict = false;
try { await notes.put('visits', { revision: 999 }, { expectedETag: before?.etag ?? '' }); }
catch (error) { kvConflict = error instanceof PluginResourceError && error.code === 'CONFLICT' && error.mutationOutcome === 'not_committed'; }
const current = await notes.read('visits');
const watch = notes.watch('visits');
const snapshot = await watch.next();
await watch.return?.();
const settings = pluginSettings<{ compact: boolean }>();
const originalSettings = await settings.get();
const changedSettings = await settings.patch(originalSettings.values_revision, { compact: !originalSettings.values.compact });
let settingsConflict = false;
try { await settings.patch(originalSettings.values_revision, { compact: originalSettings.values.compact }); }
catch (error) { settingsConflict = error instanceof PluginResourceError && error.code === 'CONFLICT' && error.mutationOutcome === 'not_committed'; }
const database = pluginDatabase('database');
await database.transaction([
  { sql: 'CREATE TABLE IF NOT EXISTS qualification (id INTEGER PRIMARY KEY, value TEXT)' },
  { sql: 'INSERT OR REPLACE INTO qualification (id, value) VALUES (?, ?)', args: [1, 'native resources'] },
]);
const rows = await database.query('SELECT value FROM qualification WHERE id = ?', [1]);
const payload = new Uint8Array(262177);
for (let index = 0; index < payload.length; index++) payload[index] = index % 251;
const files = pluginFiles('files');
const written = await files.writeFrom('roundtrip.bin', new Blob([payload]));
const reader = (await files.readable('roundtrip.bin')).getReader();
let received = 0;
let fileEqual = true;
try {
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    for (let index = 0; index < chunk.value.length; index++) {
      if (chunk.value[index] !== payload[received + index]) fileEqual = false;
    }
    received += chunk.value.length;
  }
} finally { reader.releaseLock(); }
window.parent.postMessage({
  type: 'redeven.web-qualification',
  origin: location.origin, count, workerValue, parentDenied, managementStatus,
  pixel: [...drawing.getImageData(0, 0, 1, 1).data],
  resources: { revision, kvConflict, settingsConflict,
    kv: current?.value.revision === revision && current.etag === saved.etag,
    snapshot: !snapshot.done && snapshot.value.value?.revision === revision,
    settings: changedSettings.values.compact !== originalSettings.values.compact && changedSettings.values_revision > originalSettings.values_revision,
    database: rows.rows.length === 1 && rows.rows[0][0] === 'native resources',
    files: fileEqual && written === payload.length && received === payload.length,
    limits: resources.limits.value_bytes === 65536 && resources.storage.length === 3,
  },
}, '*');
