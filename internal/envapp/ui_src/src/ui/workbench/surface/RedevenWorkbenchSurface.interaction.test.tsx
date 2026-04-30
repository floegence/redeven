// @vitest-environment jsdom

import { createEffect, createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkbenchFilterState, type WorkbenchState, type WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import {
  CANVAS_WHEEL_INTERACTIVE_ATTR,
  WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR,
} from '@floegence/floe-webapp-core/ui';

import { RedevenWorkbenchSurface } from './RedevenWorkbenchSurface';
import { REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR } from './workbenchInputRouting';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from './workbenchWheelInteractive';
import {
  REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR,
  REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS,
} from './workbenchTextSelectionSurface';

vi.mock('solid-motionone', () => ({
  Motion: new Proxy(
    {},
    {
      get: () => ({ children }: { children?: unknown }) => children ?? null,
    },
  ),
}));

const widgetDefinitions: readonly WorkbenchWidgetDefinition[] = [
  {
    type: 'redeven.input-panel',
    label: 'Input Panel',
    icon: () => null,
    body: () => (
      <div data-testid="widget-body">
        <input aria-label="Redeven widget input" data-testid="widget-input" />
      </div>
    ),
    defaultTitle: 'Input Panel',
    defaultSize: { width: 320, height: 220 },
  },
];

function createWorkbenchState(): WorkbenchState {
  return {
    version: 1,
    widgets: [
      {
        id: 'widget-input-1',
        type: 'redeven.input-panel',
        title: 'Input Panel',
        x: 80,
        y: 64,
        width: 320,
        height: 220,
        z_index: 1,
        created_at_unix_ms: 1,
      },
    ],
    viewport: { x: 120, y: 72, scale: 1 },
    locked: false,
    filters: createWorkbenchFilterState(widgetDefinitions),
    selectedWidgetId: null,
    theme: 'default',
  };
}

function createTerminalWorkbenchState(
  definitions: readonly WorkbenchWidgetDefinition[],
  selectedWidgetId: string | null = 'widget-terminal-1',
): WorkbenchState {
  return {
    version: 1,
    widgets: [
      {
        id: 'widget-terminal-1',
        type: 'redeven.terminal-panel',
        title: 'Terminal',
        x: 80,
        y: 64,
        width: 420,
        height: 280,
        z_index: 1,
        created_at_unix_ms: 1,
      },
    ],
    viewport: { x: 120, y: 72, scale: 1 },
    locked: false,
    filters: createWorkbenchFilterState(definitions),
    selectedWidgetId,
    theme: 'default',
  };
}

function dispatchPointerEvent(
  type: string,
  target: EventTarget,
  options: {
    button?: number;
    pointerId?: number;
    clientX?: number;
    clientY?: number;
  } = {},
): Event {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor(type, {
    bubbles: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 24,
    clientY: options.clientY ?? 24,
  });

  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', {
      configurable: true,
      value: options.pointerId ?? 1,
    });
  }

  target.dispatchEvent(event);
  return event;
}

function dispatchWheel(target: EventTarget, deltaY: number): WheelEvent {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: 320,
    clientY: 240,
    deltaY,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchPrimaryClickSequence(
  target: EventTarget,
  options: {
    pointerId?: number;
    clientX?: number;
    clientY?: number;
  } = {},
): Event {
  const pointerDown = dispatchPointerEvent('pointerdown', target, options);
  dispatchPointerEvent('pointerup', target, options);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return pointerDown;
}

function mockCanvasRect(canvas: HTMLElement): void {
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: 960,
      bottom: 640,
      width: 960,
      height: 640,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }),
  });

  Object.defineProperty(canvas, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(canvas, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn(() => false),
  });
  Object.defineProperty(canvas, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
}

function mockElementRect(
  element: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
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
}

function appendPanSurfaceTarget(canvas: HTMLElement): HTMLElement {
  const target = document.createElement('div');
  target.setAttribute('data-floe-canvas-pan-surface', 'true');
  canvas.appendChild(target);
  return target;
}

