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
  redevenWorkbenchInteractionAdapter,
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

  it('keeps selected widget bodies zoomable until they expose a local wheel viewport', () => {
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
      selectedWidgetId: 'widget-files-1',
    })).toEqual({ kind: 'canvas_zoom' });

    expect(resolveWorkbenchWheelRouting({
      target: body,
      disablePanZoom: true,
      selectedWidgetId: 'widget-files-1',
    })).toEqual({ kind: 'ignore', reason: 'pan_zoom_disabled' });
  });

  it('keeps ordinary widget regions zoomable until their widget is selected', () => {
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
      selectedWidgetId: 'widget-terminal-1',
    })).toEqual({ kind: 'canvas_zoom' });
  });

  it('keeps widget-local wheel markers on canvas until their widget is selected', () => {
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
      selectedWidgetId: 'widget-terminal-1',
    })).toEqual({ kind: 'canvas_zoom' });
  });

  it('keeps canvas ownership when another widget is selected and the pointer hovers a different widget', () => {
    const selectedWidget = document.createElement('article');
    selectedWidget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    selectedWidget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-terminal-1');

    const hoveredWidget = document.createElement('article');
    hoveredWidget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    hoveredWidget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-files-1');

    const wheelRegion = document.createElement('div');
    wheelRegion.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');
    hoveredWidget.appendChild(wheelRegion);
    document.body.append(selectedWidget, hoveredWidget);

    expect(resolveWorkbenchWheelRouting({
      target: wheelRegion,
      disablePanZoom: false,
      selectedWidgetId: 'widget-terminal-1',
    })).toEqual({ kind: 'canvas_zoom' });
  });

  it('does not treat the selected widget root marker as a real local wheel viewport', () => {
    const widget = document.createElement('article');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-files-1');
    widget.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');

    const body = document.createElement('div');
    body.setAttribute('data-floe-canvas-interactive', 'true');
    widget.appendChild(body);
    document.body.appendChild(widget);

    expect(resolveWorkbenchWheelRouting({
      target: body,
      disablePanZoom: false,
      selectedWidgetId: 'widget-files-1',
    })).toEqual({ kind: 'canvas_zoom' });
  });

  it('keeps explicit wheel viewports inside the selected widget local', () => {
    const widget = document.createElement('article');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-files-1');
    widget.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');

    const wheelViewport = document.createElement('div');
    wheelViewport.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');
    const row = document.createElement('div');
    wheelViewport.appendChild(row);
    widget.appendChild(wheelViewport);
    document.body.appendChild(widget);

    expect(resolveWorkbenchWheelRouting({
      target: row,
      disablePanZoom: false,
      selectedWidgetId: 'widget-files-1',
    })).toEqual({ kind: 'local_surface', reason: 'wheel_interactive' });
  });

  it('keeps explicit non-widget wheel consumers local', () => {
    const wheelRegion = document.createElement('div');
    wheelRegion.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');
    const button = document.createElement('button');
    wheelRegion.appendChild(button);
    document.body.appendChild(wheelRegion);

    expect(resolveWorkbenchWheelRouting({
      target: button,
      disablePanZoom: false,
      selectedWidgetId: 'widget-terminal-1',
    })).toEqual({ kind: 'local_surface', reason: 'wheel_interactive' });
  });

  it('keeps local dialog overlays inside the selected widget boundary local', () => {
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
      selectedWidgetId: 'widget-files-1',
    })).toEqual({ kind: 'local_surface', reason: 'local_interaction_surface' });

    expect(resolveWorkbenchWheelRouting({
      target: dialogAction,
      disablePanZoom: false,
      selectedWidgetId: null,
    })).toEqual({ kind: 'canvas_zoom' });
  });

  it('routes selected terminal wheels to canvas while terminal focus is elsewhere', () => {
    const widget = document.createElement('article');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-terminal-1');
    widget.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');

    const terminalSurface = document.createElement('div');
    terminalSurface.className = 'redeven-terminal-surface';
    terminalSurface.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');
    widget.appendChild(terminalSurface);
    document.body.appendChild(widget);

    expect(resolveWorkbenchWheelRouting({
      target: terminalSurface,
      disablePanZoom: false,
      selectedWidgetId: 'widget-terminal-1',
    })).toEqual({ kind: 'canvas_zoom' });
  });

  it('keeps selected terminal wheels local only while focus is inside the terminal surface', () => {
    const widget = document.createElement('article');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR, 'true');
    widget.setAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR, 'widget-terminal-1');
    widget.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');

    const terminalSurface = document.createElement('div');
    terminalSurface.className = 'redeven-terminal-surface';
    terminalSurface.setAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR, 'true');
    const textarea = document.createElement('textarea');
    terminalSurface.appendChild(textarea);
    widget.appendChild(terminalSurface);
    document.body.appendChild(widget);

    textarea.focus();

    expect(resolveWorkbenchWheelRouting({
      target: terminalSurface,
      disablePanZoom: false,
      selectedWidgetId: 'widget-terminal-1',
    })).toEqual({ kind: 'local_surface', reason: 'wheel_interactive' });
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

  it('exposes the Redeven interaction adapter contract for the shared surface', () => {
    expect(redevenWorkbenchInteractionAdapter.surfaceRootAttr).toBe('data-redeven-workbench-surface-root');
    expect(redevenWorkbenchInteractionAdapter.widgetRootAttr).toBe(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR);
    expect(redevenWorkbenchInteractionAdapter.widgetIdAttr).toBe(REDEVEN_WORKBENCH_WIDGET_ID_ATTR);
  });
});
