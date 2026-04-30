// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkbenchTerminalVisualCoordinator } from './workbenchTerminalVisualCoordinator';

type FakeSuspendHandle = {
  id: number;
  reason: string;
  dispose: ReturnType<typeof vi.fn>;
};

function createFakeCore() {
  const handles: FakeSuspendHandle[] = [];
  return {
    handles,
    core: {
      beginVisualSuspend: vi.fn((options?: { reason?: string }) => {
        const handle = {
          id: handles.length + 1,
          reason: options?.reason ?? 'external',
          dispose: vi.fn(),
        };
        handles.push(handle);
        return handle;
      }),
    },
  };
}

function createSurface(rect: { left: number; top: number; width: number; height: number }): HTMLDivElement {
  const surface = document.createElement('div');
  Object.defineProperty(surface, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => undefined,
    }),
  });
  document.body.appendChild(surface);
  return surface;
}

describe('workbench terminal visual coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(Date.now()), 0)
    ));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('suspends registered terminals during an interaction and resumes visible terminals immediately', async () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    const terminal = createFakeCore();
    const surface = createSurface({ left: 10, top: 10, width: 320, height: 160 });

    coordinator.registerCore('widget-1', 'session-1', terminal.core as any);
    coordinator.registerSurface('widget-1', 'session-1', surface);

    const token = coordinator.beginInteraction('viewport_pan');

    expect(terminal.core.beginVisualSuspend).toHaveBeenCalledWith({ reason: 'workbench_pan' });
    expect(terminal.handles[0]?.dispose).not.toHaveBeenCalled();

    token.end();

    expect(terminal.handles[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('waits for the last nested interaction before resuming', () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    const terminal = createFakeCore();
    const surface = createSurface({ left: 10, top: 10, width: 320, height: 160 });

    coordinator.registerCore('widget-1', 'session-1', terminal.core as any);
    coordinator.registerSurface('widget-1', 'session-1', surface);

    const first = coordinator.beginInteraction('viewport_pan');
    const second = coordinator.beginInteraction('viewport_zoom');

    expect(terminal.core.beginVisualSuspend).toHaveBeenCalledTimes(1);

    first.end();
    expect(terminal.handles[0]?.dispose).not.toHaveBeenCalled();

    second.end();
    expect(terminal.handles[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('resumes background terminals through the deferred queue', async () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    const terminal = createFakeCore();
    const surface = createSurface({ left: -5000, top: -5000, width: 320, height: 160 });

    coordinator.registerCore('widget-1', 'session-1', terminal.core as any);
    coordinator.registerSurface('widget-1', 'session-1', surface);

    const token = coordinator.beginInteraction('viewport_zoom');
    token.end();

    expect(terminal.handles[0]?.dispose).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();

    expect(terminal.handles[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending background resume when a new interaction starts', async () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    const terminal = createFakeCore();
    const surface = createSurface({ left: -5000, top: -5000, width: 320, height: 160 });

    coordinator.registerCore('widget-1', 'session-1', terminal.core as any);
    coordinator.registerSurface('widget-1', 'session-1', surface);

    const first = coordinator.beginInteraction('viewport_zoom');
    first.end();
    const second = coordinator.beginInteraction('viewport_pan');

    await vi.runOnlyPendingTimersAsync();

    expect(terminal.handles[0]?.dispose).not.toHaveBeenCalled();
    expect(terminal.core.beginVisualSuspend).toHaveBeenCalledTimes(1);

    second.end();
    await vi.runOnlyPendingTimersAsync();

    expect(terminal.handles[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not bounce suspension when the same core is registered twice', () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    const terminal = createFakeCore();
    const surface = createSurface({ left: 10, top: 10, width: 320, height: 160 });

    coordinator.registerCore('widget-1', 'session-1', terminal.core as any);
    coordinator.registerSurface('widget-1', 'session-1', surface);
    const token = coordinator.beginInteraction('widget_drag');

    coordinator.registerCore('widget-1', 'session-1', terminal.core as any);

    expect(terminal.handles[0]?.dispose).not.toHaveBeenCalled();
    expect(terminal.core.beginVisualSuspend).toHaveBeenCalledTimes(1);

    token.end();
    expect(terminal.handles[0]?.dispose).toHaveBeenCalledTimes(1);
  });
});
