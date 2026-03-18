// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

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
  const originalInnerHeight = window.innerHeight;

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
  });

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

  it('uses the keyboard target occupied rect instead of the animated current rect during reopen', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 372,
    });

    const viewportEl = document.createElement('div');
    const keyboardEl = document.createElement('div');
    keyboardEl.style.setProperty('--mobile-keyboard-viewport-left', '0px');
    keyboardEl.style.setProperty('--mobile-keyboard-viewport-bottom', '0px');
    keyboardEl.style.setProperty('--mobile-keyboard-viewport-width', '320px');
    mockRect(viewportEl, { top: 24, bottom: 320, left: 0, width: 320 });
    mockRect(keyboardEl, { top: 372, bottom: 504, left: 0, width: 320, height: 132 });

    expect(resolveTerminalMobileKeyboardInsetPx({ viewportEl, keyboardEl })).toBe(80);
  });
});
