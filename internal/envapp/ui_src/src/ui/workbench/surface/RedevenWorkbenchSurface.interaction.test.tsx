// @vitest-environment jsdom

import { createSignal } from 'solid-js';
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

function dispatchPointerEvent(
  type: string,
  target: EventTarget,
  options: {
    button?: number;
    pointerId?: number;
    clientX?: number;
    clientY?: number;
  } = {},
): void {
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
    expect(wheelWhileSelected.defaultPrevented).toBe(false);

    dispatchPointerEvent('pointerdown', canvas!, { pointerId: 2 });
    dispatchPointerEvent('pointerup', canvas!, { pointerId: 2 });
    await flushWorkbenchInteraction();

    expect(readState().selectedWidgetId).toBeNull();
    expect(widgetRoot?.getAttribute(CANVAS_WHEEL_INTERACTIVE_ATTR)).toBeNull();
    expect(document.activeElement).toBe(surfaceRoot);

    const wheelAfterCanvasHandoff = dispatchWheel(widgetBody!, -120);
    expect(wheelAfterCanvasHandoff.defaultPrevented).toBe(true);
  });
});
