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
    dispatchPointerEvent('pointermove', window, {
      clientX: 50,
      clientY: 30,
      pointerId: 4,
    });
    dispatchPointerEvent('pointerup', window, {
      clientX: 50,
      clientY: 30,
      pointerId: 4,
    });

    expect(props.onStartOptimisticFront).toHaveBeenCalledWith('widget-files-1');
    expect(props.onCommitFront).toHaveBeenCalledWith('widget-files-1');
    expect(props.onCommitMove).toHaveBeenCalledWith('widget-files-1', {
      x: 20,
      y: 10,
    });
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
      'button[aria-label="Focus widget"]'
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
});
