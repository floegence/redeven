import '../index.css';
import './flower-feature.css';

import { expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const messages = [
  'Hello',
  '最近有什么值得关注的开源项目，要求非明星团队、大厂、广泛传播的',
  '有什么比较好的browser use任务适合测试Agent的browser use水平，请你分析和查找这样的任务',
  'Review the browser interaction and report the findings. '.repeat(12),
  `https://example.test/${'unbroken-path-'.repeat(40)}`,
];

it.each([1440, 900, 375])('aligns reopened user messages and caps their width once at %ipx', async width => {
  await page.viewport(width, 1000);
  const selected = thread({
    messages: messages.map((content, index) => ({
      id: `user-layout-${index}`, turn_id: `turn-layout-${index}`, role: 'user' as const,
      content, status: 'complete' as const, created_at_ms: 1_000 + index,
    })),
  });
  const runtime = renderSurfaceWithAdapterProps({
    ...adapter(true), listThreads: async () => [selected], loadThread: async () => liveBootstrap(selected),
  }, { focusThreadRequest: { request_id: 'message-layout', thread_id: selected.thread_id } });
  runtime.style.cssText = 'width:100%;height:900px';
  await waitFor(() => runtime.querySelectorAll('.flower-message-bubble-user').length === messages.length);
  await waitFor(() => !runtime.querySelector('.flower-chat-transcript[data-flower-tail-preparing]'));
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  const rows = [...runtime.querySelectorAll<HTMLElement>('.flower-message-row-user')];
  const geometry = rows.map(row => {
    const bubble = row.querySelector<HTMLElement>('.flower-message-bubble-user')!;
    const wrapper = row.querySelector<HTMLElement>('.flower-history-message')!;
    const bounds = bubble.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    return { row: rowBounds.width, bubble: bounds.width, wrapper: wrapper.getBoundingClientRect().width, rightGap: rowBounds.right - bounds.right };
  });
  console.info('User message layout', JSON.stringify({ width, geometry }));
  const viewport = runtime.querySelector<HTMLElement>('.flower-chat-transcript')!;
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
  viewport.scrollTop = 0;
  viewport.dispatchEvent(new Event('scroll'));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await page.screenshot({ element: runtime, path: `__screenshots__/user-message-layout-${width}.png` });
  for (const row of rows) {
    const bubble = row.querySelector<HTMLElement>('.flower-message-bubble-user')!;
    const bounds = bubble.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const actions = row.querySelector('.flower-message-action-row-user')!.getBoundingClientRect();
    expect.soft(Math.abs(bounds.right - rowBounds.right), 'bubble aligns with transcript right edge').toBeLessThanOrEqual(1);
    expect.soft(Math.abs(bounds.right - actions.right), 'copy and time sit below the bubble').toBeLessThanOrEqual(1);
    expect.soft(bounds.width, 'single responsive width cap').toBeLessThanOrEqual(rowBounds.width * (width <= 780 ? 1 : 0.78) + 1);
    expect.soft(bubble.scrollWidth, 'long content stays inside bubble').toBeLessThanOrEqual(bubble.clientWidth + 1);
  }
  const longMessage = geometry[3];
  expect.soft(longMessage.bubble, 'long text uses the full allowed width').toBeCloseTo(longMessage.row * (width <= 780 ? 1 : 0.78), 0);
  expect.soft(geometry[0].bubble, 'short messages remain compact').toBeLessThan(100);
});
