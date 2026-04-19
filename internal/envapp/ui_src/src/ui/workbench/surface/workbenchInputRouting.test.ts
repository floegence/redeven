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

describe('workbenchInputRouting', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('routes wheel events inside a widget subtree to the local surface instead of canvas zoom', () => {
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
      interactiveSelector: '[data-floe-canvas-interactive="true"]',
      panSurfaceSelector: '[data-floe-canvas-pan-surface="true"]',
    })).toEqual({ kind: 'local_surface' });
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
      interactiveSelector: '[data-floe-canvas-interactive="true"]',
      panSurfaceSelector: '[data-floe-canvas-pan-surface="true"]',
    })).toEqual({ kind: 'local_surface' });
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
      interactiveSelector: '[data-floe-canvas-interactive="true"]',
      panSurfaceSelector: '[data-floe-canvas-pan-surface="true"]',
    })).toEqual({ kind: 'canvas_zoom' });
  });

  it('stops turning blank canvas wheel gestures into zoom when the canvas is locked', () => {
    const canvasBackground = document.createElement('div');
    document.body.appendChild(canvasBackground);

    expect(resolveWorkbenchWheelRouting({
      target: canvasBackground,
      disablePanZoom: true,
      interactiveSelector: '[data-floe-canvas-interactive="true"]',
      panSurfaceSelector: '[data-floe-canvas-pan-surface="true"]',
    })).toEqual({ kind: 'ignore' });
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
