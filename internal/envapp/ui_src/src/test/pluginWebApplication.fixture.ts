import { PluginBridgeClient } from '@floegence/redevplugin-ui/plugin';

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
window.parent.postMessage({
  type: 'redeven.web-qualification',
  origin: location.origin, count, workerValue, parentDenied, managementStatus,
  pixel: [...drawing.getImageData(0, 0, 1, 1).data],
}, '*');
