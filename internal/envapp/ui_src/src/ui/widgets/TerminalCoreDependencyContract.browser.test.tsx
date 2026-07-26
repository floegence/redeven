import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultTerminalConfig,
  TerminalCore,
  type TerminalRestorableSnapshot,
} from '@floegence/floeterm-terminal-web';

import {
  TERMINAL_WORKING_SET_HIDDEN_DELAY_MS,
  createTerminalAdaptiveWorkingSetManager,
  type TerminalWorkingSetScheduler,
} from '../services/terminalAdaptiveWorkingSet';

const INITIAL_DIMENSIONS = { cols: 80, rows: 24 } as const;
const FIXED_DIMENSIONS = { cols: 166, rows: 53 } as const;
const TERMINAL_SCROLLBAR_ARIA_LABEL = 'Terminal history';

const createTerminalHost = (): HTMLDivElement => {
  const host = document.createElement('div');
  host.style.width = '1600px';
  host.style.height = '900px';
  host.style.position = 'fixed';
  host.style.inset = '0';
  document.body.appendChild(host);
  return host;
};

const createPublishedCore = (host: HTMLDivElement): TerminalCore => {
  const config = getDefaultTerminalConfig('dark', {
    ...INITIAL_DIMENSIONS,
    fixedDimensions: INITIAL_DIMENSIONS,
    rendererType: 'webgl',
    cursorBlink: false,
    fit: { scrollbarReservePx: 15 },
    scrollbar: {
      visibility: 'persistent',
      ariaLabel: TERMINAL_SCROLLBAR_ARIA_LABEL,
    },
  });
  expect(config.scrollback).toBe(10_000);
  return new TerminalCore(host, config);
};

const initializeAtFixedDimensions = async (host: HTMLDivElement): Promise<TerminalCore> => {
  const core = createPublishedCore(host);
  await core.initialize();
  expect(core.getDimensions()).toEqual(INITIAL_DIMENSIONS);
  core.setFixedDimensions(FIXED_DIMENSIONS);
  await core.forceResizeAndWaitForPresentation();
  expect(core.getDimensions()).toEqual(FIXED_DIMENSIONS);
  return core;
};

const writeHistory = (core: TerminalCore, data: string): Promise<void> => (
  new Promise<void>((resolve) => core.writeHistory(data, resolve))
);

const bufferContains = (core: TerminalCore, marker: string): boolean => {
  const info = core.getTerminalInfo();
  if (!info) return false;
  for (let row = 0; row < info.bufferLength; row += 1) {
    if (core.readBufferLine(row).includes(marker)) return true;
  }
  return false;
};

const expectReleasedEstimate = (core: TerminalCore): void => {
  expect(core.getResourceEstimate()).toMatchObject({
    bufferBytes: 0,
    cellCount: 0,
    wasmMemoryBytes: 0,
    estimatedBytes: 0,
  });
};

const createWorkingSetScheduler = () => {
  let nextHandle = 1;
  const idleCallbacks = new Map<number, () => void>();
  const timerCallbacks = new Map<number, { callback: () => void; delayMs: number }>();
  const scheduler: TerminalWorkingSetScheduler = {
    scheduleIdle: (callback) => {
      const handle = nextHandle++;
      idleCallbacks.set(handle, callback);
      return handle;
    },
    cancelIdle: (handle) => {
      idleCallbacks.delete(handle);
    },
    setTimer: (callback, delayMs) => {
      const handle = nextHandle++ as unknown as ReturnType<typeof setTimeout>;
      timerCallbacks.set(handle as unknown as number, { callback, delayMs });
      return handle;
    },
    clearTimer: (handle) => {
      timerCallbacks.delete(handle as unknown as number);
    },
  };

  return {
    scheduler,
    fireHiddenTimer: () => {
      const entry = [...timerCallbacks.entries()].find(([, timer]) => (
        timer.delayMs === TERMINAL_WORKING_SET_HIDDEN_DELAY_MS
      ));
      expect(entry).toBeDefined();
      if (!entry) return;
      timerCallbacks.delete(entry[0]);
      entry[1].callback();
    },
    runNextIdle: () => {
      const entry = idleCallbacks.entries().next().value as [number, () => void] | undefined;
      expect(entry).toBeDefined();
      if (!entry) return;
      idleCallbacks.delete(entry[0]);
      entry[1]();
    },
  };
};

