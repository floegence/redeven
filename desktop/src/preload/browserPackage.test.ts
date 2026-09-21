import { expect, it, vi } from 'vitest';
const { expose, invoke, on, remove } = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), remove: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: expose }, ipcRenderer: { invoke, on, removeListener: remove } }));
import { bootstrapBrowserPackageBridge } from './browserPackage';
it('exposes only admitted package requests and detachable validated progress', async () => {
  bootstrapBrowserPackageBridge(); const [name, bridge] = expose.mock.calls[0]; expect(name).toBe('redevenBrowserPackage');
  await bridge.request({ action: 'acquire', operation_id: 'op', url: 'https://example.test' }); expect(invoke).not.toHaveBeenCalled();
  await bridge.request({ action: 'cancel', operation_id: 'op' }); expect(invoke).toHaveBeenCalledWith('redeven-desktop:browser-package', { action: 'cancel', operation_id: 'op' });
  const listener = vi.fn(); const stop = bridge.subscribe(listener); const handler = on.mock.calls[0][1];
  handler({}, { operation_id: 'op', phase: 'downloading', received_bytes: 2, total_bytes: 8 }); expect(listener).toHaveBeenCalledTimes(1);
  handler({}, { phase: 'unexpected' }); expect(listener).toHaveBeenCalledTimes(1); stop(); expect(remove).toHaveBeenCalled();
});
