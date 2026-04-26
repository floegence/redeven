import {
  DEFAULT_LOCAL_INTERACTION_SURFACE_SELECTOR,
  WORKBENCH_WIDGET_SHELL_ATTR,
  resolveSurfaceInteractionTargetRole,
  shouldActivateWorkbenchWidgetLocalTarget,
  resolveWorkbenchWidgetEventOwnership,
  type SurfaceInteractionTargetRole,
  type SurfaceWheelLocalReason,
  type WorkbenchWidgetEventOwnership,
} from '@floegence/floe-webapp-core/ui';
import type { WorkbenchWidgetBodyActivation } from '@floegence/floe-webapp-core/workbench';
import {
  type WorkbenchCanvasOwnerReason,
  type WorkbenchInputOwner,
  type WorkbenchInteractionAdapter,
  type WorkbenchWidgetOwnerReason,
  type WorkbenchWheelRoutingDecision,
} from '@floegence/floe-webapp-core/workbench';

import { REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_SELECTOR } from './workbenchWheelInteractive';

export const REDEVEN_WORKBENCH_SURFACE_ROOT_ATTR = 'data-redeven-workbench-surface-root';
export const REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR = 'data-redeven-workbench-widget-root';
export const REDEVEN_WORKBENCH_WIDGET_ID_ATTR = 'data-redeven-workbench-widget-id';
export const FLOE_DIALOG_SURFACE_HOST_ATTR = 'data-floe-dialog-surface-host';
export const REDEVEN_WORKBENCH_INTERACTIVE_SELECTOR = '[data-floe-canvas-interactive="true"]';
export const REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR = '[data-floe-canvas-pan-surface="true"]';
export const REDEVEN_TERMINAL_WHEEL_SURFACE_SELECTOR = '.redeven-terminal-surface';

export { WORKBENCH_WIDGET_SHELL_ATTR };

export type WorkbenchWheelLocalReason = SurfaceWheelLocalReason;
export type RedevenWorkbenchWidgetBodyActivation = WorkbenchWidgetBodyActivation;

export const INITIAL_WORKBENCH_INPUT_OWNER: WorkbenchInputOwner = {
  kind: 'canvas',
  reason: 'initial',
};

export function createCanvasInputOwner(reason: WorkbenchCanvasOwnerReason): WorkbenchInputOwner {
  return { kind: 'canvas', reason };
}

export function createWidgetInputOwner(
  widgetId: string,
  reason: WorkbenchWidgetOwnerReason,
): WorkbenchInputOwner {
  return { kind: 'widget', widgetId, reason };
}

export function isTypingElement(el: Element | null): boolean {
  if (!el || typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) {
    return false;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute('role') === 'textbox') return true;
  return false;
}

