import { describe, expect, it } from 'vitest';

import {
  createTerminalOutputViewportController,
  createTerminalVisibleOutputStore,
  mergeTerminalVisibleOutput,
  TERMINAL_OUTPUT_FOLLOW_THRESHOLD_PX,
  terminalListeningPlaceholderVisible,
  terminalVisibleOutputIdentityKey,
} from './flowerTerminalOutput';

describe('terminal visible output', () => {
  it('keeps previous output when a running poll returns no content', () => {
    expect(mergeTerminalVisibleOutput('tick 1\n', '', 'running')).toBe('tick 1\n');
    expect(terminalListeningPlaceholderVisible('tick 1\n', 'running')).toBe(false);
  });

  it('shows the listening placeholder only before any running output exists', () => {
    expect(mergeTerminalVisibleOutput('', '', 'running')).toBe('');
    expect(terminalListeningPlaceholderVisible('', 'running')).toBe(true);
    expect(terminalListeningPlaceholderVisible('', 'success')).toBe(false);
  });

  it('keeps visible output when later terminal frames are empty', () => {
    const store = createTerminalVisibleOutputStore();
    const identity = {
      surface_scope: 'test',
      run_id: 'run_1',
      turn_id: 'msg_1',
      message_id: 'msg_1',
      block_index: 0,
      item_id: 'tool:call_1',
      tool_id: 'call_1',
      command: 'npm test',
    };

    expect(store.merge(identity, '', 'tick 1\n', 'running')).toBe('tick 1\n');
    expect(store.merge(identity, '', '', 'running')).toBe('tick 1\n');
    expect(store.merge(identity, '', '', 'success')).toBe('tick 1\n');
    expect(terminalListeningPlaceholderVisible(store.get(identity), 'running')).toBe(false);
  });

  it('does not change the primary identity key when the process id arrives later', () => {
    const base = {
      surface_scope: 'test',
      run_id: 'run_1',
      message_id: 'msg_1',
      block_index: 0,
      item_id: 'tool:call_1',
      tool_id: 'call_1',
      command: 'npm test',
    };

    expect(terminalVisibleOutputIdentityKey(base)).toBe(
      terminalVisibleOutputIdentityKey({ ...base, process_id: 'tp_1' }),
    );
  });

  it('appends live output segments without duplicating repeated chunks', () => {
    expect(mergeTerminalVisibleOutput('tick 1\n', 'tick 2\n', 'running')).toBe('tick 1\ntick 2\n');
    expect(mergeTerminalVisibleOutput('tick 1\ntick 2\n', 'tick 2\n', 'running')).toBe('tick 1\ntick 2\n');
  });
});

describe('terminal output viewport following', () => {
  function createViewportHarness() {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextHandle = 1;
    let scrollHeight = 300;
    let clientHeight = 200;
    let scrollTop = 100;
    const viewport = {
      get scrollHeight() {
        return scrollHeight;
      },
      get clientHeight() {
        return clientHeight;
      },
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = value;
      },
    } as HTMLElement;
    return {
      viewport,
      requestAnimationFrame(callback: FrameRequestCallback): number {
        const handle = nextHandle;
        nextHandle += 1;
        callbacks.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame(handle: number) {
        callbacks.delete(handle);
      },
      flush() {
        const pending = [...callbacks.entries()];
        callbacks.clear();
        pending.forEach(([, callback]) => callback(16));
      },
      setMetrics(next: { scrollHeight?: number; clientHeight?: number; scrollTop?: number }) {
        scrollHeight = next.scrollHeight ?? scrollHeight;
        clientHeight = next.clientHeight ?? clientHeight;
        scrollTop = next.scrollTop ?? scrollTop;
      },
      scrollTop: () => scrollTop,
      pendingFrames: () => callbacks.size,
    };
  }

  it('follows appended output only while the user remains near the bottom', () => {
    expect(TERMINAL_OUTPUT_FOLLOW_THRESHOLD_PX).toBe(24);
    const harness = createViewportHarness();
    const controller = createTerminalOutputViewportController({
      requestAnimationFrame: harness.requestAnimationFrame,
      cancelAnimationFrame: harness.cancelAnimationFrame,
    });
    controller.bind(harness.viewport);
    harness.flush();

    harness.setMetrics({ scrollHeight: 380 });
    controller.notifyOutputChanged();
    harness.flush();
    expect(harness.scrollTop()).toBe(180);

    controller.onWheel({ deltaY: -24 });
    harness.setMetrics({ scrollTop: 80 });
    controller.onScroll();
    expect(controller.followingLatest()).toBe(false);

    harness.setMetrics({ scrollHeight: 440 });
    controller.notifyOutputChanged();
    harness.flush();
    expect(harness.scrollTop()).toBe(80);

    harness.setMetrics({ scrollTop: 240 });
    controller.onScroll();
    expect(controller.followingLatest()).toBe(true);
    harness.setMetrics({ scrollHeight: 500 });
    controller.notifyOutputChanged();
    harness.flush();
    expect(harness.scrollTop()).toBe(300);
    controller.dispose();
  });

  it('coalesces pending output updates and cancels scheduled work on disposal', () => {
    const harness = createViewportHarness();
    const controller = createTerminalOutputViewportController({
      requestAnimationFrame: harness.requestAnimationFrame,
      cancelAnimationFrame: harness.cancelAnimationFrame,
    });
    controller.bind(harness.viewport);
    controller.notifyOutputChanged();
    controller.notifyOutputChanged();
    expect(harness.pendingFrames()).toBe(1);

    controller.dispose();
    expect(harness.pendingFrames()).toBe(0);
  });
});
