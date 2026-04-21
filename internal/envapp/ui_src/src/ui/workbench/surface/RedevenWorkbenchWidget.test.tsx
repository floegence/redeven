// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedevenWorkbenchWidget } from './RedevenWorkbenchWidget';
import {
  FLOE_DIALOG_SURFACE_HOST_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
} from './workbenchInputRouting';

function dispatchPointerEvent(
  type: string,
  target: EventTarget,
  options: {
    clientX?: number;
    clientY?: number;
    button?: number;
    pointerId?: number;
    buttons?: number;
  } = {},
): void {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor(type, {
    bubbles: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
  });
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', {
      configurable: true,
      value: options.pointerId ?? 1,
    });
  }
  Object.defineProperty(event, 'buttons', {
    configurable: true,
    value: options.buttons ?? 1,
  });
  target.dispatchEvent(event);
}

function createWidgetProps() {
  return {
    definition: {
      icon: () => <svg aria-hidden="true" />,
      body: () => <div data-testid="widget-body">Body</div>,
    } as any,
    widgetId: 'widget-files-1',
    widgetTitle: 'Files',
    widgetType: 'redeven.files' as any,
    x: 0,
    y: 0,
    width: 480,
    height: 320,
    renderLayer: 1,
    itemSnapshot: () => ({
      id: 'widget-files-1',
      type: 'redeven.files',
      title: 'Files',
      x: 0,
      y: 0,
      width: 480,
      height: 320,
      z_index: 1,
      created_at_unix_ms: 1,
    } as any),
    selected: false,
    optimisticFront: false,
    topRenderLayer: 1,
    viewportScale: 2,
    locked: false,
    filtered: false,
    onSelect: vi.fn(),
    onFitWidget: vi.fn(),
    onOverviewWidget: vi.fn(),
    onContextMenu: vi.fn(),
    onStartOptimisticFront: vi.fn(),
    onCommitFront: vi.fn(),
    onCommitMove: vi.fn(),
    onCommitResize: vi.fn(),
    onRequestDelete: vi.fn(),
    onLayoutInteractionStart: vi.fn(),
    onLayoutInteractionEnd: vi.fn(),
  };
}

