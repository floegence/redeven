import {
  LOCAL_INTERACTION_SURFACE_ATTR,
  WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR,
} from '@floegence/floe-webapp-core/ui';

import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from './workbenchWheelInteractive';

export const REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR =
  'data-redeven-workbench-text-selection-surface';
export const REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_SELECTOR =
  `[${REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR}="true"]`;

export const REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS = {
  [LOCAL_INTERACTION_SURFACE_ATTR]: 'true',
  [REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR]: 'true',
} as const;

export const REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS = {
  ...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS,
  ...REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS,
} as const;

function resolveElement(target: Element | EventTarget | null): Element | null {
  if (typeof Element !== 'undefined' && target instanceof Element) {
    return target;
  }
  if (typeof Node !== 'undefined' && target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

function isTypingElement(element: Element | null): boolean {
  if (!element || typeof HTMLElement === 'undefined' || !(element instanceof HTMLElement)) {
    return false;
  }

  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (element.isContentEditable) return true;
  if (element.getAttribute('role') === 'textbox') return true;
  return false;
}

function isFocusableElement(element: Element | null): boolean {
  if (!element || typeof HTMLElement === 'undefined' || !(element instanceof HTMLElement)) {
    return false;
  }

  if (element.matches('button, input, select, textarea, summary')) return true;
  if (element.matches('a[href], area[href]')) return true;
  if (element.matches('iframe, [contenteditable="true"]')) return true;

  const tabIndex = element.getAttribute('tabindex');
  return tabIndex !== null && tabIndex !== '-1';
}

function isNativeTextSelectionBlockedElement(element: Element | null): boolean {
  if (!element || typeof HTMLElement === 'undefined' || !(element instanceof HTMLElement)) {
    return false;
  }

  if (isTypingElement(element)) return true;
  if (element.matches('button, summary')) return true;
  if (element.matches('a[href], area[href]')) return true;

  const role = element.getAttribute('role');
  if (
    role === 'button'
    || role === 'link'
    || role === 'menuitem'
    || role === 'option'
    || role === 'switch'
    || role === 'tab'
    || role === 'checkbox'
    || role === 'radio'
  ) {
    return true;
  }

  return isFocusableElement(element);
}

function hasDirectSelectableTextNode(element: Element): boolean {
  if (typeof Node === 'undefined') return false;

  for (const childNode of element.childNodes) {
    if (childNode.nodeType !== Node.TEXT_NODE) continue;
    if (childNode.textContent?.trim()) {
      return true;
    }
  }

  return false;
}

function supportsNativeTextSelection(element: Element): boolean {
  if (typeof window === 'undefined' || !(element instanceof HTMLElement)) {
    return hasDirectSelectableTextNode(element);
  }

  const style = window.getComputedStyle(element);
  if (style.pointerEvents === 'none') {
    return false;
  }

  if (hasDirectSelectableTextNode(element)) {
    return true;
  }

  return style.cursor === 'text' && Boolean(element.textContent?.trim());
}

export function resolveWorkbenchTextSelectionSurfaceTarget(args: {
  target: EventTarget | null;
  widgetRoot: Element | EventTarget | null;
}): HTMLElement | null {
  const widgetElement = resolveElement(args.widgetRoot);
  const targetElement = resolveElement(args.target);
  if (!widgetElement || !targetElement || !widgetElement.contains(targetElement)) {
    return null;
  }

  const explicitSurface = targetElement.closest(REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_SELECTOR);
  if (explicitSurface instanceof HTMLElement && widgetElement.contains(explicitSurface)) {
    return explicitSurface;
  }

  if (targetElement.closest(`[${LOCAL_INTERACTION_SURFACE_ATTR}="true"]`) !== null) {
    return null;
  }

  if (
    targetElement.closest(`[${WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR}="true"]`) !== null
  ) {
    return null;
  }

  let currentElement: Element | null = targetElement;
  while (currentElement && currentElement !== widgetElement) {
    if (isTypingElement(currentElement)) {
      return null;
    }

    if (supportsNativeTextSelection(currentElement) && currentElement instanceof HTMLElement) {
      return currentElement;
    }

    if (isNativeTextSelectionBlockedElement(currentElement)) {
      return null;
    }

    currentElement = currentElement.parentElement;
  }

  return null;
}

export function ensureWorkbenchTextSelectionSurfaceContract(args: {
  target: EventTarget | null;
  widgetRoot: Element | EventTarget | null;
}): HTMLElement | null {
  const surface = resolveWorkbenchTextSelectionSurfaceTarget(args);
  if (!surface) {
    return null;
  }

  surface.setAttribute(LOCAL_INTERACTION_SURFACE_ATTR, 'true');
  surface.setAttribute(REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_ATTR, 'true');
  return surface;
}
