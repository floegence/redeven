// @vitest-environment jsdom

import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { LayoutProvider } from '@floegence/floe-webapp-core';

import { RedevenInfiniteCanvas } from './RedevenInfiniteCanvas';
import { REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR } from './workbenchWheelInteractive';
import { FileBrowserWorkspace } from '../../widgets/FileBrowserWorkspace';

const disposers: Array<() => void> = [];
const INITIAL_VIEWPORT = { x: 220, y: 140, scale: 1 };
const WHEEL_CLIENT_X = 320;
const WHEEL_CLIENT_Y = 260;

type WheelHarnessMode = 'interactive' | 'wheel_interactive';

function mount(view: () => JSX.Element, host: HTMLElement): void {
  disposers.push(render(view, host));
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function readViewportSnapshot(host: HTMLElement) {
  const output = host.querySelector('[data-testid="viewport-snapshot"]');
  return JSON.parse(output?.textContent ?? 'null');
}

function mockMatchMedia(matches = false): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });
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

function dispatchPointerDown(target: EventTarget, options: {
  button?: number;
  clientX?: number;
  clientY?: number;
  pointerId?: number;
} = {}): void {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor('pointerdown', {
    bubbles: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
  });
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', { configurable: true, value: options.pointerId ?? 1 });
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

function CanvasFileBrowserContextMenuHarness() {
  const [actionCount, setActionCount] = createSignal(0);

  return (
    <>
      <RedevenInfiniteCanvas
        viewport={INITIAL_VIEWPORT}
        onViewportChange={() => {}}
        selectedWidgetId="widget-files-1"
        ariaLabel="Redeven canvas file browser harness"
      >
        <article
          data-testid="canvas-file-browser-host"
          data-floe-dialog-surface-host="true"
          data-redeven-workbench-widget-root="true"
          data-redeven-workbench-widget-id="widget-files-1"
          style={{ position: 'relative', width: '420px', height: '300px' }}
        >
          <LayoutProvider>
            <FileBrowserWorkspace
              mode="files"
              onModeChange={() => {}}
              files={[
                { id: 'folder-src', name: 'src', type: 'folder', path: '/src', children: [] },
                { id: 'file-readme', name: 'README.md', type: 'file', path: '/README.md' },
              ]}
              currentPath="/"
              initialPath="/"
              persistenceKey="canvas-file-browser-context-menu"
              instanceId="canvas-file-browser-context-menu"
              resetKey={0}
              width={260}
              open
              contextMenuCallbacks={{
                onDuplicate: () => setActionCount((value) => value + 1),
              }}
            />
          </LayoutProvider>
        </article>
      </RedevenInfiniteCanvas>

      <output data-testid="canvas-file-browser-action-count">{String(actionCount())}</output>
    </>
  );
}

function CanvasWheelHarness(props: {
  mode: WheelHarnessMode;
  selectedWidgetId?: string | null;
  insideWidget?: boolean;
}) {
  const [viewport, setViewport] = createSignal(INITIAL_VIEWPORT);
  const targetBody = (
    <div
      {...(props.mode === 'interactive'
        ? { 'data-floe-canvas-interactive': 'true' }
        : { [REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR]: 'true' })}
    >
      <button type="button" data-testid="wheel-target">
        Wheel target
      </button>
    </div>
  );

  return (
    <>
      <RedevenInfiniteCanvas
        viewport={viewport()}
        onViewportChange={setViewport}
        selectedWidgetId={props.selectedWidgetId}
        ariaLabel="Redeven wheel routing harness"
      >
        <div style={{ position: 'relative', width: '480px', height: '320px' }}>
          {props.insideWidget === false ? (
            targetBody
          ) : (
            <article
              data-redeven-workbench-widget-root="true"
              data-redeven-workbench-widget-id="widget-files-1"
            >
              {targetBody}
            </article>
          )}
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

  it('yields wheel ownership to the selected widget subtree', () => {
    vi.useFakeTimers();

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasWheelHarness mode="interactive" selectedWidgetId="widget-files-1" />, host);

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

  it('keeps cursor-centered zoom active over unselected widget regions', () => {
    vi.useFakeTimers();

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasWheelHarness mode="interactive" selectedWidgetId={null} />, host);

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const target = host.querySelector('[data-testid="wheel-target"]') as HTMLButtonElement | null;
    expect(canvas).toBeTruthy();
    expect(target).toBeTruthy();

    mockCanvasRect(canvas!);

    const event = dispatchWheel(target!, -120);
    expect(event.defaultPrevented).toBe(true);

    vi.advanceTimersByTime(100);

    const nextViewport = readViewportSnapshot(host);
    expect(nextViewport.scale).toBeGreaterThan(INITIAL_VIEWPORT.scale);
  });

  it('keeps zoom ownership on the canvas when the hovered wheel consumer is not selected', () => {
    vi.useFakeTimers();

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasWheelHarness mode="wheel_interactive" selectedWidgetId={null} />, host);

    const canvas = host.querySelector('.floe-infinite-canvas') as HTMLElement | null;
    const target = host.querySelector('[data-testid="wheel-target"]') as HTMLButtonElement | null;
    expect(canvas).toBeTruthy();
    expect(target).toBeTruthy();

    mockCanvasRect(canvas!);

    const event = dispatchWheel(target!, -120);
    expect(event.defaultPrevented).toBe(true);

    vi.advanceTimersByTime(100);

    const nextViewport = readViewportSnapshot(host);
    expect(nextViewport.scale).toBeGreaterThan(INITIAL_VIEWPORT.scale);
  });

  it('still respects explicit non-widget wheel islands', () => {
    vi.useFakeTimers();

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasWheelHarness mode="wheel_interactive" selectedWidgetId={null} insideWidget={false} />, host);

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

  it('keeps file-browser context menu items clickable when mounted inside a workbench widget host', async () => {
    mockMatchMedia(false);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      window.clearTimeout(handle);
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => <CanvasFileBrowserContextMenuHarness />, host);

    const folderButton = host.querySelector('button[title="src"]') as HTMLButtonElement | null;
    const surfaceHost = host.querySelector('[data-testid="canvas-file-browser-host"]') as HTMLElement | null;
    expect(folderButton).toBeTruthy();
    expect(surfaceHost).toBeTruthy();

    dispatchPointerDown(folderButton!, {
      pointerId: 1,
      button: 2,
      clientX: 32,
      clientY: 32,
    });
    folderButton!.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 32,
      clientY: 32,
    }));
    await flushMicrotasks();
    await flushMicrotasks();

    const menu = surfaceHost!.querySelector('[role="menu"]') as HTMLElement | null;
    const actionButton = Array.from(menu?.querySelectorAll('button') ?? []).find((node) => node.textContent?.includes('Duplicate')) as HTMLButtonElement | undefined;
    expect(menu).toBeTruthy();
    expect(surfaceHost?.contains(menu ?? null)).toBe(true);
    expect(actionButton).toBeTruthy();

    dispatchPointerDown(actionButton!);
    actionButton!.click();
    await flushMicrotasks();
    await flushMicrotasks();

    const actionCount = host.querySelector('[data-testid="canvas-file-browser-action-count"]');
    expect(actionCount?.textContent).toBe('1');
  });
});