async function flushWorkbenchInteraction(): Promise<void> {
  await Promise.resolve();
  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  await Promise.resolve();
}

async function flushWorkbenchWheelCommit(): Promise<void> {
  await flushWorkbenchInteraction();
  await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 120));
  await flushWorkbenchInteraction();
}

describe('RedevenWorkbenchSurface interaction contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('hands authority back to the canvas on blank-background clicks', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    let readState: () => WorkbenchState = createWorkbenchState;

    render(() => {
      const [state, setState] = createSignal(createWorkbenchState());
      readState = state;

      return (
        <RedevenWorkbenchSurface
          state={state}
          setState={setState}
          widgetDefinitions={widgetDefinitions}
          filterBarWidgetTypes={[]}
          enableKeyboard={false}
        />
      );
    }, host);

    await flushWorkbenchInteraction();

    const surfaceRoot = host.querySelector('.workbench-surface') as HTMLDivElement | null;
    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const widgetRoot = host.querySelector(
      '[data-redeven-workbench-widget-id="widget-input-1"]',
    ) as HTMLElement | null;
    const widgetBody = host.querySelector('[data-testid="widget-body"]') as HTMLElement | null;
    const widgetInput = host.querySelector('[data-testid="widget-input"]') as HTMLInputElement | null;

    expect(surfaceRoot).toBeTruthy();
    expect(canvas).toBeTruthy();
    expect(widgetRoot).toBeTruthy();
    expect(widgetBody).toBeTruthy();
    expect(widgetInput).toBeTruthy();

    mockCanvasRect(canvas!);

    widgetInput!.focus();
    dispatchPointerEvent('pointerdown', widgetBody!, { pointerId: 1 });
    await flushWorkbenchInteraction();

    expect(readState().selectedWidgetId).toBe('widget-input-1');
    expect(widgetRoot?.getAttribute(CANVAS_WHEEL_INTERACTIVE_ATTR)).toBe('true');
    expect(document.activeElement).toBe(widgetInput);

    const selectedScale = readState().viewport.scale;
    const wheelWhileSelected = dispatchWheel(widgetBody!, -120);
    expect(wheelWhileSelected.defaultPrevented).toBe(false);
    await flushWorkbenchWheelCommit();
    expect(readState().viewport.scale).toBe(selectedScale);

    dispatchPointerEvent('pointerdown', canvas!, { pointerId: 2 });
    dispatchPointerEvent('pointerup', canvas!, { pointerId: 2 });
    await flushWorkbenchInteraction();

    expect(readState().selectedWidgetId).toBeNull();
    expect(widgetRoot?.getAttribute(CANVAS_WHEEL_INTERACTIVE_ATTR)).toBeNull();
    expect(document.activeElement).toBe(surfaceRoot);

    const canvasScale = readState().viewport.scale;
    const wheelAfterCanvasHandoff = dispatchWheel(widgetBody!, -120);
    expect(wheelAfterCanvasHandoff.defaultPrevented).toBe(true);
    await flushWorkbenchWheelCommit();
    expect(readState().viewport.scale).toBeGreaterThan(canvasScale);
  });

  it('keeps viewport interaction active until a blank-canvas pan pointer is released', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onViewportInteractionStart = vi.fn();
    const onViewportInteractionEnd = vi.fn();
    const onViewportInteractionPulse = vi.fn();

    render(() => {
      const [state, setState] = createSignal(createWorkbenchState());

      return (
        <RedevenWorkbenchSurface
          state={state}
          setState={setState}
          widgetDefinitions={widgetDefinitions}
          filterBarWidgetTypes={[]}
          enableKeyboard={false}
          onViewportInteractionStart={onViewportInteractionStart}
          onViewportInteractionEnd={onViewportInteractionEnd}
          onViewportInteractionPulse={onViewportInteractionPulse}
        />
      );
    }, host);

    await flushWorkbenchInteraction();

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const widgetBody = host.querySelector('[data-testid="widget-body"]') as HTMLElement | null;

    expect(canvas).toBeTruthy();
    expect(widgetBody).toBeTruthy();

    mockCanvasRect(canvas!);
    const panSurface = appendPanSurfaceTarget(canvas!);
    expect(panSurface.matches(REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR)).toBe(true);

    dispatchPointerEvent('pointerdown', panSurface!, {
      pointerId: 71,
      clientX: 100,
      clientY: 100,
    });
    await flushWorkbenchInteraction();

    expect(onViewportInteractionStart).toHaveBeenCalledTimes(1);
    expect(onViewportInteractionEnd).not.toHaveBeenCalled();
    expect(onViewportInteractionPulse).toHaveBeenCalledTimes(1);

    dispatchPointerEvent('pointermove', window, {
      pointerId: 71,
      clientX: 102,
      clientY: 101,
    });
    await flushWorkbenchInteraction();

    expect(onViewportInteractionEnd).not.toHaveBeenCalled();
    expect(onViewportInteractionPulse).toHaveBeenCalledTimes(1);

    dispatchPointerEvent('pointermove', window, {
      pointerId: 71,
      clientX: 106,
      clientY: 101,
    });
    await flushWorkbenchInteraction();

    expect(onViewportInteractionEnd).not.toHaveBeenCalled();
    expect(onViewportInteractionPulse).toHaveBeenCalledTimes(2);

    dispatchPointerEvent('pointerup', window, {
      pointerId: 71,
      clientX: 106,
      clientY: 101,
    });
    await flushWorkbenchInteraction();

    expect(onViewportInteractionEnd).toHaveBeenCalledTimes(1);

    dispatchPointerEvent('pointerdown', widgetBody!, {
      pointerId: 72,
      clientX: 140,
      clientY: 140,
    });
    dispatchPointerEvent('pointermove', window, {
      pointerId: 72,
      clientX: 180,
      clientY: 180,
    });
    await flushWorkbenchInteraction();

    expect(onViewportInteractionStart).toHaveBeenCalledTimes(1);
    expect(onViewportInteractionEnd).toHaveBeenCalledTimes(1);
    expect(onViewportInteractionPulse).toHaveBeenCalledTimes(2);
  });

  it('settles viewport interaction after blank-canvas wheel zoom gestures go quiet', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onViewportInteractionStart = vi.fn();
    const onViewportInteractionEnd = vi.fn();
    const onViewportInteractionPulse = vi.fn();

    render(() => {
      const [state, setState] = createSignal(createWorkbenchState());

      return (
        <RedevenWorkbenchSurface
          state={state}
          setState={setState}
          widgetDefinitions={widgetDefinitions}
          filterBarWidgetTypes={[]}
          enableKeyboard={false}
          onViewportInteractionStart={onViewportInteractionStart}
          onViewportInteractionEnd={onViewportInteractionEnd}
          onViewportInteractionPulse={onViewportInteractionPulse}
        />
      );
    }, host);

    await flushWorkbenchInteraction();

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;

    expect(canvas).toBeTruthy();

    mockCanvasRect(canvas!);
    const panSurface = appendPanSurfaceTarget(canvas!);
    expect(panSurface.matches(REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR)).toBe(true);

    dispatchWheel(panSurface!, -120);
    await flushWorkbenchInteraction();

    expect(onViewportInteractionStart).toHaveBeenCalledTimes(1);
    expect(onViewportInteractionEnd).not.toHaveBeenCalled();
    expect(onViewportInteractionPulse).toHaveBeenCalledTimes(1);

    await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 220));
    await flushWorkbenchInteraction();

    expect(onViewportInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it('freezes terminal visuals from the pan-surface pointerdown until release', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mockContext = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => mockContext as unknown as CanvasRenderingContext2D);

    const terminalDefinitions: readonly WorkbenchWidgetDefinition[] = [
      {
        type: 'redeven.terminal-panel',
        label: 'Terminal',
        icon: () => null,
        body: () => (
          <div class="redeven-terminal-surface" data-testid="terminal-surface">
            <canvas data-testid="terminal-canvas" />
          </div>
        ),
        defaultTitle: 'Terminal',
        defaultSize: { width: 420, height: 280 },
      },
    ];

    render(() => {
      const [state, setState] = createSignal(createTerminalWorkbenchState(terminalDefinitions));

      return (
        <RedevenWorkbenchSurface
          state={state}
          setState={setState}
          widgetDefinitions={terminalDefinitions}
          filterBarWidgetTypes={[]}
          enableKeyboard={false}
        />
      );
    }, host);

    await flushWorkbenchInteraction();

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const terminalSurface = host.querySelector('[data-testid="terminal-surface"]') as HTMLElement | null;
    const terminalCanvas = host.querySelector('[data-testid="terminal-canvas"]') as HTMLCanvasElement | null;

    expect(canvas).toBeTruthy();
    expect(terminalSurface).toBeTruthy();
    expect(terminalCanvas).toBeTruthy();

    mockCanvasRect(canvas!);
    const panSurface = appendPanSurfaceTarget(canvas!);
    expect(panSurface.matches(REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR)).toBe(true);
    mockElementRect(terminalSurface!, { left: 80, top: 80, width: 320, height: 160 });
    mockElementRect(terminalCanvas!, { left: 88, top: 92, width: 300, height: 130 });
    terminalCanvas!.width = 600;
    terminalCanvas!.height = 260;

    dispatchPointerEvent('pointerdown', panSurface!, {
      pointerId: 73,
      clientX: 120,
      clientY: 120,
    });
    await flushWorkbenchInteraction();

    const snapshot = terminalSurface!.querySelector('.redeven-terminal-freeze-snapshot') as HTMLCanvasElement | null;
    expect(terminalSurface!.getAttribute('data-redeven-terminal-freeze')).toBe('true');
    expect(snapshot).toBeTruthy();
    expect(snapshot!.style.width).toBe('320px');
    expect(snapshot!.style.height).toBe('160px');
    expect(mockContext.drawImage).toHaveBeenCalledWith(
      terminalCanvas,
      0,
      0,
      600,
      260,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );

    dispatchPointerEvent('pointermove', window, {
      pointerId: 73,
      clientX: 180,
      clientY: 120,
    });
    await flushWorkbenchInteraction();

    expect(terminalSurface!.getAttribute('data-redeven-terminal-freeze')).toBe('true');
    expect(terminalSurface!.querySelector('.redeven-terminal-freeze-snapshot')).toBeTruthy();

    dispatchPointerEvent('pointerup', window, {
      pointerId: 73,
      clientX: 180,
      clientY: 120,
    });
    await flushWorkbenchInteraction();
    await flushWorkbenchInteraction();

    expect(terminalSurface!.getAttribute('data-redeven-terminal-freeze')).toBeNull();
    expect(terminalSurface!.querySelector('.redeven-terminal-freeze-snapshot')).toBeNull();

    getContextSpy.mockRestore();
  });

  it('freezes terminal visuals while shared widget viewport controls settle', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mockContext = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => mockContext as unknown as CanvasRenderingContext2D);

    const terminalDefinitions: readonly WorkbenchWidgetDefinition[] = [
      {
        type: 'redeven.terminal-panel',
        label: 'Terminal',
        icon: () => null,
        body: () => (
          <div class="redeven-terminal-surface" data-testid="terminal-surface">
            <canvas data-testid="terminal-canvas" />
          </div>
        ),
        defaultTitle: 'Terminal',
        defaultSize: { width: 420, height: 280 },
      },
    ];

    render(() => {
      const [state, setState] = createSignal(createTerminalWorkbenchState(terminalDefinitions));

      return (
        <RedevenWorkbenchSurface
          state={state}
          setState={setState}
          widgetDefinitions={terminalDefinitions}
          filterBarWidgetTypes={[]}
          enableKeyboard={false}
        />
      );
    }, host);

    await flushWorkbenchInteraction();

    const terminalSurface = host.querySelector('[data-testid="terminal-surface"]') as HTMLElement | null;
    const terminalCanvas = host.querySelector('[data-testid="terminal-canvas"]') as HTMLCanvasElement | null;
    const fitButton = host.querySelector('button[aria-label="Zoom widget to fit viewport"]') as HTMLButtonElement | null;

    expect(terminalSurface).toBeTruthy();
    expect(terminalCanvas).toBeTruthy();
    expect(fitButton).toBeTruthy();

    mockElementRect(terminalSurface!, { left: 80, top: 80, width: 320, height: 160 });
    mockElementRect(terminalCanvas!, { left: 88, top: 92, width: 300, height: 130 });
    terminalCanvas!.width = 600;
    terminalCanvas!.height = 260;

    fitButton!.click();
    await flushWorkbenchInteraction();

    expect(terminalSurface!.getAttribute('data-redeven-terminal-freeze')).toBe('true');
    expect(terminalSurface!.querySelector('.redeven-terminal-freeze-snapshot')).toBeTruthy();
    expect(mockContext.drawImage).toHaveBeenCalled();

    await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 320));
    await flushWorkbenchInteraction();
    await flushWorkbenchInteraction();

    expect(terminalSurface!.getAttribute('data-redeven-terminal-freeze')).toBeNull();
    expect(terminalSurface!.querySelector('.redeven-terminal-freeze-snapshot')).toBeNull();

    getContextSpy.mockRestore();
  });

  it('forwards unselected terminal wheel gestures before terminal capture handlers consume them', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const terminalWheelCapture = vi.fn((event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const terminalDefinitions: readonly WorkbenchWidgetDefinition[] = [
      {
        type: 'redeven.terminal-panel',
        label: 'Terminal',
        icon: () => null,
        body: () => {
          let terminalRef: HTMLDivElement | undefined;

          createEffect(() => {
            const terminal = terminalRef;
            if (!terminal) return;

            terminal.addEventListener('wheel', terminalWheelCapture, {
              capture: true,
              passive: false,
            });
            onCleanup(() => {
              terminal.removeEventListener('wheel', terminalWheelCapture, true);
            });
          });

          return (
            <div
              ref={terminalRef}
              {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
              class="redeven-terminal-surface"
              data-testid="terminal-surface"
            >
              <textarea aria-label="Terminal input" data-testid="terminal-input" />
            </div>
          );
        },
        defaultTitle: 'Terminal',
        defaultSize: { width: 420, height: 280 },
      },
    ];
    const [state, setState] = createSignal(createTerminalWorkbenchState(terminalDefinitions, null));

    render(() => (
      <RedevenWorkbenchSurface
        state={state}
        setState={setState}
        widgetDefinitions={terminalDefinitions}
        filterBarWidgetTypes={[]}
        enableKeyboard={false}
      />
    ), host);

    await flushWorkbenchInteraction();

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const terminalSurface = host.querySelector('[data-testid="terminal-surface"]') as HTMLElement | null;

    expect(canvas).toBeTruthy();
    expect(terminalSurface).toBeTruthy();

    mockCanvasRect(canvas!);

    const wheel = dispatchWheel(terminalSurface!, -120);

    expect(wheel.defaultPrevented).toBe(true);
    expect(terminalWheelCapture).not.toHaveBeenCalled();

    await flushWorkbenchWheelCommit();

    expect(state().viewport.scale).toBeGreaterThan(1);
  });

  it('suppresses selected terminal wheel gestures while focus is outside the terminal', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const terminalWheelCapture = vi.fn((event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const terminalDefinitions: readonly WorkbenchWidgetDefinition[] = [
      {
        type: 'redeven.terminal-panel',
        label: 'Terminal',
        icon: () => null,
        body: () => {
          let terminalRef: HTMLDivElement | undefined;

          createEffect(() => {
            const terminal = terminalRef;
            if (!terminal) return;

            terminal.addEventListener('wheel', terminalWheelCapture, {
              capture: true,
              passive: false,
            });
            onCleanup(() => {
              terminal.removeEventListener('wheel', terminalWheelCapture, true);
            });
          });

          return (
            <div
              ref={terminalRef}
              {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
              class="redeven-terminal-surface"
              data-testid="terminal-surface"
            >
              <textarea aria-label="Terminal input" data-testid="terminal-input" />
            </div>
          );
        },
        defaultTitle: 'Terminal',
        defaultSize: { width: 420, height: 280 },
      },
    ];
    const [state, setState] = createSignal(createTerminalWorkbenchState(terminalDefinitions));

    render(() => (
      <RedevenWorkbenchSurface
        state={state}
        setState={setState}
        widgetDefinitions={terminalDefinitions}
        filterBarWidgetTypes={[]}
        enableKeyboard={false}
      />
    ), host);

    await flushWorkbenchInteraction();

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const terminalSurface = host.querySelector('[data-testid="terminal-surface"]') as HTMLElement | null;

    expect(canvas).toBeTruthy();
    expect(terminalSurface).toBeTruthy();

    mockCanvasRect(canvas!);

    const wheel = dispatchWheel(terminalSurface!, -120);

    expect(wheel.defaultPrevented).toBe(true);
    expect(terminalWheelCapture).not.toHaveBeenCalled();

    await flushWorkbenchWheelCommit();

    expect(state().viewport.scale).toBe(1);
  });

  it('leaves terminal wheel gestures local while focus is inside the selected terminal', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const terminalWheelCapture = vi.fn((event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const terminalDefinitions: readonly WorkbenchWidgetDefinition[] = [
      {
        type: 'redeven.terminal-panel',
        label: 'Terminal',
        icon: () => null,
        body: () => {
          let terminalRef: HTMLDivElement | undefined;

          createEffect(() => {
            const terminal = terminalRef;
            if (!terminal) return;

            terminal.addEventListener('wheel', terminalWheelCapture, {
              capture: true,
              passive: false,
            });
            onCleanup(() => {
              terminal.removeEventListener('wheel', terminalWheelCapture, true);
            });
          });

          return (
            <div
              ref={terminalRef}
              {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
              class="redeven-terminal-surface"
              data-testid="terminal-surface"
            >
              <textarea aria-label="Terminal input" data-testid="terminal-input" />
            </div>
          );
        },
        defaultTitle: 'Terminal',
        defaultSize: { width: 420, height: 280 },
      },
    ];
    const [state, setState] = createSignal(createTerminalWorkbenchState(terminalDefinitions));

    render(() => (
      <RedevenWorkbenchSurface
        state={state}
        setState={setState}
        widgetDefinitions={terminalDefinitions}
        filterBarWidgetTypes={[]}
        enableKeyboard={false}
      />
    ), host);

    await flushWorkbenchInteraction();

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const terminalSurface = host.querySelector('[data-testid="terminal-surface"]') as HTMLElement | null;
    const terminalInput = host.querySelector('[data-testid="terminal-input"]') as HTMLTextAreaElement | null;

    expect(canvas).toBeTruthy();
    expect(terminalSurface).toBeTruthy();
    expect(terminalInput).toBeTruthy();

    mockCanvasRect(canvas!);
    terminalInput!.focus();

    const wheel = dispatchWheel(terminalSurface!, -120);

    expect(wheel.defaultPrevented).toBe(true);
    expect(terminalWheelCapture).toHaveBeenCalledTimes(1);

    await flushWorkbenchWheelCommit();

    expect(state().viewport.scale).toBe(1);
  });

  it('selects a widget and preserves the original target click in the same interaction', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const clicks: boolean[] = [];
    const buttonDefinitions: readonly WorkbenchWidgetDefinition[] = [
      {
        type: 'redeven.button-panel',
        label: 'Button Panel',
        icon: () => null,
        body: (props) => (
          <button
            type="button"
            data-testid="widget-body-button"
            onClick={() => clicks.push(Boolean(props.selected))}
          >
            Open
          </button>
        ),
        defaultTitle: 'Button Panel',
        defaultSize: { width: 320, height: 220 },
      },
    ];
    const [state, setState] = createSignal<WorkbenchState>({
      version: 1,
      widgets: [
        {
          id: 'widget-button-1',
          type: 'redeven.button-panel',
          title: 'Button Panel',
          x: 80,
          y: 64,
          width: 320,
          height: 220,
          z_index: 1,
          created_at_unix_ms: 1,
        },
      ],
      viewport: { x: 120, y: 72, scale: 1 },
      locked: false,
      filters: createWorkbenchFilterState(buttonDefinitions),
      selectedWidgetId: null,
      theme: 'default',
    });

    render(() => (
      <RedevenWorkbenchSurface
        state={state}
        setState={setState}
        widgetDefinitions={buttonDefinitions}
        filterBarWidgetTypes={[]}
        enableKeyboard={false}
      />
    ), host);

    await flushWorkbenchInteraction();

    const bodyButton = host.querySelector('[data-testid="widget-body-button"]') as HTMLButtonElement | null;
    expect(bodyButton).toBeTruthy();

    const pointerDown = dispatchPrimaryClickSequence(bodyButton!, { pointerId: 3 });
    await flushWorkbenchInteraction();

    expect(pointerDown.defaultPrevented).toBe(false);
    expect(state().selectedWidgetId).toBe('widget-button-1');
    expect(clicks).toEqual([true]);
  });

  it('keeps selected text-selection surfaces from emitting widget-body activation while leaving explicit activation surfaces intact', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const activationDefinitions: readonly WorkbenchWidgetDefinition[] = [
      {
        type: 'redeven.text-panel',
        label: 'Text Panel',
        icon: () => null,
        body: (props) => (
          <div data-testid="activation-widget-body">
            <div data-testid="activation-seq">{String(props.activation?.seq ?? 0)}</div>
            <div
              {...REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS}
              data-testid="text-selection-surface"
            >
              Selectable output
            </div>
            <div
              {...{ [WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR]: 'true' }}
              data-testid="explicit-activation-surface"
            >
              Explicit activation
            </div>
          </div>
        ),
        defaultTitle: 'Text Panel',
        defaultSize: { width: 320, height: 220 },
      },
    ];
    const [state, setState] = createSignal<WorkbenchState>({
      version: 1,
      widgets: [
        {
          id: 'widget-text-1',
          type: 'redeven.text-panel',
          title: 'Text Panel',
          x: 80,
          y: 64,
          width: 320,
          height: 220,
          z_index: 1,
          created_at_unix_ms: 1,
        },
      ],
      viewport: { x: 120, y: 72, scale: 1 },
      locked: false,
      filters: createWorkbenchFilterState(activationDefinitions),
      selectedWidgetId: 'widget-text-1',
      theme: 'default',
    });

    render(() => (
      <RedevenWorkbenchSurface
        state={state}
        setState={setState}
        widgetDefinitions={activationDefinitions}
        filterBarWidgetTypes={[]}
        enableKeyboard={false}
      />
    ), host);

    await flushWorkbenchInteraction();

    const textSelectionSurface = host.querySelector('[data-testid="text-selection-surface"]') as HTMLElement | null;
    const explicitActivationSurface = host.querySelector('[data-testid="explicit-activation-surface"]') as HTMLElement | null;
    const activationSeq = () => host.querySelector('[data-testid="activation-seq"]')?.textContent ?? '';

    expect(textSelectionSurface).toBeTruthy();
    expect(explicitActivationSurface).toBeTruthy();
    expect(activationSeq()).toBe('0');

    dispatchPrimaryClickSequence(textSelectionSurface!);
    await flushWorkbenchInteraction();
    expect(activationSeq()).toBe('0');

    dispatchPrimaryClickSequence(explicitActivationSurface!);
    await flushWorkbenchInteraction();
    expect(activationSeq()).toBe('1');
  });

  it('projects native widget text into the text-selection contract before widget activation runs', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element);
      Object.defineProperty(style, 'userSelect', {
        configurable: true,
        value: 'none',
      });
      return style;
    });

    const activationDefinitions: readonly WorkbenchWidgetDefinition[] = [
      {
        type: 'redeven.native-text-panel',
        label: 'Native Text Panel',
        icon: () => null,
        body: (props) => (
          <div data-testid="native-text-widget-body">
            <div data-testid="activation-seq">{String(props.activation?.seq ?? 0)}</div>
            <div data-testid="native-text-block">
              <span data-testid="native-text-target">Top Processes</span>
            </div>
            <button type="button" data-testid="native-text-button">
              Fetch
            </button>
            <button type="button" data-testid="nested-native-text-button">
              <span data-testid="nested-native-text-target">History</span>
            </button>
          </div>
        ),
        defaultTitle: 'Native Text Panel',
        defaultSize: { width: 320, height: 220 },
      },
    ];
    const [state, setState] = createSignal<WorkbenchState>({
      version: 1,
      widgets: [
        {
          id: 'widget-native-text-1',
          type: 'redeven.native-text-panel',
          title: 'Native Text Panel',
          x: 80,
          y: 64,
          width: 320,
          height: 220,
          z_index: 1,
          created_at_unix_ms: 1,
        },
      ],
      viewport: { x: 120, y: 72, scale: 1 },
      locked: false,
      filters: createWorkbenchFilterState(activationDefinitions),
      selectedWidgetId: 'widget-native-text-1',
      theme: 'default',
    });

    render(() => (
      <RedevenWorkbenchSurface
        state={state}
        setState={setState}
        widgetDefinitions={activationDefinitions}
        filterBarWidgetTypes={[]}
        enableKeyboard={false}
      />
    ), host);

    await flushWorkbenchInteraction();

    const nativeTextTarget = host.querySelector('[data-testid="native-text-target"]') as HTMLElement | null;
    const nativeTextButton = host.querySelector('[data-testid="native-text-button"]') as HTMLElement | null;
    const nestedNativeTextTarget = host.querySelector('[data-testid="nested-native-text-target"]') as HTMLElement | null;
    const activationSeq = () => host.querySelector('[data-testid="activation-seq"]')?.textContent ?? '';

    expect(nativeTextTarget).toBeTruthy();
    expect(nativeTextButton).toBeTruthy();
    expect(nestedNativeTextTarget).toBeTruthy();
    expect(activationSeq()).toBe('0');

    const pointerDown = dispatchPointerEvent('pointerdown', nativeTextTarget!, { pointerId: 17 });
    await flushWorkbenchInteraction();

    expect(pointerDown.defaultPrevented).toBe(false);
    expect(activationSeq()).toBe('0');
    expect(nativeTextTarget?.getAttribute(REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR)).toBe('true');
    expect(nativeTextTarget?.getAttribute('data-floe-local-interaction-surface')).toBe('true');

    const buttonPointerDown = dispatchPointerEvent('pointerdown', nativeTextButton!, { pointerId: 18 });
    await flushWorkbenchInteraction();

    expect(buttonPointerDown.defaultPrevented).toBe(false);
    expect(activationSeq()).toBe('0');
    expect(nativeTextButton?.getAttribute(REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR)).toBe('true');

    const nestedPointerDown = dispatchPointerEvent('pointerdown', nestedNativeTextTarget!, { pointerId: 19 });
    await flushWorkbenchInteraction();

    expect(nestedPointerDown.defaultPrevented).toBe(false);
    expect(activationSeq()).toBe('0');
    expect(nestedNativeTextTarget?.getAttribute(REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR)).toBe('true');
    getComputedStyleSpy.mockRestore();
  });
});
