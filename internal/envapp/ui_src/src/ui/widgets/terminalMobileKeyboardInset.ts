export interface TerminalMobileKeyboardInsetOptions {
  viewportEl: HTMLElement | null | undefined;
  keyboardEl: HTMLElement | null | undefined;
}

function isFiniteRect(rect: DOMRect | DOMRectReadOnly): boolean {
  return Number.isFinite(rect.top)
    && Number.isFinite(rect.bottom)
    && Number.isFinite(rect.left)
    && Number.isFinite(rect.right);
}

export function resolveTerminalMobileKeyboardInsetPx(
  options: TerminalMobileKeyboardInsetOptions,
): number {
  const { viewportEl, keyboardEl } = options;
  if (!(viewportEl instanceof HTMLElement) || !(keyboardEl instanceof HTMLElement)) {
    return 0;
  }

  const viewportRect = viewportEl.getBoundingClientRect();
  const keyboardRect = keyboardEl.getBoundingClientRect();
  if (!isFiniteRect(viewportRect) || !isFiniteRect(keyboardRect)) {
    return 0;
  }

  const overlapTop = Math.max(viewportRect.top, keyboardRect.top);
  const overlapBottom = Math.min(viewportRect.bottom, keyboardRect.bottom);
  if (overlapBottom <= overlapTop) {
    return 0;
  }

  return Math.max(0, Math.ceil(overlapBottom - overlapTop));
}
