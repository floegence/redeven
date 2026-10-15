import '../index.css';
import './flower-feature.css';

import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';

let dispose: (() => void) | undefined;
let root: HTMLDivElement;
afterEach(() => {
  dispose?.();
  root?.remove();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-floe-shell-theme');
});

it.each(['classic-light', 'classic-dark'])('renders open tables with horizontal separators in %s', async theme => {
  await page.viewport(1000, 760);
  document.documentElement.classList.toggle('dark', theme === 'classic-dark');
  document.documentElement.dataset.floeShellTheme = theme;
  root = document.createElement('div');
  root.style.width = 'min(880px, 100%)';
  document.body.append(root);
  const markdown = '| Component | Behavior | Calls |\n| --- | --- | ---: |\n| Codex | Captures the current context before each model request. | 12 |\n| pi | Compares the loaded prompt and tool configuration before the next response. | 8 |\n| OpenCode | Refreshes context sources and compares instruction state. | 10 |';
  dispose = render(() => <div class="flower-chat-shell" style={{ padding: '24px' }}>
    <div class="flower-message-bubble flower-message-bubble-assistant">
      <FlowerMarkdownBlock content={markdown} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />
    </div>
  </div>, root);
  await expect.poll(() => root.querySelectorAll('tbody tr').length).toBe(3);
  const table = root.querySelector<HTMLElement>('table')!;
  const headers = [...table.querySelectorAll('th')];
  const cells = [...table.querySelectorAll('td')];
  for (const cell of [...headers, ...cells]) {
    const style = getComputedStyle(cell);
    expect(style.borderLeftWidth).toBe('0px');
    expect(style.borderRightWidth).toBe('0px');
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  }
  expect(getComputedStyle(headers[0]).borderBottomWidth).toBe('1px');
  expect(getComputedStyle(cells[0]).borderTopWidth).toBe('0px');
  expect(getComputedStyle(cells[3]).borderTopWidth).toBe('1px');
  expect(getComputedStyle(cells.at(-1)!).borderBottomWidth).toBe('0px');
  expect(getComputedStyle(headers[2]).textAlign).toBe('right');
  expect(getComputedStyle(cells[2]).textAlign).toBe('right');
  expect(getComputedStyle(table).borderTopWidth).toBe('0px');
  expect(getComputedStyle(table).borderBottomWidth).toBe('0px');
  await page.screenshot({ element: root, path: `__screenshots__/flower-tables-${theme}.png` });
  await page.viewport(390, 760);
  await expect.poll(() => root.clientWidth).toBeLessThanOrEqual(390);
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
  expect(table.textContent).toContain('OpenCode');
  await page.screenshot({ element: root, path: `__screenshots__/flower-tables-mobile-${theme}.png` });
  root.style.width = '180px';
  await expect.poll(() => root.clientWidth).toBe(180);
  expect(table.scrollWidth).toBeGreaterThan(table.clientWidth);
  table.scrollLeft = table.scrollWidth;
  expect(table.scrollLeft).toBeGreaterThan(0);
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
});