function resolveElement(target: EventTarget | null): Element | null {
  if (typeof Element !== 'undefined' && target instanceof Element) {
    return target;
  }
  if (typeof Node !== 'undefined' && target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

export function findWorkbenchWidgetRoot(target: EventTarget | null): HTMLElement | null {
  const element = resolveElement(target);
  if (!element) {
    return null;
  }

  const widgetRoot = element.closest(`[${REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR}="true"]`);
  return widgetRoot instanceof HTMLElement ? widgetRoot : null;
}

export function readWorkbenchWidgetId(el: Element | null): string | null {
  const widgetId = el?.getAttribute(REDEVEN_WORKBENCH_WIDGET_ID_ATTR) ?? '';
  const trimmed = widgetId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function findRedevenTerminalWheelSurface(target: EventTarget | null): HTMLElement | null {
  const element = resolveElement(target);
  if (!element) return null;

  const surface = element.closest(REDEVEN_TERMINAL_WHEEL_SURFACE_SELECTOR);
  return surface instanceof HTMLElement ? surface : null;
}

export function redevenTerminalWheelSurfaceHasFocus(surface: HTMLElement | null): boolean {
  if (!surface || typeof document === 'undefined') return false;

  const active = document.activeElement;
  return active instanceof Element && surface.contains(active);
}

function isWorkbenchWidgetRootWheelMarker(
  element: Element,
  selectedWidgetId: string | null | undefined,
): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.getAttribute(REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR) !== 'true') return false;
  if (!selectedWidgetId) return false;
  return readWorkbenchWidgetId(element) === selectedWidgetId;
}

function resolveWorkbenchWheelLocalReason(args: {
  target: EventTarget | null;
  selectedWidgetId?: string | null;
  wheelInteractiveSelector: string;
}): WorkbenchWheelLocalReason | null {
  const element = resolveElement(args.target);
  if (!element) return null;

  if (isTypingElement(element)) {
    return 'typing_element';
  }

  if (element.closest(DEFAULT_LOCAL_INTERACTION_SURFACE_SELECTOR) !== null) {
    return 'local_interaction_surface';
  }

  const wheelSurface = element.closest(args.wheelInteractiveSelector);
  if (wheelSurface && !isWorkbenchWidgetRootWheelMarker(wheelSurface, args.selectedWidgetId)) {
    return 'wheel_interactive';
  }

  return null;
}

function createWorkbenchWheelRoutingDecision(args: {
  target: EventTarget | null;
  disablePanZoom: boolean;
  selectedWidgetId?: string | null;
  wheelInteractiveSelector: string;
}): WorkbenchWheelRoutingDecision {
  const localReason = resolveWorkbenchWheelLocalReason(args);
  if (localReason) {
    return { kind: 'local_surface', reason: localReason };
  }

  if (args.disablePanZoom) {
    return { kind: 'ignore', reason: 'pan_zoom_disabled' };
  }

  return { kind: 'canvas_zoom' };
}

export function findWorkbenchWidgetElement(
  root: ParentNode | null | undefined,
  widgetId: string,
): HTMLElement | null {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return null;
  }

  const widgetRoots = root.querySelectorAll(`[${REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR}="true"]`);
  for (const widgetRoot of widgetRoots) {
    if (!(widgetRoot instanceof HTMLElement)) continue;
    if (readWorkbenchWidgetId(widgetRoot) === widgetId) {
      return widgetRoot;
    }
  }

  return null;
}

export function focusWorkbenchWidgetElement(
  root: ParentNode | null | undefined,
  widgetId: string,
): boolean {
  const widgetRoot = findWorkbenchWidgetElement(root, widgetId);
  if (!widgetRoot) {
    return false;
  }

  widgetRoot.focus({ preventScroll: true });
  return true;
}

export function resolveWorkbenchSurfaceTargetRole(args: {
  target: EventTarget | null;
  interactiveSelector: string;
  panSurfaceSelector: string;
}): SurfaceInteractionTargetRole {
  const role = resolveSurfaceInteractionTargetRole({
    target: args.target,
    interactiveSelector: args.interactiveSelector,
    panSurfaceSelector: args.panSurfaceSelector,
  });
  if (role !== 'canvas') {
    return role;
  }

  return findWorkbenchWidgetRoot(args.target) !== null ? 'local_surface' : 'canvas';
}

export function resolveRedevenWorkbenchWidgetEventOwnership(args: {
  target: EventTarget | null;
  widgetRoot: Element | EventTarget | null;
}): WorkbenchWidgetEventOwnership {
  return resolveWorkbenchWidgetEventOwnership({
    target: args.target,
    widgetRoot: args.widgetRoot,
    interactiveSelector: REDEVEN_WORKBENCH_INTERACTIVE_SELECTOR,
    panSurfaceSelector: REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR,
  });
}

export function shouldActivateRedevenWorkbenchWidgetLocalTarget(args: {
  target: EventTarget | null;
  widgetRoot: Element | EventTarget | null;
}): boolean {
  return shouldActivateWorkbenchWidgetLocalTarget({
    target: args.target,
    widgetRoot: args.widgetRoot,
    interactiveSelector: REDEVEN_WORKBENCH_INTERACTIVE_SELECTOR,
    panSurfaceSelector: REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR,
    localInteractionSurfaceSelector: DEFAULT_LOCAL_INTERACTION_SURFACE_SELECTOR,
    shellSelector: `[${WORKBENCH_WIDGET_SHELL_ATTR}="true"]`,
  });
}

