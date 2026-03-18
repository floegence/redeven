// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { resolveTerminalMobileKeyboardInsetPx } from './terminalMobileKeyboardInset';

function mockRect(
  element: HTMLElement,
  rect: { top: number; bottom: number; left?: number; right?: number; width?: number; height?: number },
) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left ?? 0,
      right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 0),
      width: rect.width ?? Math.max(0, (rect.right ?? 0) - (rect.left ?? 0)),
      height: rect.height ?? Math.max(0, rect.bottom - rect.top),
      x: rect.left ?? 0,
      y: rect.top,
      toJSON: () => undefined,
    }),
  });
}

describe('resolveTerminalMobileKeyboardInsetPx', () => {
  it('returns the overlap height between the viewport and keyboard', () => {
    const viewportEl = document.createElement('div');
    const keyboardEl = document.createElement('div');
    mockRect(viewportEl, { top: 24, bottom: 312, left: 0, width: 320 });
    mockRect(keyboardEl, { top: 244, bottom: 372, left: 0, width: 320 });

    expect(resolveTerminalMobileKeyboardInsetPx({ viewportEl, keyboardEl })).toBe(68);
  });

  it('returns zero when the keyboard does not overlap the viewport', () => {
    const viewportEl = document.createElement('div');
    const keyboardEl = document.createElement('div');
    mockRect(viewportEl, { top: 24, bottom: 180, left: 0, width: 320 });
    mockRect(keyboardEl, { top: 244, bottom: 372, left: 0, width: 320 });

    expect(resolveTerminalMobileKeyboardInsetPx({ viewportEl, keyboardEl })).toBe(0);
  });

  it('returns zero when elements are missing', () => {
    expect(resolveTerminalMobileKeyboardInsetPx({ viewportEl: null, keyboardEl: null })).toBe(0);
  });
});
