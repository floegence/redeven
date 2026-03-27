// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitVirtualTable } from './GitVirtualTable';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('GitVirtualTable', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('renders only the visible window and updates rows after scrolling', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const items = Array.from({ length: 100 }, (_, index) => `item-${index}`);
    const dispose = render(() => (
      <div class="h-[240px]">
        <GitVirtualTable
          items={items}
          colSpan={1}
          rowHeight={40}
          overscan={2}
          tableClass="min-w-full"
          viewportClass="git-virtual-table-test"
          header={<tr><th>Item</th></tr>}
          renderRow={(item) => (
            <tr>
              <td>
                <button type="button">{item}</button>
              </td>
            </tr>
          )}
        />
      </div>
    ), host);

    try {
      const viewport = host.querySelector('.git-virtual-table-test') as HTMLDivElement | null;
      expect(viewport).toBeTruthy();

      Object.defineProperty(viewport!, 'clientHeight', {
        configurable: true,
        value: 200,
      });

      window.dispatchEvent(new Event('resize'));
      await flush();

      expect(host.textContent).toContain('item-0');
      expect(host.textContent).toContain('item-8');
      expect(host.textContent).not.toContain('item-20');
      expect(host.querySelectorAll('button')).toHaveLength(9);

      viewport!.scrollTop = 40 * 30;
      viewport!.dispatchEvent(new Event('scroll'));
      await flush();

      expect(host.textContent).toContain('item-28');
      expect(host.textContent).toContain('item-36');
      expect(host.textContent).not.toContain('item-0');
      expect(host.querySelectorAll('button')).toHaveLength(9);
    } finally {
      dispose();
    }
  });

  it('uses totalCount to preserve virtual scroll height for partially loaded pages', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const items = Array.from({ length: 20 }, (_, index) => `item-${index}`);
    const dispose = render(() => (
      <div class="h-[240px]">
        <GitVirtualTable
          items={items}
          totalCount={100}
          colSpan={1}
          rowHeight={40}
          overscan={2}
          tableClass="min-w-full"
          viewportClass="git-virtual-table-partial-test"
          header={<tr><th>Item</th></tr>}
          renderRow={(item) => (
            <tr>
              <td>
                <button type="button">{item}</button>
              </td>
            </tr>
          )}
        />
      </div>
    ), host);

    try {
      const viewport = host.querySelector('.git-virtual-table-partial-test') as HTMLDivElement | null;
      expect(viewport).toBeTruthy();

      Object.defineProperty(viewport!, 'clientHeight', {
        configurable: true,
        value: 200,
      });

      window.dispatchEvent(new Event('resize'));
      await flush();

      let spacers = Array.from(host.querySelectorAll('tr[aria-hidden="true"] td')) as HTMLTableCellElement[];
      expect(spacers).toHaveLength(1);
      expect(spacers[0]?.style.height).toBe('3640px');
      expect(host.querySelectorAll('button')).toHaveLength(9);

      viewport!.scrollTop = 40 * 30;
      viewport!.dispatchEvent(new Event('scroll'));
      await flush();

      spacers = Array.from(host.querySelectorAll('tr[aria-hidden="true"] td')) as HTMLTableCellElement[];
      expect(spacers).toHaveLength(2);
      expect(spacers[0]?.style.height).toBe('1120px');
      expect(spacers[1]?.style.height).toBe('2880px');
      expect(host.querySelectorAll('button')).toHaveLength(0);
    } finally {
      dispose();
    }
  });
});
