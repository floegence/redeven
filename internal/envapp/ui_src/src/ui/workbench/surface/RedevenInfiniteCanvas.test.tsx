// @vitest-environment jsdom

import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { Dialog } from '@floegence/floe-webapp-core/ui';

import { RedevenInfiniteCanvas } from './RedevenInfiniteCanvas';

const disposers: Array<() => void> = [];

function mount(view: () => JSX.Element, host: HTMLElement): void {
  disposers.push(render(view, host));
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
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

describe('RedevenInfiniteCanvas', () => {
  afterEach(() => {
    while (disposers.length) {
      disposers.pop()?.();
    }
    document.body.innerHTML = '';
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
