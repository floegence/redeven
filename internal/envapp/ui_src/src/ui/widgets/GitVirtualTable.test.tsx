// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GitVirtualTable } from './GitVirtualTable';

describe('GitVirtualTable', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders every loaded item in order', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const items = Array.from({ length: 12 }, (_, index) => `item-${index}`);
    const dispose = render(() => (
      <div class="h-[240px]">
        <GitVirtualTable
          items={items}
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
      expect(host.textContent).toContain('item-0');
      expect(host.textContent).toContain('item-11');
      expect(host.querySelectorAll('button')).toHaveLength(12);
      expect(host.querySelectorAll('tr[aria-hidden="true"] td')).toHaveLength(0);
    } finally {
      dispose();
    }
  });

  it('keeps the scroll container while avoiding spacer rows', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const items = Array.from({ length: 20 }, (_, index) => `item-${index}`);
    const dispose = render(() => (
      <div class="h-[240px]">
        <GitVirtualTable
          items={items}
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
      expect(viewport?.className).toContain('overflow-auto');
      expect(host.textContent).toContain('item-0');
      expect(host.textContent).toContain('item-19');
      expect(host.querySelectorAll('tr[aria-hidden="true"] td')).toHaveLength(0);
    } finally {
      dispose();
    }
  });

  it('passes the full loaded index through renderRow', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const items = ['a', 'b', 'c'];
    const dispose = render(() => (
      <GitVirtualTable
        items={items}
        tableClass="min-w-full"
        header={<tr><th>Item</th></tr>}
        renderRow={(item, index) => (
          <tr>
            <td>{`${index}:${item}`}</td>
          </tr>
        )}
      />
    ), host);

    try {
      expect(host.textContent).toContain('0:a');
      expect(host.textContent).toContain('1:b');
      expect(host.textContent).toContain('2:c');
    } finally {
      dispose();
    }
  });
});