describe('RedevenWorkbenchWidget', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  it('keeps local body presses component-owned while header presses still focus the widget root', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const props = createWidgetProps();

    dispose = render(() => <RedevenWorkbenchWidget {...props} />, host);

    const widgetRoot = host.querySelector(
      `[${REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR}="true"]`
    ) as HTMLElement | null;
    const widgetHeader = host.querySelector('.workbench-widget__header') as HTMLElement | null;
    const widgetBody = host.querySelector('[data-testid="widget-body"]') as HTMLElement | null;
    expect(widgetRoot).toBeTruthy();
    expect(widgetHeader).toBeTruthy();
    expect(widgetBody).toBeTruthy();
    expect(widgetRoot?.getAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR)).toBe('widget-files-1');
    expect(widgetRoot?.getAttribute(FLOE_DIALOG_SURFACE_HOST_ATTR)).toBe('true');

    const outsideInput = document.createElement('input');
    document.body.appendChild(outsideInput);
    outsideInput.focus();

    dispatchPointerEvent('pointerdown', widgetBody!);
    await Promise.resolve();

    expect(document.activeElement).toBe(outsideInput);
    expect(props.onSelect).toHaveBeenCalledWith('widget-files-1');
    expect(props.onCommitFront).toHaveBeenCalledWith('widget-files-1');

    dispatchPointerEvent('pointerdown', widgetHeader!, { clientX: 20, clientY: 16 });
    await Promise.resolve();

    expect(document.activeElement).toBe(widgetRoot);
  });

  it('starts dragging from the header and commits movement in world coordinates', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const props = createWidgetProps();

    dispose = render(() => <RedevenWorkbenchWidget {...props} />, host);

    const widgetHeader = host.querySelector('.workbench-widget__header') as HTMLElement | null;
    expect(widgetHeader).toBeTruthy();

    dispatchPointerEvent('pointerdown', widgetHeader!, {
      clientX: 10,
      clientY: 10,
      pointerId: 4,
    });
    dispatchPointerEvent('pointermove', document, {
      clientX: 50,
      clientY: 30,
      pointerId: 4,
      buttons: 1,
    });
    dispatchPointerEvent('pointerup', document, {
      clientX: 50,
      clientY: 30,
      pointerId: 4,
      buttons: 0,
    });

    expect(props.onStartOptimisticFront).toHaveBeenCalledWith('widget-files-1');
    expect(props.onCommitFront).toHaveBeenCalledWith('widget-files-1');
    expect(props.onCommitMove).toHaveBeenCalledWith('widget-files-1', {
      x: 20,
      y: 10,
    });
    expect(props.onLayoutInteractionStart).toHaveBeenCalledTimes(1);
    expect(props.onLayoutInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it('selects on secondary presses without stealing focus from widget-local content', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const props = createWidgetProps();

    dispose = render(() => <RedevenWorkbenchWidget {...props} />, host);

    const widgetBody = host.querySelector('[data-testid="widget-body"]') as HTMLElement | null;
    expect(widgetBody).toBeTruthy();

    const outsideInput = document.createElement('input');
    document.body.appendChild(outsideInput);
    outsideInput.focus();

    dispatchPointerEvent('pointerdown', widgetBody!, { button: 2, pointerId: 7 });
    await Promise.resolve();

    expect(document.activeElement).toBe(outsideInput);
    expect(props.onSelect).toHaveBeenCalledWith('widget-files-1');
    expect(props.onCommitFront).toHaveBeenCalledWith('widget-files-1');
  });

  it('keeps header action buttons clickable without starting a drag', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const props = createWidgetProps();

    dispose = render(() => <RedevenWorkbenchWidget {...props} />, host);

    const focusButton = host.querySelector(
      'button[aria-label="Zoom widget to fit viewport"]'
    ) as HTMLButtonElement | null;
    const unfocusButton = host.querySelector(
      'button[aria-label="Show widget in overview"]'
    ) as HTMLButtonElement | null;
    const closeButton = host.querySelector(
      'button[aria-label="Remove widget"]'
    ) as HTMLButtonElement | null;
    expect(focusButton).toBeTruthy();
    expect(unfocusButton).toBeTruthy();
    expect(closeButton).toBeTruthy();

    dispatchPointerEvent('pointerdown', focusButton!, { clientX: 10, clientY: 10, pointerId: 2 });
    focusButton!.click();
    dispatchPointerEvent('pointerdown', unfocusButton!, { clientX: 12, clientY: 12, pointerId: 3 });
    unfocusButton!.click();
    dispatchPointerEvent('pointerdown', closeButton!, { clientX: 14, clientY: 14, pointerId: 4 });
    closeButton!.click();

    expect(props.onStartOptimisticFront).not.toHaveBeenCalled();
    expect(props.onCommitMove).not.toHaveBeenCalled();
    expect(props.onFitWidget).toHaveBeenCalledTimes(1);
    expect(props.onOverviewWidget).toHaveBeenCalledTimes(1);
    expect(props.onRequestDelete).toHaveBeenCalledWith('widget-files-1');
  });

  it('ends header drag once when the release is only observable via a later buttons=0 move', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const props = createWidgetProps();

    dispose = render(() => <RedevenWorkbenchWidget {...props} />, host);

    const widgetHeader = host.querySelector('.workbench-widget__header') as HTMLElement | null;
    expect(widgetHeader).toBeTruthy();

    dispatchPointerEvent('pointerdown', widgetHeader!, {
      clientX: 10,
      clientY: 10,
      pointerId: 8,
      buttons: 1,
    });
    dispatchPointerEvent('pointermove', document, {
      clientX: 50,
      clientY: 30,
      pointerId: 8,
      buttons: 1,
    });
    dispatchPointerEvent('pointermove', document, {
      clientX: 90,
      clientY: 50,
      pointerId: 8,
      buttons: 0,
    });
    dispatchPointerEvent('pointermove', document, {
      clientX: 120,
      clientY: 80,
      pointerId: 8,
      buttons: 0,
    });

    expect(props.onCommitMove).toHaveBeenCalledTimes(1);
    expect(props.onCommitMove).toHaveBeenCalledWith('widget-files-1', {
      x: 20,
      y: 10,
    });
    expect(props.onLayoutInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it('ends resize once when the release is only observable via a later buttons=0 move', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const props = createWidgetProps();

    dispose = render(() => <RedevenWorkbenchWidget {...props} />, host);

    const resizeHandle = host.querySelector('.workbench-widget__resize') as HTMLElement | null;
    expect(resizeHandle).toBeTruthy();

    dispatchPointerEvent('pointerdown', resizeHandle!, {
      clientX: 100,
      clientY: 80,
      pointerId: 11,
      buttons: 1,
    });
    dispatchPointerEvent('pointermove', document, {
      clientX: 140,
      clientY: 100,
      pointerId: 11,
      buttons: 1,
    });
    dispatchPointerEvent('pointermove', document, {
      clientX: 180,
      clientY: 120,
      pointerId: 11,
      buttons: 0,
    });
    dispatchPointerEvent('pointermove', document, {
      clientX: 200,
      clientY: 140,
      pointerId: 11,
      buttons: 0,
    });

    expect(props.onCommitResize).toHaveBeenCalledTimes(1);
    expect(props.onCommitResize).toHaveBeenCalledWith('widget-files-1', {
      width: 500,
      height: 330,
    });
    expect(props.onLayoutInteractionEnd).toHaveBeenCalledTimes(1);
  });
});
