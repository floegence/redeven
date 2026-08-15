import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SemanticFrame,
  SemanticHistoryPage,
  SemanticHistoryRequest,
  SemanticPresentation,
  TerminalKeyInputIntent,
} from '@floegence/floeterm-terminal-web/semantic';
import type {
  RedevenTerminalEventSource,
  RedevenTerminalTransport,
} from '../services/terminalTransport';
import type { SemanticTerminalViewportHandle } from './semanticTerminalViewport';
import {
  TerminalSessionRuntime,
  type TerminalSessionRuntimeStatus,
} from './TerminalSessionRuntime';

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

function harness(options: Readonly<{
  controller?: boolean;
  autoFocus?: boolean;
  attachSettlement?: Promise<void>;
}> = {}) {
  let presentationHandler: ((value: unknown) => void) | null = null;
  let lifecycleHandler: ((event: Parameters<Parameters<RedevenTerminalEventSource['onTerminalLiveAttachmentLifecycle']>[1]>[0]) => void) | null = null;
  let geometryHandler: ((event: Parameters<Parameters<RedevenTerminalEventSource['onTerminalGeometry']>[1]>[0]) => void) | null = null;
  let controllerHandler: ((event: Parameters<Parameters<RedevenTerminalEventSource['onTerminalController']>[1]>[0]) => void) | null = null;
  let viewport: SemanticTerminalViewportHandle | null = null;
  const statuses: TerminalSessionRuntimeStatus[] = [];
  const [fontSize, setFontSize] = createSignal(14);
  const [fontFamily, setFontFamily] = createSignal('monospace');
  const [themeColors, setThemeColors] = createSignal<Record<string, string>>({
    background: '#111111',
    foreground: '#eeeeee',
  });
  const [viewActive, setViewActive] = createSignal(true);
  const [active, setActive] = createSignal(true);
  let geometryGeneration = 1;
  const sendInput = vi.fn(async () => undefined);
  const sendInputIntent = vi.fn(async (_sessionId: string, _intent: TerminalKeyInputIntent) => undefined);
  const semanticHistory = vi.fn(async (_sessionId: string, request: SemanticHistoryRequest) => (
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
  const activate = vi.fn(async (_sessionId: string, cols: number, rows: number) => {
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
      controller: { epoch: 2, isController: true },
    };
  });
  const attachWithPresentation = vi.fn(async (_sessionId: string, cols: number, rows: number) => {
    await options.attachSettlement;
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
      controllerEpoch: 1,
      isController: options.controller ?? true,
    };
  });
  const transport = {
    attach: async () => undefined,
    attachWithPresentation,
    resize: async () => undefined,
    resizeWithEffectiveGeometry,
    activate,
    sendInput,
    sendInputIntent,
    semanticHistory,
    clearSemanticContent: async () => ({ presentationSequence: 3, contentEpoch: 2 }),
    forgetSession: vi.fn(),
    syncConnectionEpoch: () => undefined,
    dispose: () => undefined,
  } as RedevenTerminalTransport;
  const eventSource: RedevenTerminalEventSource = {
    onTerminalPresentation: (_sessionId, handler) => {
      presentationHandler = handler;
      return () => { if (presentationHandler === handler) presentationHandler = null; };
    },
    onTerminalGeometry: (_sessionId, handler) => {
      geometryHandler = handler;
      return () => { if (geometryHandler === handler) geometryHandler = null; };
    },
    onTerminalController: (_sessionId, handler) => {
      controllerHandler = handler;
      return () => { if (controllerHandler === handler) controllerHandler = null; };
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
      active={active}
      connected={() => true}
      protocolClient={() => transport}
      viewActive={viewActive}
      autoFocus={() => options.autoFocus ?? false}
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
      onRuntimeStatus={(_sessionId, status) => statuses.push(status)}
    />
  ), root);
  const runtimeElement = root.querySelector<HTMLElement>('[data-terminal-runtime-session]')!;
  const semanticSurface = root.querySelector<HTMLElement>('[data-terminal-semantic-surface="true"]')!;
  const semanticCanvas = root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
  Object.assign(runtimeElement.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  });
  Object.assign(semanticSurface.style, {
    position: 'absolute',
    top: '8px',
    left: '8px',
    right: '0',
    bottom: '0',
    overflow: 'hidden',
  });
  Object.assign(semanticCanvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
  });

  return {
    root,
    getViewport: () => viewport,
    emitPresentation: (value: SemanticPresentation) => presentationHandler?.(value),
    emitGeometry: (value: Parameters<NonNullable<typeof geometryHandler>>[0]) => geometryHandler?.(value),
    emitController: (value: Parameters<NonNullable<typeof controllerHandler>>[0]) => controllerHandler?.(value),
    semanticHistory,
    attachWithPresentation,
    resizeWithEffectiveGeometry,
    activate,
    statuses,
    sendInput,
    sendInputIntent,
    setViewActive,
    setActive,
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

  it('does not let an observer reacquire controller ownership merely because output advances', async () => {
    const runtime = harness({ autoFocus: true });
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'controller-view'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    await vi.waitFor(() => expect(runtime.root.querySelector('[data-terminal-runtime-session]')
      ?.getAttribute('data-terminal-is-controller')).toBe('true'));
    runtime.activate.mockClear();

    runtime.emitController({ sessionId: SESSION.id, epoch: 2, isController: false });
    runtime.emitPresentation(presentation(2, 'observer-output'));
    await waitForPaint();

    expect(runtime.root.querySelector('[data-terminal-runtime-session]')
      ?.getAttribute('data-terminal-is-controller')).toBe('false');
    expect(runtime.activate).not.toHaveBeenCalled();
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('observer-output');
    expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);
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
    await vi.waitFor(() => expect(runtime.sendInputIntent).toHaveBeenCalledTimes(2));
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

  it('keeps a same-cell click selection-free while preserving intentional drag selection', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'click-target'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    await waitForPaint();

    const canvas = runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
    Object.defineProperties(canvas, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    const bounds = canvas.getBoundingClientRect();
    const pointer = (type: string, x: number, pointerId: number) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: bounds.top + 4,
      bubbles: true,
      cancelable: true,
    }));

    pointer('pointerdown', bounds.left + 2, 8);
    pointer('pointerup', bounds.left + 2, 8);
    expect(runtime.getViewport()?.hasSelection()).toBe(false);
    expect(runtime.getViewport()?.getSelectionText()).toBe('');

    pointer('pointerdown', bounds.left + 2, 9);
    pointer('pointermove', bounds.left + 20, 9);
    pointer('pointerup', bounds.left + 20, 9);
    expect(runtime.getViewport()?.getSelectionText()).toContain('click-target');
  });

  it('atomically activates an observer with its measured geometry before user input', async () => {
    const runtime = harness({ controller: false });
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'observer'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());

    let settleActivation!: () => void;
    const activationSettlement = new Promise<void>((resolve) => {
      settleActivation = resolve;
    });
    runtime.activate.mockImplementationOnce(async (_sessionId, cols, rows) => {
      await activationSettlement;
      return {
        runtimeAttachGeneration: 1,
        requested: { cols, rows },
        effective: {
          generation: 2,
          presentationSequence: 2,
          cols,
          rows,
        },
        controller: { epoch: 2, isController: true },
      };
    });

    const canvas = runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;
    Object.defineProperties(canvas, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 10,
      button: 0,
      buttons: 1,
      clientX: bounds.left + 2,
      clientY: bounds.top + 4,
      bubbles: true,
      cancelable: true,
    }));

    await vi.waitFor(() => expect(runtime.activate).toHaveBeenCalledOnce());
    expect(document.activeElement).not.toBe(input);
    expect(runtime.activate).toHaveBeenCalledWith(
      SESSION.id,
      expect.any(Number),
      expect.any(Number),
    );
    input.value = 'x';
    input.dispatchEvent(new InputEvent('input', {
      inputType: 'insertText',
      data: 'x',
      bubbles: true,
    }));
    input.value = 'y';
    input.dispatchEvent(new InputEvent('input', {
      inputType: 'insertText',
      data: 'y',
      bubbles: true,
    }));
    await Promise.resolve();
    expect(runtime.sendInput).not.toHaveBeenCalled();

    settleActivation();
    await vi.waitFor(() => expect(runtime.sendInput).toHaveBeenCalledTimes(2));
    expect(runtime.sendInput.mock.calls).toEqual([
      [SESSION.id, 'x'],
      [SESSION.id, 'y'],
    ]);
    expect(document.activeElement).toBe(input);
    const runtimeElement = runtime.root.querySelector<HTMLElement>('[data-terminal-runtime-session]')!;
    expect(runtimeElement.dataset.terminalControllerEpoch).toBe('2');
    expect(runtimeElement.dataset.terminalIsController).toBe('true');
  });

  it('measures controller geometry from the host content box instead of a workbench transform', async () => {
    const runtime = harness({ controller: false });
    mounted.push(runtime);
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    const surface = runtime.root.querySelector<HTMLElement>('[data-terminal-semantic-surface="true"]')!;
    const canvas = runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
    surface.style.transformOrigin = 'top left';
    surface.style.transform = 'scale(0.45)';
    const cellWidth = Number(canvas.dataset.terminalCellWidth);
    const cellHeight = Number(canvas.dataset.terminalCellHeight);
    const expectedCols = Math.floor(surface.clientWidth / cellWidth);
    const expectedRows = Math.floor(surface.clientHeight / cellHeight);
    expect(surface.getBoundingClientRect().width).toBeLessThan(surface.clientWidth);

    runtime.activate.mockClear();
    await runtime.getViewport()!.activate();

    expect(runtime.activate).toHaveBeenCalledWith(SESSION.id, expectedCols, expectedRows);
  });

  it('activates a selected view before exposing its input bridge as focused', async () => {
    const runtime = harness({ controller: false, autoFocus: true });
    mounted.push(runtime);
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    const runtimeElement = runtime.root.querySelector<HTMLElement>('[data-terminal-runtime-session]')!;
    await vi.waitFor(() => expect(runtimeElement.dataset.terminalControllerEpoch).toBe('1'));

    let settleActivation!: () => void;
    const activationSettlement = new Promise<void>((resolve) => {
      settleActivation = resolve;
    });
    runtime.activate.mockImplementationOnce(async (_sessionId, cols, rows) => {
      await activationSettlement;
      return {
        runtimeAttachGeneration: 1,
        requested: { cols, rows },
        effective: {
          generation: 2,
          presentationSequence: 2,
          cols,
          rows,
        },
        controller: { epoch: 2, isController: true },
      };
    });

    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;
    runtime.emitPresentation(presentation(1, 'selected-observer'));
    await vi.waitFor(() => expect(runtime.activate).toHaveBeenCalledOnce());
    expect(document.activeElement).not.toBe(input);

    settleActivation();
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    expect(runtimeElement.dataset.terminalIsController).toBe('true');
  });

  it('shares one in-flight attachment across concurrent activation requests', async () => {
    let settleAttach!: () => void;
    const attachSettlement = new Promise<void>((resolve) => {
      settleAttach = resolve;
    });
    const runtime = harness({ controller: false, attachSettlement });
    mounted.push(runtime);
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    await vi.waitFor(() => expect(runtime.attachWithPresentation).toHaveBeenCalledOnce());

    const first = runtime.getViewport()!.activate();
    const second = runtime.getViewport()!.activate();
    await Promise.resolve();
    expect(runtime.attachWithPresentation).toHaveBeenCalledOnce();
    expect(runtime.activate).not.toHaveBeenCalled();

    settleAttach();
    await Promise.all([first, second]);
    expect(runtime.attachWithPresentation).toHaveBeenCalledOnce();
    expect(runtime.activate).toHaveBeenCalledOnce();
  });

  it('fails closed with the activation reason and never writes input after a rejected takeover', async () => {
    const runtime = harness({ controller: false });
    mounted.push(runtime);
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    runtime.activate.mockRejectedValueOnce(new Error('stale terminal controller epoch'));

    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;
    input.value = 'must-not-write';
    input.dispatchEvent(new InputEvent('input', {
      inputType: 'insertText',
      data: 'must-not-write',
      bubbles: true,
    }));

    await vi.waitFor(() => expect(runtime.activate).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(runtime.statuses.at(-1)).toMatchObject({
      state: 'blocking',
      failureCode: 'terminal_activation_failed',
      retryable: false,
    }));
    expect(runtime.sendInput).not.toHaveBeenCalled();
    expect(runtime.root.querySelector('[data-terminal-semantic-error="true"]')?.textContent)
      .toContain('stale terminal controller epoch');
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

    await vi.waitFor(() => expect(runtime.sendInputIntent).toHaveBeenCalledTimes(2));
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

  it('routes common shell editing shortcuts to the native intent channel exactly once', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'shell-shortcuts'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;
    input.focus();

    const shortcuts = [
      { key: 'a', code: 'KeyA', ctrlKey: true },
      { key: 'd', code: 'KeyD', ctrlKey: true },
      { key: 'e', code: 'KeyE', ctrlKey: true },
      { key: 'h', code: 'KeyH', ctrlKey: true },
      { key: 'k', code: 'KeyK', ctrlKey: true },
      { key: 'l', code: 'KeyL', ctrlKey: true },
      { key: 'p', code: 'KeyP', ctrlKey: true },
      { key: 'r', code: 'KeyR', ctrlKey: true },
      { key: 'u', code: 'KeyU', ctrlKey: true },
      { key: 'w', code: 'KeyW', ctrlKey: true },
      { key: 'z', code: 'KeyZ', ctrlKey: true },
      { key: 'b', code: 'KeyB', altKey: true },
      { key: 'f', code: 'KeyF', altKey: true },
      { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true },
      { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true },
      { key: ' ', code: 'Space', ctrlKey: true },
      { key: '\\', code: 'Backslash', ctrlKey: true },
      { key: ']', code: 'BracketRight', ctrlKey: true },
      { key: '^', code: 'Digit6', ctrlKey: true, shiftKey: true },
      { key: '_', code: 'Minus', ctrlKey: true, shiftKey: true },
      { key: 'Home', code: 'Home' },
      { key: 'End', code: 'End' },
      { key: 'Delete', code: 'Delete' },
      { key: 'Tab', code: 'Tab', shiftKey: true },
    ] as const;

    for (const shortcut of shortcuts) {
      const before = runtime.sendInputIntent.mock.calls.length;
      for (const type of ['keydown', 'keyup'] as const) {
        input.dispatchEvent(new KeyboardEvent(type, {
          ...shortcut,
          bubbles: true,
          cancelable: true,
        }));
      }
      await vi.waitFor(() => expect(runtime.sendInputIntent.mock.calls.length).toBe(before + 2));
      expect(runtime.sendInputIntent.mock.calls.slice(before).map((call) => call[1])).toEqual([
        expect.objectContaining({ kind: 'key', code: shortcut.code, action: 'press' }),
        expect.objectContaining({ kind: 'key', code: shortcut.code, action: 'release' }),
      ]);
    }
    expect(runtime.sendInput).not.toHaveBeenCalled();
  });

  it('renders a published inverse cell as the Pi-style software cursor without inventing a VT cursor', async () => {
    const runtime = harness();
    mounted.push(runtime);
    const value = presentation(1, 'P');
    value.frame.cursor.visible = false;
    value.frame.rows[0]!.cells[0] = { text: 'P', width: 1, style: { inverse: true } };
    runtime.emitPresentation(value);
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    await waitForPaint();

    const canvas = runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
    const context = canvas.getContext('2d')!;
    const cellWidthCssPx = Number(canvas.dataset.terminalCellWidth);
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const inverseBackground = context.getImageData(Math.max(0, Math.round(dpr)), Math.max(0, Math.round(dpr)), 1, 1).data;
    const normalBackground = context.getImageData(
      Math.max(0, Math.round((cellWidthCssPx + 1) * dpr)),
      Math.max(0, Math.round(dpr)),
      1,
      1,
    ).data;

    expect(inverseBackground[0] + inverseBackground[1] + inverseBackground[2])
      .toBeGreaterThan(normalBackground[0] + normalBackground[1] + normalBackground[2]);
    expect(runtime.getViewport()?.getPresentation()?.frame.cursor.visible).toBe(false);
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('P');
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

  it('does not reclaim controller ownership when a hidden display mode receives a Presentation', async () => {
    const runtime = harness({ controller: false, autoFocus: true });
    mounted.push(runtime);
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    runtime.setViewActive(false);
    runtime.activate.mockClear();

    runtime.emitPresentation(presentation(2, 'hidden-peer-update'));
    await Promise.resolve();

    expect(runtime.activate).not.toHaveBeenCalled();
  });

  it('never exposes a keep-mounted canvas with stale backing while its tab is inactive', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'switch-safe'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    await waitForPaint();

    const canvas = runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
    runtime.setActive(false);
    await vi.waitFor(() => expect(canvas.style.visibility).toBe('hidden'));

    runtime.setActive(true);
    await vi.waitFor(() => expect(canvas.style.visibility).toBe('visible'));
    const bounds = canvas.getBoundingClientRect();
    expect(canvas.width).toBe(Math.round(bounds.width * window.devicePixelRatio));
    expect(canvas.height).toBe(Math.round(bounds.height * window.devicePixelRatio));
    expect(runtime.root.querySelectorAll('[data-terminal-semantic-canvas="true"]')).toHaveLength(1);
  });

  it('keeps three zero-sized keep-mounted tabs paint-safe across fifty DPR-aware switches', async () => {
    const runtimes = [harness(), harness(), harness()];
    mounted.push(...runtimes);
    runtimes.forEach((runtime, index) => runtime.emitPresentation(
      presentation(index + 1, `tab-${index + 1}`),
    ));
    await vi.waitFor(() => runtimes.forEach((runtime) => expect(runtime.getViewport()).not.toBeNull()));
    await waitForPaint();

    const canvases = runtimes.map((runtime) => (
      runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!
    ));
    const cellMetrics = canvases.map((canvas) => ({
      width: canvas.dataset.terminalCellWidth,
      height: canvas.dataset.terminalCellHeight,
    }));
    const originalDpr = window.devicePixelRatio;
    try {
      runtimes.forEach((runtime) => {
        runtime.setActive(false);
        runtime.root.style.width = '0px';
        runtime.root.style.height = '0px';
      });
      await Promise.resolve();
      for (let switchIndex = 0; switchIndex < 50; switchIndex += 1) {
        const selected = switchIndex % runtimes.length;
        const dpr = [1, 1.5, 2][switchIndex % 3]!;
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
        runtimes.forEach((runtime, index) => {
          if (index === selected) return;
          runtime.setActive(false);
          runtime.root.style.width = '0px';
          runtime.root.style.height = '0px';
        });
        runtimes[selected]!.root.style.width = '900px';
        runtimes[selected]!.root.style.height = '540px';
        runtimes[selected]!.setActive(true);

        await Promise.resolve();
        const assertCommittedFrame = (requireVisible: boolean) => {
          runtimes.forEach((runtime, index) => {
            const canvas = canvases[index]!;
            expect(runtime.root.querySelectorAll('[data-terminal-semantic-canvas="true"]')).toHaveLength(1);
            expect(runtime.root.querySelector('[data-terminal-semantic-canvas="true"]')).toBe(canvas);
            if (index !== selected) {
              expect(canvas.style.visibility).toBe('hidden');
              return;
            }
            const bounds = canvas.getBoundingClientRect();
            expect(bounds.width).toBeGreaterThan(0);
            expect(bounds.height).toBeGreaterThan(0);
            if (requireVisible) {
              expect(canvas.style.visibility, JSON.stringify({
                switchIndex,
                selected,
                index,
                dpr,
                sessionActive: runtime.root.querySelector<HTMLElement>('[data-terminal-runtime-session]')
                  ?.dataset.terminalSessionActive,
                viewActive: runtime.root.querySelector<HTMLElement>('[data-terminal-runtime-session]')
                  ?.dataset.terminalViewActive,
                visibilityCommit: canvas.dataset.terminalVisibilityCommit,
                semanticError: runtime.root.querySelector('[data-terminal-semantic-error="true"]')?.textContent,
                rootRect: runtime.root.getBoundingClientRect().toJSON(),
                rootStyle: {
                  position: getComputedStyle(runtime.root).position,
                  width: getComputedStyle(runtime.root).width,
                  height: getComputedStyle(runtime.root).height,
                },
                hostClient: {
                  width: canvas.parentElement?.clientWidth,
                  height: canvas.parentElement?.clientHeight,
                },
                bounds: { width: bounds.width, height: bounds.height },
                backing: { width: canvas.width, height: canvas.height },
              })).toBe('visible');
            } else {
              expect(['hidden', 'visible']).toContain(canvas.style.visibility);
              if (canvas.style.visibility === 'hidden') {
                const surface = canvas.parentElement!;
                expect(getComputedStyle(surface).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
                return;
              }
            }
            expect(canvas.width).toBe(Math.round(bounds.width * dpr));
            expect(canvas.height).toBe(Math.round(bounds.height * dpr));
            expect(canvas.dataset.terminalCellWidth).toBe(cellMetrics[index]!.width);
            expect(canvas.dataset.terminalCellHeight).toBe(cellMetrics[index]!.height);
          });
        };
        assertCommittedFrame(false);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        assertCommittedFrame(false);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        assertCommittedFrame(true);
      }
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalDpr });
    }
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
    expect(runtime.semanticHistory.mock.calls[1]?.[1]).toMatchObject({ anchor: 'screen' });
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('old-history-marker');
    expect(runtime.root.querySelectorAll('canvas')).toHaveLength(1);
    expect(runtime.root.querySelector('[data-floeterm-scrollbar]')?.getAttribute('data-visible')).toBe('true');
  });

  it('uses the screen-start capability when the transport page is shorter than the live viewport', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'wide-live', 500, 24));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    const shortFrame = (text: string, offset: number) => ({
      ...frame(text, 500, 4, offset),
      history: { revision: 1, totalRows: 64, screenStartOffset: 40 },
    });
    runtime.semanticHistory
      .mockResolvedValueOnce({
        ...historyPage(),
        anchor: 'end-anchor',
        screenStart: 'screen-anchor',
        offset: 60,
        hasPrevious: true,
        hasNext: false,
        frame: shortFrame('current-edge', 60),
      })
      .mockResolvedValueOnce({
        ...historyPage(),
        anchor: 'previous-anchor',
        screenStart: 'screen-anchor',
        offset: 36,
        hasPrevious: true,
        hasNext: true,
        frame: shortFrame('short-history-marker', 36),
      });

    const surface = runtime.root.querySelector<HTMLElement>('[data-terminal-semantic-surface="true"]')!;
    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));

    await vi.waitFor(() => expect(runtime.semanticHistory).toHaveBeenCalledTimes(2));
    expect(runtime.semanticHistory.mock.calls.map((call) => call[1].limit)).toEqual([2, 2]);
    expect(runtime.semanticHistory.mock.calls[1]?.[1]).toMatchObject({
      direction: 'backward',
      anchor: 'screen-anchor',
    });
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('short-history-marker');
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-projected')).toBe('true');
    expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);
  });

  it('searches actor-owned history and keeps touch projection view-local', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'current'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());

    const firstPage = historyPage();
    const nextPage = {
      ...historyPage(),
      anchor: 'next-history-anchor',
      offset: 24,
      hasPrevious: true,
      hasNext: false,
      frame: frame('newer-history', 80, 24, 24),
    };
    runtime.semanticHistory
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(nextPage)
      .mockResolvedValueOnce(nextPage);

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

  it('searches every server-bounded history page instead of assuming the requested page height', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'current'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());

    const boundedPage = (offset: number, text: string, hasNext: boolean): SemanticHistoryPage => {
      const semanticFrame = frame(text, 80, 1, 2);
      return {
        revision: 1,
        anchor: `page-${offset}`,
        firstAvailable: 'first',
        lastAvailable: 'last',
        screenStart: 'screen',
        offset,
        totalRows: 3,
        screenStartOffset: 2,
        hasPrevious: offset > 0,
        hasNext,
        frame: semanticFrame,
      };
    };
    runtime.semanticHistory
      .mockResolvedValueOnce(boundedPage(0, 'first-page', true))
      .mockResolvedValueOnce(boundedPage(1, 'middle-page', true))
      .mockResolvedValueOnce(boundedPage(2, 'last-page-needle', false));

    const results: Array<{ state: string; resultCount: number }> = [];
    runtime.getViewport()?.setSearchResultsCallback((result) => results.push(result));
    runtime.getViewport()?.findNext('last-page-needle');

    await vi.waitFor(() => expect(results.at(-1)).toMatchObject({ state: 'ready', resultCount: 1 }));
    expect(runtime.semanticHistory).toHaveBeenCalledTimes(3);
    expect(runtime.semanticHistory.mock.calls.map((call) => call[1].direction)).toEqual([
      'start',
      'forward',
      'forward',
    ]);
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('last-page-needle');
  });

  it('fails a non-advancing history scan locally without replacing the live presentation', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'live-before-stalled-search'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());

    const stalledPage = {
      ...historyPage(),
      offset: 0,
      hasPrevious: false,
      hasNext: true,
    };
    runtime.semanticHistory
      .mockResolvedValueOnce(stalledPage)
      .mockResolvedValueOnce({ ...stalledPage, anchor: 'replacement-anchor' });

    const results: Array<{
      state: 'idle' | 'searching' | 'ready' | 'error';
      resultCount: number;
      retryable?: boolean;
    }> = [];
    runtime.getViewport()?.setSearchResultsCallback((result) => results.push(result));
    runtime.getViewport()?.findNext('old-history-marker');

    await vi.waitFor(() => expect(results.at(-1)).toMatchObject({
      state: 'error',
      resultCount: 0,
      retryable: true,
    }));
    expect(runtime.semanticHistory).toHaveBeenCalledTimes(2);
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('live-before-stalled-search');
    expect(runtime.root.querySelector('[data-terminal-semantic-error="true"]')).toBeNull();
    expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);
  });

  it.each(['first page', 'following page'] as const)(
    'keeps a %s semantic search RPC failure local and explicitly retryable',
    async (failurePoint) => {
      const runtime = harness();
      mounted.push(runtime);
      runtime.emitPresentation(presentation(1, 'live-before-search-error'));
      await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());

      if (failurePoint === 'first page') {
        runtime.semanticHistory.mockRejectedValueOnce(new Error('RPC transport error'));
      } else {
        runtime.semanticHistory
          .mockResolvedValueOnce(historyPage())
          .mockRejectedValueOnce(new Error('RPC transport error'));
      }

      const results: Array<{
        resultIndex: number;
        resultCount: number;
        state: 'idle' | 'searching' | 'ready' | 'error';
        retryable?: boolean;
      }> = [];
      runtime.getViewport()?.setSearchResultsCallback((result) => results.push(result));
      runtime.getViewport()?.findNext('old-history-marker');

      await vi.waitFor(() => expect(results.at(-1)).toMatchObject({
        resultIndex: -1,
        resultCount: 0,
        state: 'error',
        retryable: true,
      }));
      expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);
      expect(runtime.root.querySelector('[data-terminal-semantic-error="true"]')).toBeNull();
      expect(runtime.getViewport()?.getVisibleScreenText()).toContain('live-before-search-error');

      const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;
      input.value = 'still-live';
      input.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText',
        data: 'still-live',
        bubbles: true,
      }));
      expect(runtime.sendInput).toHaveBeenCalledWith(SESSION.id, 'still-live');

      runtime.emitPresentation(presentation(2, 'live-after-search-error'));
      expect(runtime.getViewport()?.getVisibleScreenText()).toContain('live-after-search-error');
      runtime.setFontSize(15);
      await vi.waitFor(() => expect(runtime.resizeWithEffectiveGeometry).toHaveBeenCalled());
      runtime.semanticHistory.mockImplementation(async () => ({
        ...historyPage(),
        revision: 2,
        hasNext: false,
        frame: { ...historyPage().frame, history: { revision: 2, totalRows: 64, screenStartOffset: 40 } },
      }));

      runtime.getViewport()?.findNext('old-history-marker');
      await vi.waitFor(() => expect(results.at(-1)).toMatchObject({
        state: 'ready',
        retryable: false,
      }));
      expect(results.at(-1)?.resultCount).toBeGreaterThan(0);
      expect(runtime.getViewport()?.getVisibleScreenText()).toContain('old-history-marker');
    },
  );

  it('keeps an active history search valid while live output advances', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'live-before-late-search'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    let resolvePage!: (page: SemanticHistoryPage) => void;
    runtime.semanticHistory.mockReturnValueOnce(new Promise<SemanticHistoryPage>((resolve) => {
      resolvePage = resolve;
    }));
    const results: Array<{
      state: 'idle' | 'searching' | 'ready' | 'error';
      resultCount: number;
    }> = [];
    runtime.getViewport()?.setSearchResultsCallback((result) => results.push(result));
    runtime.getViewport()?.findNext('old-history-marker');
    await vi.waitFor(() => expect(results.at(-1)?.state).toBe('searching'));
    runtime.emitPresentation(presentation(2, 'newer-live-search-frame'));
    resolvePage({ ...historyPage(), hasNext: false });

    await vi.waitFor(() => expect(results.at(-1)).toMatchObject({ state: 'ready', resultCount: 1 }));
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('old-history-marker');
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-projected')).toBe('true');
    expect(runtime.root.querySelector('[data-terminal-semantic-error="true"]')).toBeNull();
    expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);
  });

  it('discards a late search response after canonical geometry changes', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'live-before-search-resize'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    let resolvePage!: (page: SemanticHistoryPage) => void;
    runtime.semanticHistory.mockReturnValueOnce(new Promise<SemanticHistoryPage>((resolve) => {
      resolvePage = resolve;
    }));
    const results: Array<{
      state: 'idle' | 'searching' | 'ready' | 'error';
      resultCount: number;
    }> = [];
    runtime.getViewport()?.setSearchResultsCallback((result) => results.push(result));
    runtime.getViewport()?.findNext('old-history-marker');
    await vi.waitFor(() => expect(results.at(-1)?.state).toBe('searching'));

    runtime.emitPresentation(presentation(2, 'resized-live-frame', 100, 24));
    expect(results.at(-1)).toMatchObject({ state: 'idle', resultCount: 0 });
    resolvePage({ ...historyPage(), hasNext: false });
    await Promise.resolve();

    expect(results.at(-1)).toMatchObject({ state: 'idle', resultCount: 0 });
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('resized-live-frame');
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-projected')).toBe('false');
    expect(runtime.root.querySelector('[data-terminal-semantic-error="true"]')).toBeNull();
  });

  it('keeps a semantic history scroll RPC failure local and retries from the live frame', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'live-before-history-error'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    runtime.semanticHistory.mockRejectedValueOnce(new Error('RPC transport error'));

    const surface = runtime.root.querySelector<HTMLElement>('[data-terminal-semantic-surface="true"]')!;
    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));

    await vi.waitFor(() => {
      expect(runtime.root.querySelector('[data-terminal-semantic-history-error="true"]')).not.toBeNull();
    });
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-busy')).toBe('false');
    expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);
    expect(runtime.root.querySelector('[data-terminal-semantic-error="true"]')).toBeNull();
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('live-before-history-error');

    runtime.emitPresentation(presentation(2, 'live-after-history-error'));
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('live-after-history-error');
    runtime.semanticHistory
      .mockResolvedValueOnce({
        ...historyPage(),
        revision: 2,
        offset: 40,
        hasPrevious: true,
        hasNext: false,
        frame: { ...frame('current-history-edge', 80, 24, 40), history: { revision: 2, totalRows: 64, screenStartOffset: 40 } },
      })
      .mockResolvedValueOnce({
        ...historyPage(),
        revision: 2,
        frame: { ...historyPage().frame, history: { revision: 2, totalRows: 64, screenStartOffset: 40 } },
      });

    runtime.root.querySelector<HTMLButtonElement>('[data-terminal-semantic-history-retry]')?.click();
    await vi.waitFor(() => expect(runtime.semanticHistory).toHaveBeenCalledTimes(3));
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('old-history-marker');
    expect(runtime.root.querySelector('[data-terminal-semantic-history-error="true"]')).toBeNull();
  });

  it('keeps a verified live frame when a later history page fails and retries from a stable boundary', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'live-before-paged-error'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    runtime.semanticHistory
      .mockResolvedValueOnce({
        ...historyPage(),
        offset: 40,
        hasPrevious: true,
        hasNext: false,
        frame: frame('current-history-edge', 80, 24, 40),
      })
      .mockRejectedValueOnce(new Error('RPC transport error'));

    const surface = runtime.root.querySelector<HTMLElement>('[data-terminal-semantic-surface="true"]')!;
    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));

    await vi.waitFor(() => expect(runtime.root.querySelector('[data-terminal-semantic-history-error="true"]')).not.toBeNull());
    expect(runtime.semanticHistory).toHaveBeenCalledTimes(2);
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-busy')).toBe('false');
    expect(runtime.root.querySelector('[data-terminal-semantic-history-error="true"]')?.getAttribute('data-terminal-semantic-history-error-detail')).toContain('RPC transport error');
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('live-before-paged-error');
    expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);

    runtime.root.querySelector<HTMLButtonElement>('[data-terminal-semantic-history-retry]')?.click();
    await vi.waitFor(() => expect(runtime.semanticHistory).toHaveBeenCalledTimes(4));
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('old-history-marker');
  });

  it('coalesces continuous wheel input to the latest direction without leaving history busy', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'live-before-trackpad-burst'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    let resolveEnd!: (page: SemanticHistoryPage) => void;
    let resolveBackward!: (page: SemanticHistoryPage) => void;
    runtime.semanticHistory
      .mockReturnValueOnce(new Promise<SemanticHistoryPage>((resolve) => { resolveEnd = resolve; }))
      .mockReturnValueOnce(new Promise<SemanticHistoryPage>((resolve) => { resolveBackward = resolve; }))
      .mockResolvedValueOnce({
        ...historyPage(),
        offset: 40,
        hasPrevious: true,
        hasNext: false,
        frame: frame('current-history-edge', 80, 24, 40),
      });

    const surface = runtime.root.querySelector<HTMLElement>('[data-terminal-semantic-surface="true"]')!;
    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
    await vi.waitFor(() => expect(runtime.semanticHistory).toHaveBeenCalledTimes(1));
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-busy')).toBe('true');

    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -80 }));
    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 160 }));
    resolveEnd({
      ...historyPage(),
      offset: 40,
      hasPrevious: true,
      hasNext: false,
      frame: frame('current-history-edge', 80, 24, 40),
    });
    await vi.waitFor(() => expect(runtime.semanticHistory).toHaveBeenCalledTimes(2));
    resolveBackward({
      ...historyPage(),
      offset: 16,
      hasPrevious: true,
      hasNext: true,
      frame: frame('older-trackpad-page', 80, 24, 16),
    });

    await vi.waitFor(() => expect(runtime.semanticHistory).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-busy')).toBe('false'));
    expect(runtime.semanticHistory.mock.calls.map((call) => call[1].direction)).toEqual([
      'end',
      'backward',
      'forward',
    ]);
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-request-direction')).toBe('forward');
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-request-state')).toBe('settled');
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-projected')).toBe('false');
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('live-before-trackpad-burst');
    expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);
  });

  it('keeps an active history browse valid while live output advances', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'live-before-late-page'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    let resolvePage!: (page: SemanticHistoryPage) => void;
    runtime.semanticHistory
      .mockResolvedValueOnce({
        ...historyPage(),
        offset: 40,
        hasPrevious: true,
        hasNext: false,
        frame: frame('current-history-edge', 80, 24, 40),
      })
      .mockReturnValueOnce(new Promise<SemanticHistoryPage>((resolve) => {
        resolvePage = resolve;
      }));

    const surface = runtime.root.querySelector<HTMLElement>('[data-terminal-semantic-surface="true"]')!;
    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
    await vi.waitFor(() => expect(runtime.semanticHistory).toHaveBeenCalledTimes(2));
    runtime.emitPresentation(presentation(2, 'newer-live-frame'));
    resolvePage(historyPage());

    await vi.waitFor(() => expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-busy')).toBe('false'));
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-projected')).toBe('true');
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('old-history-marker');
    expect(runtime.root.querySelector('[data-terminal-semantic-history-error="true"]')).toBeNull();
    expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);
  });

  it('discards a late history response after canonical geometry changes', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.emitPresentation(presentation(1, 'live-before-late-page'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    let resolvePage!: (page: SemanticHistoryPage) => void;
    runtime.semanticHistory
      .mockResolvedValueOnce({
        ...historyPage(),
        offset: 40,
        hasPrevious: true,
        hasNext: false,
        frame: frame('current-history-edge', 80, 24, 40),
      })
      .mockReturnValueOnce(new Promise<SemanticHistoryPage>((resolve) => {
        resolvePage = resolve;
      }));

    const surface = runtime.root.querySelector<HTMLElement>('[data-terminal-semantic-surface="true"]')!;
    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
    await vi.waitFor(() => expect(runtime.semanticHistory).toHaveBeenCalledTimes(2));
    runtime.emitPresentation(presentation(2, 'resized-live-frame', 81, 24));
    resolvePage(historyPage());

    await vi.waitFor(() => expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-busy')).toBe('false'));
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-projected')).toBe('false');
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-request-state')).toBe('idle');
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-request-revision')).toBe('');
    expect(runtime.root.querySelector('[data-terminal-runtime-session]')?.getAttribute('data-terminal-history-request-offset')).toBe('0');
    expect(runtime.getViewport()?.getVisibleScreenText()).toContain('resized-live-frame');
    expect(runtime.root.querySelector('[data-terminal-semantic-history-error="true"]')).toBeNull();
    expect(runtime.statuses.some((status) => status.state === 'blocking')).toBe(false);
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

  it('anchors IME input in the semantic canvas coordinate space under viewport scaling', async () => {
    const runtime = harness();
    mounted.push(runtime);
    runtime.root.style.transform = 'translate(37px, 29px) scale(0.45)';
    runtime.root.style.transformOrigin = 'top left';
    runtime.emitPresentation(presentation(1, 'cursor'));
    await vi.waitFor(() => expect(runtime.getViewport()).not.toBeNull());
    runtime.getViewport()?.forceResize();
    await waitForPaint();

    const canvas = runtime.root.querySelector<HTMLCanvasElement>('[data-terminal-semantic-canvas="true"]')!;
    const input = runtime.root.querySelector<HTMLTextAreaElement>('[data-terminal-input-bridge="semantic"]')!;
    const canvasBounds = canvas.getBoundingClientRect();
    const inputBounds = input.getBoundingClientRect();
    const scaleX = canvasBounds.width / canvas.clientWidth;
    const scaleY = canvasBounds.height / canvas.clientHeight;
    const cellWidth = Number(canvas.dataset.terminalCellWidth);
    const cellHeight = Number(canvas.dataset.terminalCellHeight);
    const cursor = runtime.getViewport()?.getPresentation()?.frame.cursor;

    expect(inputBounds.width).toBeCloseTo(cellWidth * scaleX, 1);
    expect(inputBounds.height).toBeCloseTo(cellHeight * scaleY, 1);
    expect(inputBounds.left).toBeCloseTo(canvasBounds.left + (cursor?.x ?? 0) * cellWidth * scaleX, 1);
    expect(inputBounds.top).toBeCloseTo(canvasBounds.top + (cursor?.y ?? 0) * cellHeight * scaleY, 1);
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
