// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_INTERACTION_SURFACE_ATTR } from '@floegence/floe-webapp-core/ui';

import {
  INITIAL_WORKBENCH_INPUT_OWNER,
  REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
  WORKBENCH_WIDGET_SHELL_ATTR,
  createWidgetInputOwner,
  focusWorkbenchWidgetElement,
  resolveRedevenWorkbenchWidgetEventOwnership,
  resolveWorkbenchSurfaceTargetRole,
  resolveWorkbenchWheelRouting,
  shouldBypassWorkbenchGlobalHotkeys,
} from './workbenchInputRouting';
import {
  REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR,
} from './workbenchWheelInteractive';

describe('workbenchInputRouting', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps ordinary interactive widget regions zoomable until they opt into local wheel ownership', () => {
    const widget = document.createElement('article');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-files-1');

    const body = document.createElement('div');
    body.setAttribute('data-floe-canvas-interactive', 'true');
    widget.appendChild(body);
    document.body.appendChild(widget);

    expect(resolveWorkbenchWheelRouting({
      target: body,
      disablePanZoom: false,
    })).toEqual({ kind: 'canvas_zoom' });
  });

  it('routes wheel events to local consumers when a widget region explicitly opts into wheel ownership', () => {
    const widget = document.createElement('article');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-files-1');

    const wheelRegion = document.createElement('div');
    wheelRegion.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');
    const button = document.createElement('button');
    wheelRegion.appendChild(button);
    widget.appendChild(wheelRegion);
    document.body.appendChild(widget);

    expect(resolveWorkbenchWheelRouting({
      target: button,
      disablePanZoom: false,
    })).toEqual({ kind: 'local_surface', reason: 'wheel_interactive' });
  });

  it('treats local dialog overlay surfaces inside a widget host as local surfaces', () => {
    const widget = document.createElement('article');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-files-1');

    const overlayRoot = document.createElement('div');
    overlayRoot.setAttribute(LOCAL_INTERACTION_SURFACE_ATTR, 'true');
    const dialogAction = document.createElement('button');
    overlayRoot.appendChild(dialogAction);
    widget.appendChild(overlayRoot);
    document.body.appendChild(widget);

    expect(resolveWorkbenchSurfaceTargetRole({
      target: dialogAction,
      interactiveSelector: '[data-floe-canvas-interactive="true"]',
      panSurfaceSelector: '[data-floe-canvas-pan-surface="true"]',
    })).toBe('local_surface');

    expect(resolveWorkbenchWheelRouting({
      target: dialogAction,
      disablePanZoom: false,
    })).toEqual({ kind: 'local_surface', reason: 'local_interaction_surface' });
  });

  it('distinguishes shell-owned widget chrome from widget-local interaction surfaces', () => {
    const widget = document.createElement('article');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-files-1');

    const header = document.createElement('header');
    header.setAttribute(WORKBENCH_WIDGET_SHELL_ATTR, 'true');
    const title = document.createElement('span');
    header.appendChild(title);

    const body = document.createElement('div');
    body.setAttribute('data-floe-canvas-interactive', 'true');
    const button = document.createElement('button');
    body.appendChild(button);

    widget.appendChild(header);
    widget.appendChild(body);
    document.body.appendChild(widget);

    expect(resolveRedevenWorkbenchWidgetEventOwnership({
      target: title,
      widgetRoot: widget,
    })).toBe('widget_shell');

    expect(resolveRedevenWorkbenchWidgetEventOwnership({
      target: button,
      widgetRoot: widget,
    })).toBe('widget_local');
  });

  it('keeps blank canvas wheel gestures as canvas zoom when pan/zoom is enabled', () => {
    const canvasBackground = document.createElement('div');
    document.body.appendChild(canvasBackground);

    expect(resolveWorkbenchWheelRouting({
      target: canvasBackground,
      disablePanZoom: false,
    })).toEqual({ kind: 'canvas_zoom' });
  });

  it('stops turning blank canvas wheel gestures into zoom when the canvas is locked', () => {
    const canvasBackground = document.createElement('div');
    document.body.appendChild(canvasBackground);

    expect(resolveWorkbenchWheelRouting({
      target: canvasBackground,
      disablePanZoom: true,
    })).toEqual({ kind: 'ignore', reason: 'pan_zoom_disabled' });
  });

  it('focuses the resolved widget root and uses that focus to bypass global widget navigation hotkeys', () => {
    const root = document.createElement('div');
    const widget = document.createElement('article');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-ai-1');
    widget.tabIndex = 0;
    root.appendChild(widget);
    document.body.appendChild(root);

    expect(focusWorkbenchWidgetElement(root, 'widget-ai-1')).toBe(true);
    expect(document.activeElement).toBe(widget);

    expect(shouldBypassWorkbenchGlobalHotkeys({
      root,
      target: document.body,
      owner: createWidgetInputOwner('widget-ai-1', 'activation'),
      interactiveSelector: '[data-floe-canvas-interactive="true"]',
    })).toBe(true);

    expect(shouldBypassWorkbenchGlobalHotkeys({
      root,
      target: document.body,
      owner: INITIAL_WORKBENCH_INPUT_OWNER,
      interactiveSelector: '[data-floe-canvas-interactive="true"]',
    })).toBe(false);
  });
});
