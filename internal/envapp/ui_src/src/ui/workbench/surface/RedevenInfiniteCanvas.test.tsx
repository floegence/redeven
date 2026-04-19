// @vitest-environment jsdom

import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '@floegence/floe-webapp-core/ui';

import { RedevenInfiniteCanvas } from './RedevenInfiniteCanvas';
import { REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR } from './workbenchWheelInteractive';

const disposers: Array<() => void> = [];
const INITIAL_VIEWPORT = { x: 220, y: 140, scale: 1 };
const WHEEL_CLIENT_X = 320;
const WHEEL_CLIENT_Y = 260;

type WheelHarnessMode = 'interactive' | 'wheel_interactive';

function mount(view: () => JSX.Element, host: HTMLElement): void {
  disposers.push(render(view, host));
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

function readViewportSnapshot(host: HTMLElement) {
  const output = host.querySelector('[data-testid="viewport-snapshot"]');
  return JSON.parse(output?.textContent ?? 'null');
}

function mockCanvasRect(canvas: HTMLElement): void {
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: 640,
      bottom: 480,
      width: 640,
      height: 480,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }),
  });
}

function dispatchWheel(target: EventTarget, deltaY: number): WheelEvent {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: WHEEL_CLIENT_X,
    clientY: WHEEL_CLIENT_Y,
    deltaY,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchPointerDown(target: EventTarget): void {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor('pointerdown', {
    bubbles: true,
    button: 0,
  });
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', { configurable: true, value: 1 });
  }
  if (!('pointerType' in event)) {
    Object.defineProperty(event, 'pointerType', { configurable: true, value: 'mouse' });
  }
  target.dispatchEvent(event);
}

function CanvasDialogHarness() {
  const [open, setOpen] = createSignal(false);
  const [actionCount, setActionCount] = createSignal(0);
  const [viewport, setViewport] = createSignal({ x: 0, y: 0, scale: 1 });

  return (
    <>
      <RedevenInfiniteCanvas
        viewport={viewport()}
        onViewportChange={setViewport}
        ariaLabel="Redeven canvas dialog harness"
      >
        <div
          data-testid="canvas-surface-host"
          data-floe-dialog-surface-host="true"
          style={{ position: 'relative', width: '360px', height: '240px' }}
        >
          <div data-floe-canvas-interactive="true">
            <button type="button" data-testid="canvas-dialog-trigger" onClick={() => setOpen(true)}>
              Open canvas dialog
            </button>
          </div>

          <Dialog
            open={open()}
            onOpenChange={setOpen}
            title="Canvas dialog"
            description="Canvas-scoped dialog"
          >
            <button
              type="button"
              data-testid="canvas-dialog-action"
              onClick={() => setActionCount((value) => value + 1)}
            >
              Confirm canvas dialog
            </button>
          </Dialog>
        </div>
      </RedevenInfiniteCanvas>

      <output data-testid="canvas-dialog-action-count">{String(actionCount())}</output>
    </>
  );
}

function CanvasWheelHarness(props: { mode: WheelHarnessMode }) {
  const [viewport, setViewport] = createSignal(INITIAL_VIEWPORT);

  return (
    <>
      <RedevenInfiniteCanvas viewport={viewport()} onViewportChange={setViewport} ariaLabel="Redeven wheel routing harness">
        <div style={{ position: 'relative', width: '480px', height: '320px' }}>
          <div
            {...(props.mode === 'interactive'
              ? { 'data-floe-canvas-interactive': 'true' }
              : { [REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR]: 'true' })}
          >
            <button type="button" data-testid="wheel-target">
              Wheel target
            </button>
          </div>
        </div>
      </RedevenInfiniteCanvas>

      <output data-testid="viewport-snapshot">{JSON.stringify(viewport())}</output>
    </>
  );
}

