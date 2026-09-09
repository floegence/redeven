import { expect } from 'vitest';

function paintedShadow(value: string): string {
  // Tailwind ring-0 may serialize zero-area shadows instead of `none`.
  const lengths = value.replace(/rgba?\([^)]*\)|color\([^)]*\)/g, '').match(/-?[\d.]+px/g) ?? [];
  return lengths.length && lengths.every(length => Number.parseFloat(length) === 0) ? 'none' : value;
}

function snapshot(element: HTMLElement) {
  const style = getComputedStyle(element);
  return {
    width: element.offsetWidth, height: element.offsetHeight,
    border: style.borderWidth, padding: style.padding,
    shadow: paintedShadow(style.boxShadow), background: style.backgroundColor,
    outline: style.outlineStyle, outlineWidth: style.outlineWidth,
    color: style.borderColor,
  };
}

export function expectSingleInputFocus(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const owner = input.closest<HTMLElement>('[data-floe-input-surface]') ?? input;
  const style = document.createElement('style');
  style.textContent = 'input,textarea,select,[data-floe-input-surface] { transition: none !important; }';
  document.head.appendChild(style);
  try {
    (document.activeElement as HTMLElement | null)?.blur();
    const before = snapshot(owner), innerBefore = snapshot(input);
    input.focus();
    const after = snapshot(owner), innerAfter = snapshot(input);
    const label = input.getAttribute('aria-label') ?? input.className;
    for (const key of ['width', 'height', 'border', 'padding', 'shadow', 'background'] as const) {
      expect(after[key], `${label}: stable ${key}`).toBe(before[key]);
      expect(innerAfter[key], `${label}: stable inner ${key}`).toBe(innerBefore[key]);
    }
    expect(after.outline === 'none' || after.outlineWidth === '0px', `${label}: no outer outline`).toBe(true);
    expect(innerAfter.outline === 'none' || innerAfter.outlineWidth === '0px', `${label}: no inner outline`).toBe(true);
    if (input.disabled) {
      expect(document.activeElement).not.toBe(input);
      expect(after.color).toBe(before.color);
    } else {
      expect(document.activeElement).toBe(input);
      if (owner.getAttribute('aria-invalid') !== 'true' && input.getAttribute('aria-invalid') !== 'true') {
        expect(after.color, `${label}: visible focus border`).not.toBe(before.color);
      }
    }
    if (owner !== input) expect(innerAfter.border, `${label}: frameless inner editor`).toBe('0px');
  } finally { style.remove(); }
}
