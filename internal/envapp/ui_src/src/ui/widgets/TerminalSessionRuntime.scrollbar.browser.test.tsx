import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  TerminalCore,
  TerminalDataEvent,
  TerminalSessionInfo,
} from '@floegence/floeterm-terminal-web';

import '../../index.css';
import type {
  RedevenTerminalEventSource,
  RedevenTerminalTransport,
} from '../services/terminalTransport';
import type { TerminalWorkingSetRuntime } from '../services/terminalAdaptiveWorkingSet';
import { TerminalSessionRuntime } from './TerminalSessionRuntime';

const i18nTestState = vi.hoisted(() => ({
  readScrollbarLabel: (() => 'Terminal history') as () => string,
}));

vi.mock('../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../i18n')>();
  return {
    ...actual,
    useI18n: () => {
      const context = actual.useI18n();
      return {
        ...context,
        t: (key: Parameters<typeof context.t>[0], params?: Parameters<typeof context.t>[1]) => (
          key === 'terminal.historyScrollbar'
            ? i18nTestState.readScrollbarLabel()
            : context.t(key, params)
        ),
      };
    },
  };
});

const HISTORY_MARKERS = Array.from({ length: 1_200 }, (_, index) => (
  `REDEVEN-PRODUCT-SCROLLBAR-${String(index).padStart(4, '0')}`
));
const HISTORY_TEXT = `${HISTORY_MARKERS.join('\r\n')}\r\n`;
const HISTORY_BYTES = new TextEncoder().encode(HISTORY_TEXT);

const SESSION = {
  id: 'scrollbar-product-contract',
  name: 'Terminal',
  workingDir: '/workspace',
  createdAtMs: 1,
  lastActiveAtMs: 1,
  isActive: true,
} as TerminalSessionInfo;

const createTransport = (
  sendInput: RedevenTerminalTransport['sendInput'] = async () => undefined,
): RedevenTerminalTransport => ({
  attach: async () => undefined,
  attachWithHistoryBoundary: async (_sessionId, cols, rows) => ({
    historyBoundarySequence: 1,
    historyGeneration: 1,
    historyStartSequence: 1,
    geometryGeneration: 1,
    runtimeAttachGeneration: 1,
    cols,
    rows,
  }),
  resize: async () => undefined,
  resizeWithEffectiveGeometry: async (_sessionId, cols, rows) => ({
    runtimeAttachGeneration: 1,
    requested: { cols, rows },
    effective: {
      generation: 1,
      outputSequenceBoundary: 1,
      cols,
      rows,
    },
  }),
  sendInput,
  history: async () => [],
  historyPage: async () => ({
    chunks: [{ sequence: 1, timestampMs: 1, data: HISTORY_BYTES }],
    nextStartSeq: 0,
    hasMore: false,
    firstSequence: 1,
    lastSequence: 1,
    coveredThroughSequence: 1,
    snapshotEndSequence: 1,
    firstRetainedSequence: 1,
    historyGeneration: 1,
    historyReset: false,
    historyTruncated: false,
    coveredBytes: HISTORY_BYTES.byteLength,
    totalBytes: HISTORY_BYTES.byteLength,
  }),
  clear: async () => undefined,
  getSessionStats: async () => ({ history: { totalBytes: HISTORY_BYTES.byteLength } }),
  forgetSession: () => undefined,
  syncConnectionEpoch: () => undefined,
  dispose: () => undefined,
});

const bufferContains = (core: TerminalCore, marker: string): boolean => {
  const info = core.getTerminalInfo();
  if (!info) return false;
  for (let row = 0; row < info.bufferLength; row += 1) {
    if (core.readBufferLine(row).includes(marker)) return true;
  }
  return false;
};

type RuntimeHarness = Readonly<{
  host: HTMLDivElement;
  surface: () => HTMLDivElement | null;
  core: () => TerminalCore | null;
  cores: readonly TerminalCore[];
  workingSet: () => TerminalWorkingSetRuntime | null;
  emitLiveOutput: (text: string) => void;
  sendInput: ReturnType<typeof vi.fn>;
  dispose: () => void;
}>;

