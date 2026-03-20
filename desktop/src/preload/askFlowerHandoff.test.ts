import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const ipcRendererOn = vi.fn();
const ipcRendererSend = vi.fn();
let deliverListener: ((event: unknown, payload: unknown) => void) | null = null;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    on: ipcRendererOn.mockImplementation((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
      deliverListener = listener;
    }),
    send: ipcRendererSend,
  },
}));

describe('bootstrapDesktopAskFlowerHandoffBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    ipcRendererOn.mockReset();
    ipcRendererOn.mockImplementation((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
      deliverListener = listener;
    });
    ipcRendererSend.mockReset();
    deliverListener = null;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it('sends normalized renderer requests to electron main', async () => {
    const { bootstrapDesktopAskFlowerHandoffBridge } = await import('./askFlowerHandoff');

    bootstrapDesktopAskFlowerHandoffBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.requestMainWindowHandoff).toBe('function');

    bridge.requestMainWindowHandoff({
      source: 'file_preview',
      path: '/workspace/demo.txt/',
      selectionText: '  selected line  ',
    });

    expect(ipcRendererSend).toHaveBeenCalledWith(
      'redeven-desktop:ask-flower-handoff-request',
      {
        source: 'file_preview',
        path: '/workspace/demo.txt',
        selectionText: 'selected line',
      },
    );
  });

  it('buffers main-window deliveries until the renderer subscribes', async () => {
    const { bootstrapDesktopAskFlowerHandoffBridge } = await import('./askFlowerHandoff');

    bootstrapDesktopAskFlowerHandoffBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(typeof bridge.onMainWindowHandoff).toBe('function');
    expect(deliverListener).toBeTypeOf('function');

    deliverListener?.({}, {
      source: 'file_preview',
      path: '/workspace/demo.txt',
      selectionText: 'selected line',
    });

    const listener = vi.fn();
    const unsubscribe = bridge.onMainWindowHandoff(listener);

    expect(listener).toHaveBeenCalledWith({
      source: 'file_preview',
      path: '/workspace/demo.txt',
      selectionText: 'selected line',
    });

    listener.mockReset();
    unsubscribe();

    deliverListener?.({}, {
      source: 'file_preview',
      path: '/workspace/next.txt',
      selectionText: '',
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
