// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedevenWorkbenchWidget } from './RedevenWorkbenchWidget';
import {
  FLOE_DIALOG_SURFACE_HOST_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
} from './workbenchInputRouting';

function dispatchPointerDown(target: EventTarget): void {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor('pointerdown', {
    bubbles: true,
    button: 0,
  });
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', { configurable: true, value: 1 });
  }
  target.dispatchEvent(event);
}

describe('RedevenWorkbenchWidget', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  it('keeps local body presses component-owned while shell presses still focus the widget root', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onSelect = vi.fn();
    const onCommitFront = vi.fn();

    dispose = render(() => (
      <RedevenWorkbenchWidget
        definition={{
          icon: () => <svg aria-hidden="true" />,
          body: () => <div data-testid="widget-body">Body</div>,
        } as any}
        widgetId="widget-files-1"
        widgetTitle="Files"
        widgetType={'redeven.files' as any}
        x={0}
        y={0}
        width={480}
        height={320}
        renderLayer={1}
        itemSnapshot={() => ({
          id: 'widget-files-1',
          type: 'redeven.files',
          title: 'Files',
          x: 0,
          y: 0,
          width: 480,
          height: 320,
          z_index: 1,
          created_at_unix_ms: 1,
        } as any)}
        selected={false}
        optimisticFront={false}
        topRenderLayer={1}
        viewportScale={1}
        locked={false}
        filtered={false}
        onSelect={onSelect}
        onContextMenu={() => {}}
        onStartOptimisticFront={() => {}}
        onCommitFront={onCommitFront}
        onCommitMove={() => {}}
        onCommitResize={() => {}}
        onRequestDelete={() => {}}
      />
    ), host);

    const widgetRoot = host.querySelector(`[${REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR}="true"]`) as HTMLElement | null;
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

    dispatchPointerDown(widgetBody!);
    await Promise.resolve();

    expect(document.activeElement).toBe(outsideInput);
    expect(onSelect).toHaveBeenCalledWith('widget-files-1');
    expect(onCommitFront).toHaveBeenCalledWith('widget-files-1');

    dispatchPointerDown(widgetHeader!);
    await Promise.resolve();

    expect(document.activeElement).toBe(widgetRoot);
  });
});
