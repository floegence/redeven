// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

import { CompactContextSummary } from './AIContextSummary';

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

async function flushPositioning(): Promise<void> {
  await Promise.resolve();
  vi.runAllTimers();
  await Promise.resolve();
}

describe('CompactContextSummary', () => {
  let anchorRect = makeRect(240, 48, 96, 32);
  let panelRect = makeRect(0, 0, 384, 240);

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: Element) {
      const element = this as HTMLElement;
      if (element.hasAttribute('data-context-summary-anchor')) return anchorRect;
      if (element.hasAttribute('data-context-summary-popover')) return panelRect;
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

  it('renders the details popover through document.body instead of inside the toolbar lane', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <div class="flower-chat-toolbar-lane">
        <CompactContextSummary usage={null} compactions={[]} />
      </div>
    ), host);

    try {
      const button = host.querySelector('[data-context-summary-anchor]') as HTMLButtonElement | null;
      expect(button).toBeTruthy();

      button!.click();
      await flushPositioning();

      const dialog = document.body.querySelector('[data-context-summary-popover]') as HTMLElement | null;
      expect(dialog).toBeTruthy();
      expect(dialog?.textContent).toContain('Context');
      expect(dialog?.textContent).toContain('No context usage telemetry yet.');
      expect(host.querySelector('[data-context-summary-popover]')).toBeNull();
      expect(dialog?.style.visibility).toBe('visible');
    } finally {
      dispose();
    }
  });
});