const mountRuntime = async (
  variant: 'panel' | 'workbench',
  label: () => string,
): Promise<RuntimeHarness> => {
  let currentCore: TerminalCore | null = null;
  let currentSurface: HTMLDivElement | null = null;
  let currentWorkingSet: TerminalWorkingSetRuntime | null = null;
  let terminalDataHandler: ((event: TerminalDataEvent) => void) | null = null;
  let liveSequence = 1;
  const cores: TerminalCore[] = [];
  const sendInput = vi.fn(async () => undefined);
  const eventSource: RedevenTerminalEventSource = {
    onTerminalData: (_sessionId, handler) => {
      terminalDataHandler = handler;
      return () => {
        if (terminalDataHandler === handler) terminalDataHandler = null;
      };
    },
    onTerminalLiveAttachmentLifecycle: (_sessionId, handler) => {
      queueMicrotask(() => handler({
        sessionId: SESSION.id,
        runtimeAttachGeneration: 1,
        state: 'attached',
      }));
      return () => undefined;
    },
  };
  i18nTestState.readScrollbarLabel = label;

  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    width: '1180px',
    height: '760px',
  });
  document.body.appendChild(host);

  const disposeRuntime = render(() => (
    <TerminalSessionRuntime
      session={SESSION}
      variant={variant}
      active={() => true}
      connected={() => true}
      protocolClient={() => ({ id: 'browser-contract-client' })}
      viewActive={() => true}
      autoFocus={() => false}
      themeColors={() => ({ background: '#101418', foreground: '#f1f5f9' })}
      fontSize={() => 12}
      fontFamily={() => 'monospace'}
      agentHomePathAbs={() => '/workspace'}
      canOpenFilePreview={() => false}
      bottomInsetPx={() => 0}
      connId="browser-contract-connection"
      transport={createTransport(sendInput)}
      eventSource={eventSource}
      registerCore={(_sessionId, core) => {
        currentCore = core;
        if (core && !cores.includes(core)) cores.push(core);
      }}
      registerSurfaceElement={(_sessionId, surface) => {
        currentSurface = surface;
      }}
      registerActions={() => undefined}
      registerWorkingSetRuntime={(_sessionId, runtime) => {
        currentWorkingSet = runtime;
      }}
      setWorkingSetInteraction={() => undefined}
    />
  ), host);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeRuntime();
    host.remove();
  };

  try {
    await vi.waitFor(() => {
      expect(currentCore).not.toBeNull();
      expect(currentWorkingSet).not.toBeNull();
      expect(currentSurface?.querySelector('[data-floeterm-scrollbar]')).not.toBeNull();
      expect(bufferContains(currentCore!, HISTORY_MARKERS.at(-1)!)).toBe(true);
    }, { timeout: 15_000 });
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    host,
    surface: () => currentSurface,
    core: () => currentCore,
    cores,
    workingSet: () => currentWorkingSet,
    emitLiveOutput: (text) => {
      liveSequence += 1;
      if (!terminalDataHandler) throw new Error('terminal live output is not subscribed');
      terminalDataHandler({
        sessionId: SESSION.id,
        type: 'data',
        data: new TextEncoder().encode(text),
        sequence: liveSequence,
        timestampMs: liveSequence,
      });
    },
    sendInput,
    dispose,
  };
};

