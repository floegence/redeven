// @vitest-environment jsdom

import { createEffect, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchWidgetBodyProps } from '@floegence/floe-webapp-core/workbench';

import { RedevenWorkbenchWidget } from './RedevenWorkbenchWidget';
import {
  FLOE_DIALOG_SURFACE_HOST_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
  type RedevenWorkbenchWidgetBodyActivation,
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
    pointerType?: string;
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
  if (!('pointerType' in event)) {
    Object.defineProperty(event, 'pointerType', {
      configurable: true,
      value: options.pointerType ?? 'mouse',
    });
  }
  target.dispatchEvent(event);
}

function createActivationBody(
  onActivation: (activation: RedevenWorkbenchWidgetBodyActivation) => void,
  children: (props: WorkbenchWidgetBodyProps & {
    activation?: RedevenWorkbenchWidgetBodyActivation;
  }) => JSX.Element,
) {
  return (props: WorkbenchWidgetBodyProps & {
    activation?: RedevenWorkbenchWidgetBodyActivation;
  }) => {
    createEffect(() => {
      const activation = props.activation;
      if (activation) onActivation(activation);
    });

    return children(props);
  };
}

function createWidgetProps(
  overrides: Partial<ReturnType<typeof createWidgetPropsBase>> = {}
) {
  return {
    ...createWidgetPropsBase(),
    ...overrides,
  };
}

function createWidgetPropsBase() {
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

  it('emits local activation for non-focusable body presses without stealing root focus', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const outsideInput = document.createElement('input');
    document.body.appendChild(outsideInput);

    const onActivation = vi.fn();
    const props = createWidgetProps({
      definition: {
        icon: () => <svg aria-hidden="true" />,
        body: createActivationBody(onActivation, () => (
          <div data-testid="widget-activation-body">Body</div>
        )),
      } as any,
    });

    dispose = render(() => <RedevenWorkbenchWidget {...props} />, host);

    const widgetBody = host.querySelector('[data-testid="widget-activation-body"]') as HTMLElement | null;
    expect(widgetBody).toBeTruthy();

    outsideInput.focus();
    dispatchPointerEvent('pointerdown', widgetBody!);
    await Promise.resolve();

    expect(document.activeElement).toBe(outsideInput);
    expect(onActivation).toHaveBeenCalledTimes(1);
    expect(onActivation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        seq: 1,
        source: 'local_pointer',
        pointerType: 'mouse',
      })
    );
  });

  it('does not emit local activation for shell, native controls, local surfaces, or secondary presses', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onActivation = vi.fn();
    const props = createWidgetProps({
      definition: {
        icon: () => <svg aria-hidden="true" />,
        body: createActivationBody(onActivation, () => (
          <div data-testid="widget-body-controls">
            <button type="button" data-testid="native-button">
              <span data-testid="native-button-label">Native button</span>
            </button>
            <input aria-label="Native input" data-testid="native-input" />
            <div data-floe-local-interaction-surface="true" data-testid="local-surface">
              Local surface
            </div>
            <div data-testid="secondary-target">Secondary target</div>
          </div>
        )),
      } as any,
    });

    dispose = render(() => <RedevenWorkbenchWidget {...props} />, host);

    const widgetHeader = host.querySelector('.workbench-widget__header') as HTMLElement | null;
    const nativeButtonLabel = host.querySelector('[data-testid="native-button-label"]') as HTMLElement | null;
    const nativeInput = host.querySelector('[data-testid="native-input"]') as HTMLElement | null;
    const localSurface = host.querySelector('[data-testid="local-surface"]') as HTMLElement | null;
    const secondaryTarget = host.querySelector('[data-testid="secondary-target"]') as HTMLElement | null;
    expect(widgetHeader).toBeTruthy();
    expect(nativeButtonLabel).toBeTruthy();
    expect(nativeInput).toBeTruthy();
    expect(localSurface).toBeTruthy();
    expect(secondaryTarget).toBeTruthy();

    dispatchPointerEvent('pointerdown', widgetHeader!);
    dispatchPointerEvent('pointerdown', nativeButtonLabel!);
    dispatchPointerEvent('pointerdown', nativeInput!);
    dispatchPointerEvent('pointerdown', localSurface!);
    dispatchPointerEvent('pointerdown', secondaryTarget!, { button: 2, buttons: 2 });
    await Promise.resolve();

    expect(onActivation).not.toHaveBeenCalled();
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
