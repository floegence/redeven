import '../index.css';
import './flower-feature.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

function mount(content: string, queued = false, streaming = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const [text, setText] = createSignal(content);
  const [live, setLive] = createSignal(streaming);
  dispose = render(() => <div class="flower-chat-shell" style={{ height: 'auto', padding: '16px' }}>
    <div class="flower-message-row flower-message-row-user">
      <div class="flower-message-block-stack flower-message-block-stack-user">
        <div class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user"
          classList={{ 'flower-queued-turn-bubble': queued }}>
          <FlowerMarkdownBlock content={text()} streaming={live()} copyCodeLabel="Copy" codeCopiedLabel="Copied" />
        </div>
      </div>
    </div>
  </div>, host);
  const bubble = host.querySelector<HTMLElement>('.flower-message-bubble')!;
  const firstBlock = () => bubble.querySelector<HTMLElement>('.flower-chat-md-content > .flower-chat-md-committed-segment > :first-child')!;
  return { host, bubble, firstBlock, setText, setLive };
}

it.each([360, 1100])('keeps short sent and queued messages vertically centered at %spx', async width => {
  await page.viewport(width, 600);
  for (const queued of [false, true]) {
    const { host, bubble, firstBlock } = mount('hi', queued);
    await expect.poll(() => firstBlock()?.textContent).toBe('hi');
    const bounds = bubble.getBoundingClientRect();
    const paragraph = firstBlock().getBoundingClientRect();
    const style = getComputedStyle(bubble);
    const top = paragraph.top - bounds.top;
    const bottom = bounds.bottom - paragraph.bottom;
    expect(top, 'top inset').toBeCloseTo(parseFloat(style.paddingTop));
    expect(bottom, 'bottom inset').toBeCloseTo(parseFloat(style.paddingBottom));
    expect(top, 'equal vertical insets').toBeCloseTo(bottom);
    expect(bounds.height).toBeCloseTo(parseFloat(style.lineHeight) + top + bottom);
    if (!queued && width === 1100) {
      await page.screenshot({ element: host, path: '__screenshots__/flower-user-message-insets.png' });
    }
    dispose?.();
    document.body.replaceChildren();
  }
});

it.each([
  ['heading', '# Heading', 'h1'],
  ['list', '- First item\n- Second item', 'ul'],
  ['quote', '> Quoted text', 'blockquote'],
  ['code', '```text\ncode\n```', '.flower-chat-md-code-frame'],
  ['table', '| Name | Value |\n| --- | --- |\n| One | Two |', 'table'],
])('removes only the first %s block top margin', async (_name, content, selector) => {
  const { firstBlock } = mount(content);
  await expect.poll(() => firstBlock()?.matches(selector)).toBe(true);
  expect(getComputedStyle(firstBlock()).marginTop).toBe('0px');
});

it('preserves paragraph separation and stable first-block spacing while streaming', async () => {
  const { bubble, firstBlock, setText, setLive } = mount('First', false, true);
  await expect.poll(() => firstBlock()?.textContent).toBe('First');
  const topInset = () => firstBlock().getBoundingClientRect().top - bubble.getBoundingClientRect().top;
  expect(topInset()).toBeCloseTo(parseFloat(getComputedStyle(bubble).paddingTop));
  setText('First paragraph.\n\nSecond paragraph.');
  await expect.poll(() => bubble.querySelectorAll('p').length).toBe(2);
  expect(getComputedStyle(firstBlock()).marginTop).toBe('0px');
  const second = bubble.querySelectorAll('p')[1];
  expect(parseFloat(getComputedStyle(second).marginTop)).toBeCloseTo(14 * 0.8);
  expect(topInset()).toBeCloseTo(parseFloat(getComputedStyle(bubble).paddingTop));
  setLive(false);
  await expect.poll(() => getComputedStyle(firstBlock()).marginTop).toBe('0px');
  expect(topInset()).toBeCloseTo(parseFloat(getComputedStyle(bubble).paddingTop));
});