describe('TerminalSessionRuntime real scrollbar integration', () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.dispose();
    i18nTestState.readScrollbarLabel = () => 'Terminal history';
    document.body.replaceChildren();
  });

  for (const variant of ['panel', 'workbench'] as const) {
    it(`keeps the published scrollbar visible inside the ${variant} product surface`, async () => {
      const harness = await mountRuntime(variant, () => 'Terminal history');
      harnesses.push(harness);
      const core = harness.core()!;
      const surface = harness.surface()!;
      const scrollbar = surface.querySelector<HTMLElement>('[data-floeterm-scrollbar]')!;
      const thumb = surface.querySelector<HTMLElement>('[data-floeterm-scrollbar-thumb]')!;

      expect(core.getTerminalInfo()?.bufferLength).toBeGreaterThanOrEqual(HISTORY_MARKERS.length);
      expect(bufferContains(core, HISTORY_MARKERS[0]!)).toBe(true);
      expect(bufferContains(core, HISTORY_MARKERS.at(-1)!)).toBe(true);
      expect(scrollbar.dataset.visible).toBe('true');
      expect(scrollbar.hidden).toBe(false);
      expect(scrollbar.style.width).toBe('12px');
      expect(thumb.getBoundingClientRect().height).toBeGreaterThan(0);

      const surfaceRect = surface.getBoundingClientRect();
      const scrollbarRect = scrollbar.getBoundingClientRect();
      expect(scrollbarRect.right).toBeLessThanOrEqual(surfaceRect.right + 0.5);
      expect(scrollbarRect.left).toBeGreaterThanOrEqual(surfaceRect.left - 0.5);
      expect(scrollbar.getAttribute('aria-valuenow')).toBe(scrollbar.getAttribute('aria-valuemax'));
      expect(core.getResourceEstimate().wasmMemoryBytes).toBeGreaterThan(0);
    }, 30_000);

    it(`preserves a user's reading anchor during live output in the ${variant} product surface`, async () => {
      const harness = await mountRuntime(variant, () => 'Terminal history');
      harnesses.push(harness);
      const surface = harness.surface()!;
      const scrollbar = surface.querySelector<HTMLElement>('[data-floeterm-scrollbar]')!;
      const canvas = surface.querySelector<HTMLCanvasElement>('canvas')!;

      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      canvas.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: -480,
      }));
      await vi.waitFor(() => {
        expect(scrollbar.getAttribute('aria-valuenow')).not.toBe(scrollbar.getAttribute('aria-valuemax'));
      });

      const anchoredValue = Number(scrollbar.getAttribute('aria-valuenow'));
      const initialMaximum = Number(scrollbar.getAttribute('aria-valuemax'));
      for (let batch = 0; batch < 3; batch += 1) {
        harness.emitLiveOutput(Array.from(
          { length: 6 },
          (_, index) => `PI-AGENT-LIVE-${batch}-${index}\r\n`,
        ).join(''));
      }

      await vi.waitFor(() => {
        expect(bufferContains(harness.core()!, 'PI-AGENT-LIVE-2-5')).toBe(true);
        expect(Number(scrollbar.getAttribute('aria-valuemax'))).toBeGreaterThan(initialMaximum);
      });
      expect(Number(scrollbar.getAttribute('aria-valuenow'))).toBe(anchoredValue);
      expect(scrollbar.getAttribute('aria-valuenow')).not.toBe(scrollbar.getAttribute('aria-valuemax'));

      const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Terminal input"]')!;
      input.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText',
      }));
      await vi.waitFor(() => {
        expect(scrollbar.getAttribute('aria-valuenow')).toBe(scrollbar.getAttribute('aria-valuemax'));
        expect(harness.sendInput).toHaveBeenCalledWith(SESSION.id, 'x', 'browser-contract-connection');
      });
    }, 30_000);
  }

  it('updates the live label and rebuilds the localized overlay after hibernate', async () => {
    const [label, setLabel] = createSignal('Terminal history');
    const harness = await mountRuntime('panel', label);
    harnesses.push(harness);
    const firstCore = harness.core()!;
    const firstSurface = harness.surface()!;
    const firstScrollbar = firstSurface.querySelector<HTMLElement>('[data-floeterm-scrollbar]')!;
    const firstInput = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Terminal input"]')!;
    const dimensionsBefore = firstCore.getDimensions();
    const viewportBefore = firstScrollbar.getAttribute('aria-valuenow');
    firstCore.focus();

    setLabel('終端機歷程');
    await vi.waitFor(() => {
      expect(firstScrollbar.getAttribute('aria-label')).toBe('終端機歷程');
    });
    expect(harness.core()).toBe(firstCore);
    expect(harness.cores).toHaveLength(1);
    expect(firstCore.getDimensions()).toEqual(dimensionsBefore);
    expect(firstScrollbar.getAttribute('aria-valuenow')).toBe(viewportBefore);
    expect(document.activeElement).toBe(firstInput);

    const snapshot = await harness.workingSet()!.hibernate();
    expect(snapshot).not.toBeNull();
    expect(firstScrollbar.isConnected).toBe(false);
    expect(harness.core()).toBeNull();

    await harness.workingSet()!.resume(snapshot);
    await vi.waitFor(() => {
      expect(harness.core()).not.toBeNull();
      expect(harness.core()).not.toBe(firstCore);
      expect(harness.surface()?.querySelector('[data-floeterm-scrollbar]')).not.toBeNull();
    }, { timeout: 15_000 });

    const resumedCore = harness.core()!;
    const resumedScrollbar = harness.surface()!.querySelector<HTMLElement>('[data-floeterm-scrollbar]')!;
    expect(harness.cores).toHaveLength(2);
    expect(resumedScrollbar.getAttribute('aria-label')).toBe('終端機歷程');
    expect(resumedScrollbar.dataset.visible).toBe('true');
    expect(resumedScrollbar.getAttribute('aria-valuenow')).toBe(resumedScrollbar.getAttribute('aria-valuemax'));
    expect(bufferContains(resumedCore, HISTORY_MARKERS[0]!)).toBe(true);
    expect(bufferContains(resumedCore, HISTORY_MARKERS.at(-1)!)).toBe(true);

    setLabel('Terminal history');
    await vi.waitFor(() => {
      expect(resumedScrollbar.getAttribute('aria-label')).toBe('Terminal history');
    });
    expect(harness.core()).toBe(resumedCore);
    expect(harness.cores).toHaveLength(2);

    harness.dispose();
    expect(harness.core()).toBeNull();
    expect(resumedScrollbar.isConnected).toBe(false);
    expect(resumedCore.getResourceEstimate()).toMatchObject({
      bufferBytes: 0,
      cellCount: 0,
      wasmMemoryBytes: 0,
      estimatedBytes: 0,
    });
  }, 30_000);
});
