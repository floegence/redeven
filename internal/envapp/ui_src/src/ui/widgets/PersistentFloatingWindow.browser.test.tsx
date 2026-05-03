import '../../index.css';

import { page } from '@vitest/browser/context';
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { InfiniteCanvas } from '@floegence/floe-webapp-core/ui';

import { PersistentFloatingWindow } from './PersistentFloatingWindow';

function Providers(props: Readonly<{ children: JSX.Element }>) {
  return (
    <FloeConfigProvider>
      <LayoutProvider>{props.children}</LayoutProvider>
    </FloeConfigProvider>
  );
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function createPointerEvent(type: string, pointerId: number, clientX: number, clientY: number): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    pointerType: 'mouse',
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'pointerId', {
    configurable: true,
    value: pointerId,
  });
  return event;
}

function dispatchPointerSequence(options: {
  startTarget: HTMLElement;
  root: HTMLElement;
  from: { x: number; y: number };
  to: { x: number; y: number };
}): void {
  const pointerId = 11;
  Object.defineProperty(options.root, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(options.root, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });

  options.startTarget.dispatchEvent(createPointerEvent('pointerdown', pointerId, options.from.x, options.from.y));
  options.root.dispatchEvent(createPointerEvent('pointermove', pointerId, options.to.x, options.to.y));
  options.root.dispatchEvent(createPointerEvent('pointerup', pointerId, options.to.x, options.to.y));
}

function findBottomRightResizeHandle(root: HTMLElement): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('div'))
    .find((element) =>
      element.classList.contains('cursor-nwse-resize') &&
      element.classList.contains('bottom-0') &&
      element.classList.contains('right-0')
    ) ?? null;
}

function WorkbenchFloatingWindowHarness() {
  const [open, setOpen] = createSignal(false);
  const [actionCount, setActionCount] = createSignal(0);
  const [viewport, setViewport] = createSignal({ x: 0, y: 0, scale: 1 });

  return (
    <Providers>
      <InfiniteCanvas
        viewport={viewport()}
        onViewportChange={setViewport}
        ariaLabel="Workbench floating window harness"
      >
        <div
          data-testid="canvas-surface-host"
          data-floe-dialog-surface-host="true"
          style={{ position: 'relative', width: '420px', height: '280px' }}
        >
          <div data-floe-canvas-interactive="true" class="flex h-full flex-col gap-3 p-3">
            <button type="button" data-testid="open-floating-window" onClick={() => setOpen(true)}>
              Open helper window
            </button>
            <output data-testid="floating-action-count">{String(actionCount())}</output>
            <output data-testid="viewport-snapshot">{JSON.stringify(viewport())}</output>
          </div>

          <PersistentFloatingWindow
            open={open()}
            onOpenChange={setOpen}
            title="Workbench helper"
            persistenceKey="workbench-floating-window-browser-test"
            defaultPosition={{ x: 160, y: 120 }}
            defaultSize={{ width: 420, height: 280 }}
            minSize={{ width: 320, height: 220 }}
          >
            <div class="flex h-full min-h-0 flex-col gap-3 bg-background p-3">
              <button
                type="button"
                data-testid="floating-action"
                onClick={() => setActionCount((value) => value + 1)}
              >
                Perform floating action
              </button>
            </div>
          </PersistentFloatingWindow>
        </div>
      </InfiniteCanvas>
    </Providers>
  );
}

afterEach(() => {
  delete window.redevenDesktopWindowChrome;
  document.body.innerHTML = '';
  window.localStorage.clear();
});

beforeEach(async () => {
  await page.viewport(1440, 900);
});

