// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedevenWorkbenchWidget } from './RedevenWorkbenchWidget';
import {
  FLOE_DIALOG_SURFACE_HOST_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
} from './workbenchInputRouting';

describe('RedevenWorkbenchWidget', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  it('marks the widget root as the local dialog surface host and focuses it from non-focusable presses', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onSelect = vi.fn();

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
        zIndex={1}
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
        topZIndex={1}
        viewportScale={1}
        locked={false}
        filtered={false}
        onSelect={onSelect}
        onContextMenu={() => {}}
        onStartOptimisticFront={() => {}}
        onCommitFront={() => {}}
        onCommitMove={() => {}}
        onCommitResize={() => {}}
        onRequestDelete={() => {}}
      />
    ), host);

    const widgetRoot = host.querySelector(`[${REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR}="true"]`) as HTMLElement | null;
    const widgetBody = host.querySelector('[data-testid="widget-body"]') as HTMLElement | null;
    expect(widgetRoot).toBeTruthy();
    expect(widgetBody).toBeTruthy();
    expect(widgetRoot?.getAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR)).toBe('widget-files-1');
    expect(widgetRoot?.getAttribute(FLOE_DIALOG_SURFACE_HOST_ATTR)).toBe('true');

    widgetBody!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await Promise.resolve();

    expect(document.activeElement).toBe(widgetRoot);
    expect(onSelect).toHaveBeenCalledWith('widget-files-1');
  });
});
