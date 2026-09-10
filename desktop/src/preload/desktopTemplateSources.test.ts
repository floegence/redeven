import { describe, expect, it, vi } from 'vitest';
const electron = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: { invoke: electron.invoke },
}));
import { bootstrapDesktopTemplateSources } from './desktopTemplateSources';
import { TEMPLATE_SOURCE_ACQUIRE_CHANNEL, type DesktopTemplateSourceBridge } from '../shared/desktopTemplateSources';

describe('template source preload', () => {
  it('exposes only bounded acquisition and cancellation requests', async () => {
    bootstrapDesktopTemplateSources();
    expect(electron.expose).toHaveBeenCalledWith('redevenDesktopTemplateSources', expect.any(Object));
    const bridge = electron.expose.mock.calls[0][1] as DesktopTemplateSourceBridge;
    electron.invoke.mockResolvedValueOnce({ ok: true, catalog: { templates: [] } });
    await bridge.acquire({
      operation_id: 'source-1',
      action: 'discover',
      source: { repository: 'owner/repo' },
      token: 'private',
    });
    expect(electron.invoke).toHaveBeenCalledWith(TEMPLATE_SOURCE_ACQUIRE_CHANNEL, {
      operation_id: 'source-1',
      action: 'discover',
      source: { repository: 'owner/repo', ref: undefined, path: undefined },
      token: 'private',
    });
    electron.invoke.mockClear();
    await bridge.cancel('../invalid');
    expect(electron.invoke).not.toHaveBeenCalled();
  });
});