describe('PersistentFloatingWindow browser behavior', () => {
  it('keeps desktop floating windows below the native titlebar safe area', async () => {
    window.redevenDesktopWindowChrome = {
      getSnapshot: () => ({
        mode: 'hidden-inset',
        controlsSide: 'right',
        titleBarHeight: 72,
        contentInsetStart: 16,
        contentInsetEnd: 144,
      }),
      subscribe: () => () => undefined,
    };
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => (
      <Providers>
        <PersistentFloatingWindow
          open
          onOpenChange={() => undefined}
          title="Desktop safe area helper"
          persistenceKey="desktop-safe-area-floating-window-browser-test"
          defaultPosition={{ x: 112, y: 0 }}
          defaultSize={{ width: 360, height: 260 }}
          minSize={{ width: 320, height: 220 }}
        >
          <button type="button">Focusable floating action</button>
        </PersistentFloatingWindow>
      </Providers>
    ), host);
    await settle();

    const floatingRoot = document.querySelector('[data-floe-geometry-surface="floating-window"]') as HTMLElement | null;
    expect(floatingRoot).toBeTruthy();
    expect(Math.round(floatingRoot!.getBoundingClientRect().top)).toBeGreaterThanOrEqual(72);
  });

  it('keeps the floating window clickable above a workbench canvas', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => (
      <WorkbenchFloatingWindowHarness />
    ), host);
    await settle();

    await page.getByTestId('open-floating-window').click();
    await settle();

    const actionButton = document.querySelector('[data-testid="floating-action"]') as HTMLButtonElement | null;
    const floatingRoot = document.querySelector('[data-floe-geometry-surface="floating-window"]') as HTMLElement | null;
    expect(actionButton).toBeTruthy();
    expect(floatingRoot).toBeTruthy();

    const actionRect = actionButton!.getBoundingClientRect();
    const hitTarget = document.elementFromPoint(
      actionRect.left + actionRect.width / 2,
      actionRect.top + actionRect.height / 2,
    ) as HTMLElement | null;
    expect(hitTarget?.closest('[data-testid="floating-action"]')).toBe(actionButton);

    await page.getByRole('button', { name: 'Perform floating action' }).click();
    await settle();

    expect(document.querySelector('[data-testid="floating-action-count"]')?.textContent).toBe('1');
    expect(document.querySelector('[data-testid="viewport-snapshot"]')?.textContent).toBe('{"x":0,"y":0,"scale":1}');
  });

  it('moves the floating window titlebar without mutating the underlying canvas viewport', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => (
      <WorkbenchFloatingWindowHarness />
    ), host);
    await settle();

    await page.getByTestId('open-floating-window').click();
    await settle();

    const floatingRoot = document.querySelector('[data-floe-geometry-surface="floating-window"]') as HTMLElement | null;
    const titlebar = document.querySelector('[data-floe-floating-window-titlebar="true"]') as HTMLElement | null;
    expect(floatingRoot).toBeTruthy();
    expect(titlebar).toBeTruthy();

    const titlebarRect = titlebar!.getBoundingClientRect();
    const hitTarget = document.elementFromPoint(
      titlebarRect.left + titlebarRect.width / 2,
      titlebarRect.top + titlebarRect.height / 2,
    ) as HTMLElement | null;
    expect(hitTarget?.closest('[data-floe-floating-window-titlebar="true"]')).toBe(titlebar);

    const beforeTransform = floatingRoot!.style.transform;

    dispatchPointerSequence({
      startTarget: titlebar!,
      root: floatingRoot!,
      from: {
        x: titlebarRect.left + 24,
        y: titlebarRect.top + titlebarRect.height / 2,
      },
      to: {
        x: titlebarRect.left + 72,
        y: titlebarRect.top + titlebarRect.height / 2 + 32,
      },
    });
    await settle();

    expect(floatingRoot!.style.transform).not.toBe(beforeTransform);
    expect(document.querySelector('[data-testid="viewport-snapshot"]')?.textContent).toBe('{"x":0,"y":0,"scale":1}');
  });

  it('resizes the floating window edge without mutating the underlying canvas viewport', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);

    render(() => (
      <WorkbenchFloatingWindowHarness />
    ), host);
    await settle();

    await page.getByTestId('open-floating-window').click();
    await settle();

    const floatingRoot = document.querySelector('[data-floe-geometry-surface="floating-window"]') as HTMLElement | null;
    const resizeHandle = findBottomRightResizeHandle(floatingRoot!);
    expect(floatingRoot).toBeTruthy();
    expect(resizeHandle).toBeTruthy();

    const beforeWidth = floatingRoot!.style.width;
    const beforeHeight = floatingRoot!.style.height;
    const handleRect = resizeHandle!.getBoundingClientRect();

    dispatchPointerSequence({
      startTarget: resizeHandle!,
      root: floatingRoot!,
      from: {
        x: handleRect.left + handleRect.width / 2,
        y: handleRect.top + handleRect.height / 2,
      },
      to: {
        x: handleRect.left + handleRect.width / 2 + 56,
        y: handleRect.top + handleRect.height / 2 + 40,
      },
    });
    await settle();

    expect(floatingRoot!.style.width).not.toBe(beforeWidth);
    expect(floatingRoot!.style.height).not.toBe(beforeHeight);
    expect(document.querySelector('[data-testid="viewport-snapshot"]')?.textContent).toBe('{"x":0,"y":0,"scale":1}');
  });
});
