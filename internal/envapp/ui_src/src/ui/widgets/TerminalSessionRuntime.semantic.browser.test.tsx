import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SemanticFrame,
  SemanticHistoryPage,
  SemanticPresentation,
  TerminalKeyInputIntent,
} from '@floegence/floeterm-terminal-web/semantic';
import type {
  RedevenTerminalEventSource,
  RedevenTerminalTransport,
} from '../services/terminalTransport';
import type { SemanticTerminalViewportHandle } from './semanticTerminalViewport';
import { TerminalSessionRuntime } from './TerminalSessionRuntime';

const SESSION = {
  id: 'semantic-session',
  name: 'Semantic terminal',
  workingDir: '/workspace',
  createdAtMs: 1,
  lastActiveAtMs: 1,
  isActive: true,
};

function frame(text: string, width = 80, height = 24, historyOffset = 0): SemanticFrame {
  const rows = Array.from({ length: height }, (_, row) => ({
    cells: Array.from({ length: width }, (_, col) => ({
      text: row === 0 && col === 0 ? text : '',
      width: 1,
    })),
  }));
  return {
    width,
    height,
    bufferKind: 'normal',
    rows,
    cursor: { x: Math.min(text.length, width - 1), y: 0, visible: true, shape: 'block', blinking: false },
    history: { revision: 1, totalRows: historyOffset + height, screenStartOffset: historyOffset },
    graphics: { generation: 0, images: [], placements: [] },
  };
}

function presentation(sequence: number, text: string, width = 80, height = 24): SemanticPresentation {
  const semanticFrame = frame(text, width, height, 40);
  return {
    sequence,
    geometry: { generation: sequence, cols: width, rows: height },
    state: { sequence, contentEpoch: 1 },
    frame: { ...semanticFrame, history: { ...semanticFrame.history, revision: sequence } },
  };
}

function historyPage(): SemanticHistoryPage {
  return {
    revision: 1,
    anchor: 'history-anchor',
    firstAvailable: 'first',
    lastAvailable: 'last',
    screenStart: 'screen',
    offset: 0,
    totalRows: 64,
    screenStartOffset: 40,
    hasPrevious: false,
    hasNext: true,
    frame: frame('old-history-marker', 80, 24, 0),
  };
}

