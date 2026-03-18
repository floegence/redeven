export interface TerminalMobileKeyboardInsetOptions {
  viewportEl: HTMLElement | null | undefined;
  keyboardEl: HTMLElement | null | undefined;
}

interface KeyboardRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

function isFiniteRect(rect: DOMRect | DOMRectReadOnly): boolean {
  return Number.isFinite(rect.top)
    && Number.isFinite(rect.bottom)
    && Number.isFinite(rect.left)
    && Number.isFinite(rect.right);
}

function parseCssPx(value: string | null | undefined): number | null {
  if (!value) return null;
  const next = Number.parseFloat(value);
  return Number.isFinite(next) ? next : null;
}

function resolveLayoutViewportHeightPx(): number | null {
  if (typeof window !== 'undefined' && Number.isFinite(window.innerHeight) && window.innerHeight > 0) {
    return window.innerHeight;
  }
  if (typeof document !== 'undefined' && Number.isFinite(document.documentElement.clientHeight) && document.documentElement.clientHeight > 0) {
    return document.documentElement.clientHeight;
  }
  return null;
}

function resolveKeyboardOccupiedRect(keyboardEl: HTMLElement): KeyboardRect | null {
  const currentRect = keyboardEl.getBoundingClientRect();
  if (!isFiniteRect(currentRect)) {
    return null;
  }

  const style = getComputedStyle(keyboardEl);
  const layoutViewportHeightPx = resolveLayoutViewportHeightPx();
  const leftPx = parseCssPx(style.getPropertyValue('--mobile-keyboard-viewport-left'))
    ?? parseCssPx(style.left)
    ?? currentRect.left;
  const bottomInsetPx = parseCssPx(style.getPropertyValue('--mobile-keyboard-viewport-bottom'))
    ?? parseCssPx(style.bottom);
  const widthPx = parseCssPx(style.getPropertyValue('--mobile-keyboard-viewport-width'))
    ?? parseCssPx(style.width)
    ?? currentRect.width;
  const heightPx = currentRect.height;

  if (bottomInsetPx === null || layoutViewportHeightPx === null || heightPx <= 0) {
    return {
      top: currentRect.top,
      bottom: currentRect.bottom,
      left: currentRect.left,
      right: currentRect.right,
      width: currentRect.width,
      height: currentRect.height,
    };
  }

  const bottomPx = layoutViewportHeightPx - bottomInsetPx;
  const topPx = bottomPx - heightPx;
  return {
    top: topPx,
    bottom: bottomPx,
    left: leftPx,
    right: leftPx + widthPx,
    width: widthPx,
    height: heightPx,
  };
}

export function resolveTerminalMobileKeyboardInsetPx(
  options: TerminalMobileKeyboardInsetOptions,
): number {
  const { viewportEl, keyboardEl } = options;
  if (!(viewportEl instanceof HTMLElement) || !(keyboardEl instanceof HTMLElement)) {
    return 0;
  }

  const viewportRect = viewportEl.getBoundingClientRect();
  const keyboardRect = resolveKeyboardOccupiedRect(keyboardEl);
  if (!isFiniteRect(viewportRect) || !keyboardRect) {
    return 0;
  }

  const overlapLeft = Math.max(viewportRect.left, keyboardRect.left);
  const overlapRight = Math.min(viewportRect.right, keyboardRect.right);
  if (overlapRight <= overlapLeft) {
    return 0;
  }

  const overlapTop = Math.max(viewportRect.top, keyboardRect.top);
  const overlapBottom = Math.min(viewportRect.bottom, keyboardRect.bottom);
  if (overlapBottom <= overlapTop) {
    return 0;
  }

  return Math.max(0, Math.ceil(overlapBottom - overlapTop));
}
