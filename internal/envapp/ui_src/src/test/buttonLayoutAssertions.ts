import { expect } from 'vitest';

/** Measure rendered labels, including native controls and nested loading labels. */
export function expectSingleLineButtonLabels(root: Element) {
  for (const button of root.querySelectorAll('button')) {
    if (!button.checkVisibility()) continue;
    const walker = root.ownerDocument.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement!;
      if (!node.textContent?.trim() || !parent.checkVisibility({ visibilityProperty: true }) || parent.closest('[aria-hidden="true"]')) continue;
      const range = root.ownerDocument.createRange();
      range.selectNodeContents(node);
      const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => rect.top));
      expect(lines.size, `${node.textContent} must stay on one line`).toBeLessThanOrEqual(1);
    }
  }
}
