// @vitest-environment jsdom

import { createEffect, createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkbenchFilterState, type WorkbenchState, type WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import { CANVAS_WHEEL_INTERACTIVE_ATTR } from '@floegence/floe-webapp-core/ui';

import { RedevenWorkbenchSurface } from './RedevenWorkbenchSurface';

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
    selectedWidgetId: 'widget-terminal-1',
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

    const wheelWhileSelected = dispatchWheel(widgetBody!, -120);
    expect(wheelWhileSelected.defaultPrevented).toBe(true);

    dispatchPointerEvent('pointerdown', canvas!, { pointerId: 2 });
    dispatchPointerEvent('pointerup', canvas!, { pointerId: 2 });
    await flushWorkbenchInteraction();

    expect(readState().selectedWidgetId).toBeNull();
    expect(widgetRoot?.getAttribute(CANVAS_WHEEL_INTERACTIVE_ATTR)).toBeNull();
    expect(document.activeElement).toBe(surfaceRoot);

    const wheelAfterCanvasHandoff = dispatchWheel(widgetBody!, -120);
    expect(wheelAfterCanvasHandoff.defaultPrevented).toBe(true);
  });

  it('forwards canvas-owned terminal wheel gestures before terminal capture handlers consume them', async () => {
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
              class="redeven-terminal-surface"
              data-floe-canvas-wheel-interactive="true"
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

    expect(state().viewport.scale).toBeGreaterThan(1);
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
              class="redeven-terminal-surface"
              data-floe-canvas-wheel-interactive="true"
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
});
