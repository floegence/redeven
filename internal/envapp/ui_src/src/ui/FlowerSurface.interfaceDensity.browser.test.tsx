import '../index.css';
import './flower-feature.css';
import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { FlowerThreadCard } from '../../../../flower_ui/src/threads/FlowerThreadList';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { INTERFACE_DENSITY_MARKDOWN } from './FlowerSurface.interfaceDensity.fixture';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

it.each([434, 758])('keeps the mixed-script reading sample compact at %ipx', async width => {
  await page.viewport(1280, 1000);
  const host = document.createElement('div');
  host.className = 'flower-surface flower-component-shell';
  host.style.cssText = `display:block;width:${width}px`;
  document.body.append(host);
  const dispose = render(() => <div class="flower-message-bubble flower-message-bubble-assistant">
    <FlowerMarkdownBlock content={INTERFACE_DENSITY_MARKDOWN} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />
  </div>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => Boolean(host.querySelector('p')));
  await document.fonts.ready;
  await frame();
  const content = host.querySelector<HTMLElement>('.flower-chat-md-block')!;
  const paragraph = content.querySelector('p')!;
  const geometry = { width: content.getBoundingClientRect().width, height: content.getBoundingClientRect().height, size: getComputedStyle(paragraph).fontSize,
    line: getComputedStyle(paragraph).lineHeight, weight: getComputedStyle(paragraph).fontWeight,
    font: getComputedStyle(paragraph).fontFamily, root: getComputedStyle(document.documentElement).fontSize, dpr: devicePixelRatio, scale: visualViewport?.scale };
  console.info('Interface density reading geometry', JSON.stringify(geometry));
  await page.screenshot({ element: host, path: `__screenshots__/density-reading-${width}.png` });
  expect.soft(geometry.size).toBe('13px');
  expect.soft(geometry.line).toBe('20px');
  expect.soft(geometry.weight).toBe('400');
  expect.soft(getComputedStyle(content.querySelector('strong')!).fontWeight).toBe('600');
  expect.soft(geometry.root).toBe('16px');
  expect.soft(geometry.font).toContain('Inter Variable');
  expect.soft(getComputedStyle(content.querySelector('h2')!).fontSize).toBe('14px');
  expect.soft(getComputedStyle(content.querySelector('h2')!).lineHeight).toBe('20px');
  expect.soft(getComputedStyle(content.querySelector('code')!).fontSize).toBe('12px');
  // Recorded at 2198b0905 with released Floe 0.78.2 and the identical content/width.
  const baselineHeight = width === 434 ? 535.890625 : 447.890625;
  expect.soft(geometry.width).toBe(width);
  expect.soft(geometry.height).toBeLessThanOrEqual(baselineHeight * 0.9);
});

it('fits twenty ordinary rows and preserves a readable attention title without hover shifts', async () => {
  await page.viewport(1280, 1000);
  const host = document.createElement('div');
  host.className = 'flower-component-shell flower-surface';
  host.style.cssText = 'display:block;width:220px;padding:8px';
  document.body.append(host);
  const rows = Array.from({ length: 25 }, (_, index) => ({ ...thread({ thread_id: `density-${index}`, title: '检查当前工作区内容', status: index === 1 ? 'waiting_user' : 'idle' }), pinned: false, preview: '' }));
  const copy = { ...DEFAULT_FLOWER_SURFACE_COPY.threadList, statuses: { ...DEFAULT_FLOWER_SURFACE_COPY.threadList.statuses, waiting_user: '待回复' } };
  const dispose = render(() => <div class="flower-thread-rows" style={{ height: '560px', 'overflow-y': 'auto', 'scrollbar-gutter': 'stable' }}>
    <For each={rows}>{item => <FlowerThreadCard item={item} active={false} copy={copy} onSelect={vi.fn()} onPin={vi.fn()} />}</For>
  </div>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await document.fonts.ready; await frame();
  const cards = [...host.querySelectorAll<HTMLElement>('.flower-thread-card')];
  const bounds = cards.map(card => card.getBoundingClientRect());
  const viewport = host.querySelector('.flower-thread-rows')!.getBoundingClientRect();
  const visible = bounds.filter(b => b.top >= viewport.top && b.bottom <= viewport.bottom + 0.5).length;
  const title = cards[1].querySelector<HTMLElement>('span.flower-thread-list-title')!;
  const before = title.getBoundingClientRect().width;
  console.info('Interface density list geometry', JSON.stringify({ step: bounds[1].top - bounds[0].top, visible, titleWidth: before }));
  await page.screenshot({ element: host, path: '__screenshots__/density-thread-list.png' });
  expect.soft(bounds[1].top - bounds[0].top).toBeCloseTo(28, 0);
  expect.soft(visible).toBe(20);
  expect.soft(before).toBeGreaterThanOrEqual(100);
  await userEvent.hover(cards[1]); await frame();
  expect.soft(Math.abs(title.getBoundingClientRect().width - before)).toBeLessThanOrEqual(1);
});

it('keeps the empty composer at 84px and the header at 40px', async () => {
  await page.viewport(1280, 900);
  const selected = thread({ messages: [] });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [selected], loadThread: async () => liveBootstrap(selected) },
    { focusThreadRequest: { request_id: 'density', thread_id: selected.thread_id } });
  Object.assign(runtime.style, { width: '1200px', height: '800px' });
  await waitFor(() => Boolean(runtime.querySelector('.flower-composer')));
  await document.fonts.ready; await frame();
  expect.soft(runtime.querySelector('.flower-chat-header')!.getBoundingClientRect().height).toBe(40);
  expect.soft(runtime.querySelector('.flower-composer')!.getBoundingClientRect().height).toBe(84);
});


it.each([false, true])('keeps thread controls and reading roles usable with coarse input=%s and enlarged text', async touch => {
  const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
  await media.emulateTouchInput(touch);
  onTestFinished(async () => { await media.emulateTouchInput(false); document.documentElement.style.removeProperty('font-size'); });
  await page.viewport(1000, 900);
  const host = document.createElement('div');
  host.className = 'flower-surface';
  host.style.cssText = 'width:320px';
  document.body.append(host);
  const item = { ...thread({ title: 'Long title with 中文 and a /workspace/path', status: 'waiting_user' }), pinned: false, preview: '' };
  const dispose = render(() => <>
    <FlowerThreadCard item={item} active={false} onSelect={vi.fn()} onPin={vi.fn()} />
    <FlowerMarkdownBlock content="Readable body 中文" copyCodeLabel="Copy code" codeCopiedLabel="Copied" />
  </>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  const title = host.querySelector<HTMLElement>('.flower-thread-list-title')!;
  for (const root of [16, 20, 32]) {
    document.documentElement.style.fontSize = `${root}px`;
    await document.fonts.ready; await frame();
    const paragraph = host.querySelector('p')!;
    expect(parseFloat(getComputedStyle(title).fontSize)).toBe(root * (touch ? 0.8125 : 0.75));
    expect(parseFloat(getComputedStyle(paragraph).fontSize)).toBe(root * (touch ? 0.875 : 0.8125));
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    for (const button of host.querySelectorAll('button')) {
      const box = button.getBoundingClientRect();
      expect(box.height).toBeGreaterThanOrEqual(touch ? 44 : root * 1.75);
      expect(box.width).toBeGreaterThanOrEqual(touch ? 44 : root * 1.75);
    }
    expect(host.querySelector('.flower-thread-list-title')).toBe(title);
  }
});