describe('RedevenInfiniteCanvas', () => {
  afterEach(() => {
    while (disposers.length) {
      disposers.pop()?.();
    }
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('keeps cursor-centered zoom active over ordinary interactive widget regions', () => {
    vi.useFakeTimers();

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasWheelHarness mode="interactive" />, host);

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const target = host.querySelector('[data-testid="wheel-target"]') as HTMLButtonElement | null;
    expect(canvas).toBeTruthy();
    expect(target).toBeTruthy();

    mockCanvasRect(canvas!);

    const event = dispatchWheel(target!, -120);
    expect(event.defaultPrevented).toBe(true);

    vi.advanceTimersByTime(100);

    const nextViewport = readViewportSnapshot(host);
    const anchoredWorldX = (WHEEL_CLIENT_X - nextViewport.x) / nextViewport.scale;
    const anchoredWorldY = (WHEEL_CLIENT_Y - nextViewport.y) / nextViewport.scale;

    expect(nextViewport.scale).toBeGreaterThan(INITIAL_VIEWPORT.scale);
    expect(anchoredWorldX).toBeCloseTo(
      (WHEEL_CLIENT_X - INITIAL_VIEWPORT.x) / INITIAL_VIEWPORT.scale,
      6
    );
    expect(anchoredWorldY).toBeCloseTo(
      (WHEEL_CLIENT_Y - INITIAL_VIEWPORT.y) / INITIAL_VIEWPORT.scale,
      6
    );
  });

  it('yields wheel ownership to explicit local wheel consumers', () => {
    vi.useFakeTimers();

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasWheelHarness mode="wheel_interactive" />, host);

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const target = host.querySelector('[data-testid="wheel-target"]') as HTMLButtonElement | null;
    expect(canvas).toBeTruthy();
    expect(target).toBeTruthy();

    mockCanvasRect(canvas!);

    const event = dispatchWheel(target!, -120);
    expect(event.defaultPrevented).toBe(false);

    vi.advanceTimersByTime(100);

    expect(readViewportSnapshot(host)).toEqual(INITIAL_VIEWPORT);
  });

  it('keeps a surface dialog clickable when mounted inside a workbench canvas host', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasDialogHarness />, host);

    const trigger = host.querySelector('[data-testid="canvas-dialog-trigger"]') as HTMLButtonElement | null;
    const surfaceHost = host.querySelector('[data-testid="canvas-surface-host"]') as HTMLElement | null;
    expect(trigger).toBeTruthy();
    expect(surfaceHost).toBeTruthy();

    dispatchPointerDown(trigger!);
    trigger!.click();
    await flushMicrotasks();

    const overlayRoot = host.querySelector('[data-floe-dialog-overlay-root]') as HTMLElement | null;
    const dialogAction = host.querySelector('[data-testid="canvas-dialog-action"]') as HTMLButtonElement | null;
    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLDivElement | null;
    expect(overlayRoot).toBeTruthy();
    expect(surfaceHost?.contains(overlayRoot ?? null)).toBe(true);
    expect(dialogAction).toBeTruthy();
    expect(canvas).toBeTruthy();

    dispatchPointerDown(dialogAction!);
    await flushMicrotasks();
    expect(canvas?.classList.contains('is-panning')).toBe(false);

    dialogAction!.click();
    await flushMicrotasks();

    const actionCount = host.querySelector('[data-testid="canvas-dialog-action-count"]');
    expect(actionCount?.textContent).toBe('1');
  });

  it('does not let workbench wheel routing steal local dialog events', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasDialogHarness />, host);

    const trigger = host.querySelector('[data-testid="canvas-dialog-trigger"]') as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    dispatchPointerDown(trigger!);
    trigger!.click();
    await flushMicrotasks();

    const dialogAction = host.querySelector('[data-testid="canvas-dialog-action"]') as HTMLButtonElement | null;
    expect(dialogAction).toBeTruthy();

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    dialogAction!.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(false);
  });

  it('does not let workbench context-menu routing steal local dialog events', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasDialogHarness />, host);

    const trigger = host.querySelector('[data-testid="canvas-dialog-trigger"]') as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    dispatchPointerDown(trigger!);
    trigger!.click();
    await flushMicrotasks();

    const dialogAction = host.querySelector('[data-testid="canvas-dialog-action"]') as HTMLButtonElement | null;
    expect(dialogAction).toBeTruthy();

    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 32,
      clientY: 32,
    });
    dialogAction!.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(false);
  });
});