function harness() {
  let presentationHandler: ((value: unknown) => void) | null = null;
  let lifecycleHandler: ((event: Parameters<Parameters<RedevenTerminalEventSource['onTerminalLiveAttachmentLifecycle']>[1]>[0]) => void) | null = null;
  let geometryHandler: ((event: Parameters<Parameters<RedevenTerminalEventSource['onTerminalGeometry']>[1]>[0]) => void) | null = null;
  let viewport: SemanticTerminalViewportHandle | null = null;
  const [fontSize, setFontSize] = createSignal(14);
  const [fontFamily, setFontFamily] = createSignal('monospace');
  const [themeColors, setThemeColors] = createSignal<Record<string, string>>({
    background: '#111111',
    foreground: '#eeeeee',
  });
  const [viewActive, setViewActive] = createSignal(true);
  let geometryGeneration = 1;
  const sendInput = vi.fn(async () => undefined);
  const sendInputIntent = vi.fn(async (_sessionId: string, _intent: TerminalKeyInputIntent) => undefined);
  const semanticHistory = vi.fn(async (_sessionId: string, request: { direction: string }) => (
    request.direction === 'end'
      ? {
          ...historyPage(),
          offset: 40,
          hasPrevious: true,
          hasNext: false,
          frame: frame('current-history-edge', 80, 24, 40),
        }
      : historyPage()
  ));
  const resizeWithEffectiveGeometry = vi.fn(async (_sessionId: string, cols: number, rows: number) => {
    geometryGeneration += 1;
    return {
      runtimeAttachGeneration: 1,
      requested: { cols, rows },
      effective: {
        generation: geometryGeneration,
        presentationSequence: geometryGeneration,
        cols,
        rows,
      },
    };
  });
  const transport: RedevenTerminalTransport = {
    attach: async () => undefined,
    attachWithPresentation: async (_sessionId, cols, rows) => {
      queueMicrotask(() => lifecycleHandler?.({
        sessionId: SESSION.id,
        runtimeAttachGeneration: 1,
        state: 'attached',
      }));
      return {
        presentationSequence: 1,
        geometryGeneration: 1,
        cols,
        rows,
        runtimeAttachGeneration: 1,
      };
    },
    resize: async () => undefined,
    resizeWithEffectiveGeometry,
    sendInput,
    sendInputIntent,
    semanticHistory,
    clearSemanticContent: async () => ({ presentationSequence: 3, contentEpoch: 2 }),
    forgetSession: vi.fn(),
    syncConnectionEpoch: () => undefined,
    dispose: () => undefined,
  };
  const eventSource: RedevenTerminalEventSource = {
    onTerminalPresentation: (_sessionId, handler) => {
      presentationHandler = handler;
      return () => { if (presentationHandler === handler) presentationHandler = null; };
    },
    onTerminalGeometry: (_sessionId, handler) => {
      geometryHandler = handler;
      return () => { if (geometryHandler === handler) geometryHandler = null; };
    },
    onTerminalLiveAttachmentLifecycle: (_sessionId, handler) => {
      lifecycleHandler = handler;
      return () => { if (lifecycleHandler === handler) lifecycleHandler = null; };
    },
    onSessionDeleted: () => () => undefined,
  };

  const root = document.createElement('div');
  Object.assign(root.style, { position: 'fixed', inset: '0', width: '900px', height: '540px' });
  document.body.appendChild(root);
  const dispose = render(() => (
    <TerminalSessionRuntime
      session={SESSION}
      variant="panel"
      active={() => true}
      connected={() => true}
      protocolClient={() => transport}
      viewActive={viewActive}
      autoFocus={() => false}
      themeColors={themeColors}
      fontSize={fontSize}
      fontFamily={fontFamily}
      agentHomePathAbs={() => '/workspace'}
      canOpenFilePreview={() => false}
      bottomInsetPx={() => 0}
      connId="semantic-view"
      transport={transport}
      eventSource={eventSource}
      registerViewport={(_sessionId, next) => { viewport = next; }}
      registerSurfaceElement={() => undefined}
      registerActions={() => undefined}
    />
  ), root);

  return {
    root,
    getViewport: () => viewport,
    emitPresentation: (value: SemanticPresentation) => presentationHandler?.(value),
    emitGeometry: (value: Parameters<NonNullable<typeof geometryHandler>>[0]) => geometryHandler?.(value),
    semanticHistory,
    resizeWithEffectiveGeometry,
    sendInput,
    sendInputIntent,
    setViewActive,
    setFontSize,
    setFontFamily,
    setThemeColors,
    dispose: () => { dispose(); root.remove(); },
  };
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function recordFixedTerminalPerformanceMetric(
  metric: string,
  samplesMs: readonly number[],
  limitMs: number,
): void {
  const sorted = [...samplesMs].sort((left, right) => left - right);
  const p95Ms = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
  console.info('[terminal-fixed-performance]', JSON.stringify({
    metric,
    samples_ms: samplesMs,
    sample_count: samplesMs.length,
    p95_ms: p95Ms,
    limit_ms: limitMs,
  }));
  if (import.meta.env.VITE_REDEVEN_FIXED_PERF_GATE === '1') {
    expect(p95Ms).toBeLessThanOrEqual(limitMs);
  }
}

describe('TerminalSessionRuntime semantic-only surface', () => {
  const mounted: Array<ReturnType<typeof harness>> = [];

  afterEach(() => {
    for (const item of mounted.splice(0)) item.dispose();
    document.body.replaceChildren();
  });

  it('mounts one semantic canvas and applies only advancing atomic presentations', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'first'));

    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    expect(runtime.root.querySelectorAll('canvas')).toHaveLength(1);
    expect(runtime.root.querySelector('[data-terminal-semantic-canvas="true"]')).toBeInstanceOf(HTMLCanvasElement);
    expect(runtime.root.querySelector('[data-terminal-input-bridge="semantic"]')).toBeInstanceOf(HTMLTextAreaElement);
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('first');

    runtime.emitPresentation(presentation(3, 'latest'));
    runtime.emitPresentation(presentation(2, 'stale'));
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('latest');
    expect(runtime.getViewport()?.getVisibleScreenText()).not.toContain('stale');
    const runtimeElement = runtime.root.querySelector<HTMLElement>('[data-terminal-runtime-session]')!;
    expect(runtimeElement.dataset.terminalPresentationSequence).toBe('3');
    expect(runtimeElement.dataset.terminalFrameCols).toBe('80');
    expect(runtimeElement.dataset.terminalFrameRows).toBe('24');
  });

  it('routes structured keys to the native intent channel while IME commits once as text', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'input'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    expect(runtime.sendInputIntent.mock.calls).toEqual([
      [SESSION.id, expect.objectContaining({ kind: 'key', code: 'Enter', action: 'press' })],
      [SESSION.id, expect.objectContaining({ kind: 'key', code: 'Enter', action: 'release' })],
    ]);
    expect(runtime.sendInput).not.toHaveBeenCalled();

    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Process',
      code: 'KeyA',
      keyCode: 229,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }));
    input.dispatchEvent(new CompositionEvent('compositionend', { data: '中', bubbles: true }));
    expect(runtime.sendInput).toHaveBeenCalledOnce();
    expect(runtime.sendInput).toHaveBeenCalledWith(SESSION.id, '中');
    expect(runtime.sendInputIntent).toHaveBeenCalledTimes(2);
  });

  it('commits pasted Unicode once and copies the renderer-owned selection', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'copy-target'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    await waitForPaint();
    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;

    input.value = '粘贴🙂';
    input.dispatchEvent(new InputEvent('input', {
      inputType: 'insertFromPaste',
      bubbles: true,
    }));
    expect(runtime.sendInput).toHaveBeenCalledOnce();
    expect(runtime.sendInput).toHaveBeenCalledWith(SESSION.id, '粘贴🙂');

    const canvas = runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
    Object.defineProperties(canvas, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    const bounds = canvas.getBoundingClientRect();
    const pointer = (type: string, x: number) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 7,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: bounds.top + 4,
      bubbles: true,
      cancelable: true,
    }));
    pointer('pointerdown', bounds.left + 2);
    pointer('pointermove', bounds.left + 20);
    pointer('pointerup', bounds.left + 20);
    expect(runtime.getViewport()?.getSelectionText()).toContain('copy-target');

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await expect(runtime.getViewport()?.copySelection('command')).resolves.toEqual({
      copied: true,
      source: 'command',
      textLength: 'copy-target'.length,
    });
    expect(writeText).toHaveBeenCalledWith('copy-target');
  });

  it('routes Ctrl+C to the native intent channel when the terminal has no selection', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'interrupt'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'C',
      code: 'KeyC',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'C',
      code: 'KeyC',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(runtime.sendInputIntent.mock.calls).toEqual([
      [SESSION.id, expect.objectContaining({
        kind: 'key',
        code: 'KeyC',
        text: 'c',
        action: 'press',
        modifiers: expect.objectContaining({ control: true }),
      })],
      [SESSION.id, expect.objectContaining({
        kind: 'key',
        code: 'KeyC',
        text: 'c',
        action: 'release',
        modifiers: expect.objectContaining({ control: true }),
      })],
    ]);
    expect(runtime.sendInput).not.toHaveBeenCalled();
  });

  it('keeps inactive observer views read-only across text and structured input', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'observer'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    runtime.setViewActive(false);
    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    input.value = 'blocked';
    input.dispatchEvent(new InputEvent('beforeinput', {
      data: 'blocked',
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
    }));

    expect(runtime.sendInputIntent).not.toHaveBeenCalled();
    expect(runtime.sendInput).not.toHaveBeenCalled();
  });

  it('projects actor-owned semantic history without creating a browser parser', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'current'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());

    const surface = runtime.root.querySelector<HTMLElement>('[data-terminal-semantic-surface="true"]')!;
    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
    await vi.waitFor(() => expect(runtime.semanticHistory).toHaveBeenCalledTimes(2));
    expect(runtime.semanticHistory.mock.calls.map((call) => call[1].direction)).toEqual(['end', 'backward']);
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('old-history-marker');
    expect(runtime.root.querySelectorAll('canvas')).toHaveLength(1);
    expect(runtime.root.querySelector('[data-floeterm-scrollbar]')?.getAttribute('data-visible')).toBe('true');
  });

  it('searches actor-owned history and keeps touch projection view-local', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'current'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());

    const results: Array<{ resultIndex: number; resultCount: number }> = [];
    runtime.getViewport()?.setSearchResultsCallback((result) => results.push(result));
    runtime.getViewport()?.findNext('old-history-marker');
    await vi.waitFor(() => expect(results.at(-1)?.resultCount).toBeGreaterThan(0));
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('old-history-marker');

    const callsBeforeTouch = runtime.semanticHistory.mock.calls.length;
    runtime.getViewport()?.getTouchScrollRuntime().scrollLines(3);
    await vi.waitFor(() => expect(runtime.semanticHistory.mock.calls.length).toBeGreaterThan(callsBeforeTouch));
    expect(runtime.getViewport()?.getPresentation()?.sequence).toBe(1);
  });

  it('settles resize geometry monotonically without replacing the canvas', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'ready'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    const canvas = runtime.root.querySelector('canvas');

    runtime.getViewport()?.forceResize();
    await vi.waitFor(() => expect(runtime.resizeWithEffectiveGeometry).toHaveBeenCalled());
    runtime.emitGeometry({
      sessionId: SESSION.id,
      generation: 3,
      presentationSequence: 3,
      cols: 100,
      rows: 30,
    });
    expect(runtime.root.querySelector('canvas')).toBe(canvas);
    expect(runtime.root.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('applies view-local typography to glyph geometry without replacing the semantic canvas', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'typography'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());

    const canvas = runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;
    const initialCanvas = canvas;
    const initialHeight = Number.parseFloat(input.style.height);
    const initialResizeCount = runtime.resizeWithEffectiveGeometry.mock.calls.length;

    runtime.setFontFamily('"Iosevka", monospace');
    runtime.setFontSize(24);

    await vi.waitFor(() => {
      expect(runtime.resizeWithEffectiveGeometry.mock.calls.length).toBeGreaterThan(initialResizeCount);
      expect(Number.parseFloat(input.style.height)).toBe(36);
    });
    const latestResize = runtime.resizeWithEffectiveGeometry.mock.calls.at(-1);
    expect(latestResize?.[2]).toBeLessThan(30);
    expect(Number.parseFloat(input.style.height)).toBeGreaterThan(initialHeight);
    expect(canvas.dataset.terminalCellHeight).toBe('36');
    expect(runtime.root.querySelector('[data-terminal-semantic-canvas="true"]')).toBe(initialCanvas);
    expect(runtime.root.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('repaints the latest Presentation for a view-local theme without changing its sequence', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(7, 'theme'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    await waitForPaint();

    const canvas = runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
    const initialCanvas = canvas;
    const initialPixel = Array.from(canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data);
    runtime.setThemeColors({ background: '#fafafa', foreground: '#101010' });
    await vi.waitFor(async () => {
      await waitForPaint();
      expect(Array.from(canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data)).not.toEqual(initialPixel);
    });

    expect(runtime.getViewport()?.getPresentation()?.sequence).toBe(7);
    expect(runtime.root.querySelector('[data-terminal-semantic-canvas="true"]')).toBe(initialCanvas);
    expect(runtime.root.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('keeps semantic presentation, input, and resize work inside fixed product budgets', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'performance'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());

    const presentationSamples: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const sequence = sample + 2;
      const started = performance.now();
      runtime.emitPresentation(presentation(sequence, `frame-${sample}`));
      await waitForPaint();
      expect(runtime.getViewport()?.getPresentation()?.sequence).toBe(sequence);
      presentationSamples.push(performance.now() - started);
    }
    recordFixedTerminalPerformanceMetric('terminal_semantic_presentation_paint', presentationSamples, 100);

    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;
    const inputSamples: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const before = runtime.sendInput.mock.calls.length;
      const started = performance.now();
      input.value = `input-${sample}`;
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
      expect(runtime.sendInput.mock.calls.length).toBe(before + 1);
      inputSamples.push(performance.now() - started);
    }
    recordFixedTerminalPerformanceMetric('terminal_semantic_input_dispatch', inputSamples, 32);

    const resizeSamples: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const before = runtime.resizeWithEffectiveGeometry.mock.calls.length;
      const started = performance.now();
      runtime.setFontSize(sample % 2 === 0 ? 15 : 14);
      await vi.waitFor(() => expect(runtime.resizeWithEffectiveGeometry.mock.calls.length).toBeGreaterThan(before));
      resizeSamples.push(performance.now() - started);
    }
    recordFixedTerminalPerformanceMetric('terminal_semantic_resize_settle', resizeSamples, 150);
  });
});