export function resolveWorkbenchWheelRouting(args: {
  target: EventTarget | null;
  disablePanZoom: boolean;
  selectedWidgetId?: string | null;
  wheelInteractiveSelector?: string;
}): WorkbenchWheelRoutingDecision {
  const wheelInteractiveSelector =
    args.wheelInteractiveSelector ?? REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_SELECTOR;
  const widgetRoot = findWorkbenchWidgetRoot(args.target);
  if (widgetRoot) {
    const ownerWidgetId = readWorkbenchWidgetId(widgetRoot);
    if (ownerWidgetId !== null && ownerWidgetId === args.selectedWidgetId) {
      const terminalSurface = findRedevenTerminalWheelSurface(args.target);
      if (terminalSurface && !redevenTerminalWheelSurfaceHasFocus(terminalSurface)) {
        return args.disablePanZoom
          ? { kind: 'ignore', reason: 'pan_zoom_disabled' }
          : { kind: 'canvas_zoom' };
      }

      return createWorkbenchWheelRoutingDecision({
        target: args.target,
        disablePanZoom: args.disablePanZoom,
        selectedWidgetId: args.selectedWidgetId,
        wheelInteractiveSelector,
      });
    }
    if (args.disablePanZoom) {
      return { kind: 'ignore', reason: 'pan_zoom_disabled' };
    }
    return { kind: 'canvas_zoom' };
  }

  return createWorkbenchWheelRoutingDecision({
    target: args.target,
    disablePanZoom: args.disablePanZoom,
    selectedWidgetId: args.selectedWidgetId,
    wheelInteractiveSelector,
  });
}

export function shouldBypassWorkbenchGlobalHotkeys(args: {
  root: HTMLElement | null | undefined;
  target: EventTarget | null;
  owner: WorkbenchInputOwner;
  interactiveSelector: string;
}): boolean {
  const { root, target, owner, interactiveSelector } = args;
  const element = target instanceof Element ? target : null;

  if (isTypingElement(element)) return true;
  if (!root) return false;

  if (element && root.contains(element) && element.closest(interactiveSelector) !== null) {
    return true;
  }

  if (owner.kind !== 'widget') return false;

  const widgetRoot = findWorkbenchWidgetElement(root, owner.widgetId);
  if (!widgetRoot) return false;

  if (element && widgetRoot.contains(element)) {
    return true;
  }

  const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
  return activeElement instanceof Element && widgetRoot.contains(activeElement);
}

export const redevenWorkbenchInteractionAdapter: WorkbenchInteractionAdapter = {
  surfaceRootAttr: REDEVEN_WORKBENCH_SURFACE_ROOT_ATTR,
  widgetRootAttr: REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
  widgetIdAttr: REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  dialogSurfaceHostAttr: FLOE_DIALOG_SURFACE_HOST_ATTR,
  interactiveSelector: REDEVEN_WORKBENCH_INTERACTIVE_SELECTOR,
  panSurfaceSelector: REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR,
  wheelInteractiveSelector: REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_SELECTOR,
  createInitialInputOwner: () => INITIAL_WORKBENCH_INPUT_OWNER,
  createCanvasInputOwner,
  createWidgetInputOwner,
  findWidgetRoot: findWorkbenchWidgetRoot,
  readWidgetId: readWorkbenchWidgetId,
  focusWidgetElement: focusWorkbenchWidgetElement,
  resolveSurfaceTargetRole: resolveWorkbenchSurfaceTargetRole,
  resolveWidgetEventOwnership: ({ target, widgetRoot }) =>
    resolveRedevenWorkbenchWidgetEventOwnership({ target, widgetRoot }),
  resolveWheelRouting: resolveWorkbenchWheelRouting,
  shouldBypassGlobalHotkeys: shouldBypassWorkbenchGlobalHotkeys,
};
