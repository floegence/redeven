// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { Tooltip } from './Tooltip';

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

async function flushPositioning() {
  await Promise.resolve();
  vi.runAllTimers();
  await Promise.resolve();
}

describe('Tooltip', () => {
  let anchorRect = makeRect(240, 48, 80, 32);
  let tooltipRect = makeRect(0, 0, 120, 40);

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: Element) {
      const element = this as HTMLElement;
      if (element.hasAttribute('data-redeven-tooltip-anchor')) return anchorRect;
      if (element.getAttribute('role') === 'tooltip') return tooltipRect;
      return makeRect(0, 0, 0, 0);
    });
    vi.stubGlobal('requestAnimationFrame', (((callback: FrameRequestCallback) => window.setTimeout(() => callback(16), 0)) as unknown as typeof requestAnimationFrame));
    vi.stubGlobal('cancelAnimationFrame', (((handle: number) => window.clearTimeout(handle)) as unknown as typeof cancelAnimationFrame));
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('renders the floating layer through document.body instead of the local trigger subtree', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <Tooltip content="Delete blocked" delay={0}>
        <button type="button">Delete</button>
      </Tooltip>
    ), host);

    try {
      const anchor = host.querySelector('[data-redeven-tooltip-anchor]') as HTMLElement | null;
      expect(anchor).toBeTruthy();

      anchor!.dispatchEvent(new MouseEvent('mouseenter'));
      await flushPositioning();

      const tooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
      expect(tooltip).toBeTruthy();
      expect(tooltip?.textContent).toContain('Delete blocked');
      expect(host.querySelector('[role="tooltip"]')).toBeNull();
      expect(tooltip?.style.visibility).toBe('visible');
      expect(tooltip?.className).toContain('text-popover-foreground');
      expect(tooltip?.className).toContain('redeven-surface-overlay');
    } finally {
      dispose();
    }
  });

  it('flips to the opposite side when the preferred placement does not fit', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    anchorRect = makeRect(240, 4, 80, 32);

    const dispose = render(() => (
      <Tooltip content="Blocked" placement="top" delay={0}>
        <button type="button">Delete</button>
      </Tooltip>
    ), host);

    try {
      const anchor = host.querySelector('[data-redeven-tooltip-anchor]') as HTMLElement | null;
      expect(anchor).toBeTruthy();

      anchor!.dispatchEvent(new MouseEvent('mouseenter'));
      await flushPositioning();

      const tooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
      expect(tooltip?.getAttribute('data-placement')).toBe('bottom');
    } finally {
      dispose();
    }
  });
});