describe('published Floeterm TerminalCore dependency contract', () => {
  const cores = new Set<TerminalCore>();

  afterEach(() => {
    for (const core of cores) core.dispose();
    cores.clear();
    document.body.replaceChildren();
  });

  it('preserves configured buffer rows and reports owned WASM memory', async () => {
    const host = createTerminalHost();
    const core = await initializeAtFixedDimensions(host);
    cores.add(core);
    const markers = Array.from({ length: 1_200 }, (_, index) => (
      `REDEVEN-SCROLLBACK-${String(index).padStart(4, '0')}`
    ));

    await writeHistory(core, markers.join('\r\n'));

    const info = core.getTerminalInfo();
    expect(info).toMatchObject(FIXED_DIMENSIONS);
    expect(info?.bufferLength).toBeGreaterThanOrEqual(markers.length);
    expect(bufferContains(core, markers[0]!)).toBe(true);
    expect(bufferContains(core, markers.at(-1)!)).toBe(true);

    const scrollbar = host.querySelector<HTMLElement>('[data-floeterm-scrollbar]');
    const scrollbarThumb = host.querySelector<HTMLElement>('[data-floeterm-scrollbar-thumb]');
    expect(scrollbar).not.toBeNull();
    expect(scrollbarThumb).not.toBeNull();
    expect(scrollbar?.getAttribute('role')).toBe('scrollbar');
    expect(scrollbar?.getAttribute('aria-label')).toBe(TERMINAL_SCROLLBAR_ARIA_LABEL);
    expect(scrollbar?.dataset.visible).toBe('true');
    expect(scrollbar?.hidden).toBe(false);
    expect(scrollbar?.getBoundingClientRect().width).toBe(12);
    expect(scrollbarThumb!.getBoundingClientRect().height).toBeGreaterThan(0);

    const estimate = core.getResourceEstimate();
    expect(Number.isFinite(estimate.wasmMemoryBytes)).toBe(true);
    expect(estimate.wasmMemoryBytes).toBeGreaterThan(0);
    expect(Number.isFinite(estimate.estimatedBytes)).toBe(true);
    expect(estimate.estimatedBytes).toBeGreaterThanOrEqual(estimate.wasmMemoryBytes);
    expect(Number.isFinite(estimate.bufferBytes)).toBe(true);
    expect(Number.isFinite(estimate.cellCount)).toBe(true);

    core.dispose();
    cores.delete(core);
    expectReleasedEstimate(core);
  });

  it('releases a hidden Core and restores its snapshot into a fresh Core', async () => {
    const schedulerHarness = createWorkingSetScheduler();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 8,
      scheduler: schedulerHarness.scheduler,
    });
    const firstHost = createTerminalHost();
    const firstCore = await initializeAtFixedDimensions(firstHost);
    cores.add(firstCore);
    let currentCore: TerminalCore | null = firstCore;
    let resumedCore: TerminalCore | null = null;
    const restoredMarker = 'REDEVEN-HIBERNATE-RESTORE-MARKER';
    const appendedMarker = 'REDEVEN-HIBERNATE-APPENDED-MARKER';
    await writeHistory(firstCore, `before-hidden\r\n${restoredMarker}\r\n`);

    const unregister = manager.register('real-terminal', {
      getResourceEstimate: () => currentCore?.getResourceEstimate() ?? {
        bufferBytes: 0,
        cellCount: 0,
        wasmMemoryBytes: 0,
        estimatedBytes: 0,
        rendererType: 'canvas',
      },
      hibernate: (): TerminalRestorableSnapshot | null => {
        const core = currentCore;
        if (!core) return null;
        const snapshot = core.captureRestorableSnapshot({ coveredThroughSequence: 42 });
        core.dispose();
        currentCore = null;
        return snapshot;
      },
      resume: async (snapshot) => {
        const core = await initializeAtFixedDimensions(createTerminalHost());
        cores.add(core);
        if (snapshot && !(await core.restoreSnapshot(snapshot))) {
          core.dispose();
          cores.delete(core);
          throw new Error('Published TerminalCore rejected its own restorable snapshot');
        }
        currentCore = core;
        resumedCore = core;
      },
    });

    try {
      manager.setPageHidden(true);
      schedulerHarness.fireHiddenTimer();
      schedulerHarness.runNextIdle();
      await vi.waitFor(() => {
        expect(manager.getSnapshot().entries[0]?.warm).toBe(false);
      });

      expect(currentCore).toBeNull();
      expectReleasedEstimate(firstCore);
      expect(firstHost.childElementCount).toBe(0);
      expect(manager.getSnapshot().entries[0]?.snapshotCoveredThroughSequence).toBe(42);

      manager.setPageHidden(false);
      manager.setActiveSession('real-terminal');
      await vi.waitFor(() => {
        expect(manager.getSnapshot().entries[0]?.warm).toBe(true);
        expect(resumedCore).not.toBeNull();
      });

      expect(resumedCore).not.toBe(firstCore);
      expect(bufferContains(resumedCore!, restoredMarker)).toBe(true);
      await writeHistory(resumedCore!, `${appendedMarker}\r\n`);
      expect(bufferContains(resumedCore!, appendedMarker)).toBe(true);
      const resumedEstimate = resumedCore!.getResourceEstimate();
      expect(resumedEstimate.wasmMemoryBytes).toBeGreaterThan(0);
      expect(Number.isFinite(resumedEstimate.estimatedBytes)).toBe(true);
    } finally {
      unregister();
      manager.dispose();
    }
  });
});
