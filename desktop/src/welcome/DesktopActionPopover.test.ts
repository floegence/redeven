import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readDesktopActionPopoverSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopActionPopover.tsx'), 'utf8');
}

describe('DesktopActionPopover', () => {
  it('uses click and keyboard dismissal instead of hover or focusout-driven visibility', () => {
    const source = readDesktopActionPopoverSource();

    expect(source).toContain('data-redeven-action-popover-anchor=""');
    expect(source).toContain('requestAnimationFrame(() => {');
    expect(source).toContain('firstFocusableElement(popoverRef)?.focus();');
    expect(source).toContain("document.addEventListener('mousedown', handlePointerDown);");
    expect(source).toContain("document.addEventListener('keydown', handleKeyDown);");
    expect(source).toContain("document.addEventListener('focusin', handleFocusIn);");
    expect(source).toContain("event.key === 'Escape'");
    expect(source).not.toContain('onMouseEnter={');
    expect(source).not.toContain('onMouseLeave={');
    expect(source).not.toContain('onFocusOut={');
  });
});
