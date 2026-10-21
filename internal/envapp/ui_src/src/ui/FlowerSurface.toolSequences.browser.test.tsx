import '../index.css';
import './flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView, FlowerRuntimeCurrentItem } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const media = commands as unknown as { emulateMediaPreferences: (input: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void> };
const item = (id: string, kind: FlowerRuntimeCurrentItem['kind'], text = id): FlowerRuntimeCurrentItem => ({ id, kind, text, turn_id: 'turn', run_id: 'run', ordinal: 0 });
const tool = (id: string, status: 'success' | 'running' | 'error' = 'success'): FlowerRuntimeCurrentItem => ({ ...item(id, 'tool'), activity: {
  item_id: id, tool_id: id, kind: 'tool', tool_name: 'terminal.exec', status, severity: status === 'error' ? 'error' : 'quiet',
  needs_attention: false, requires_approval: false,
  presentation: { label: `Execute ${id}`, renderer: 'terminal', payload: { operation: 'exec', command: `echo ${id}`, output: `${id} output` } },
} });
function current(items: FlowerRuntimeCurrentItem[], version = 1): FlowerRuntimeCurrentView {
  return { thread_id: 'sequences', turn_id: 'turn', run_id: 'run', view_version: version, activity: 'active', run_progress: { phase: 'streaming' },
    turns: [{ turn_id: 'turn', run_id: 'run', started_at: '2026-10-21T10:00:00Z', elapsed_ms: 0, waiting_ms: 0,
      work_duration_ms: 0, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false }],
    items: items.map((value, i) => ({ ...value, ordinal: i + 1 })),
  };
}
async function mount(items: FlowerRuntimeCurrentItem[]) {
  await page.viewport(1280, 900);
  let latest = current(items);
  const seed = applyFlowerRuntimeCurrentView(thread({ thread_id: 'sequences', title: 'Tool sequences', messages: [] }), latest);
  const peer = thread({ thread_id: 'peer', title: 'Another conversation' });
  const values: FlowerLiveStreamEnvelope[] = [{ schema_version: 2, kind: 'ready', summaries: [seed, peer] }];
  let wake: (() => void) | undefined;
  const root = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [applyFlowerRuntimeCurrentView(seed, latest), peer]),
    loadThread: vi.fn(async id => id === peer.thread_id ? liveBootstrap(peer) : { thread: applyFlowerRuntimeCurrentView(seed, latest), current: latest }),
    async *connectLiveStream({ signal }) {
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const value = values.shift(); if (value) yield value; else await new Promise<void>(resolve => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
  });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="sequences"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="sequences"] button')!.click();
  await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="a"]')));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  return { root, push(next: FlowerRuntimeCurrentItem[]) { latest = current(next, latest.view_version + 1); values.push({ schema_version: 2, kind: 'thread.batch', thread_id: 'sequences', current: latest }); wake?.(); } };
}
const row = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-activity-item-id="${id}"]`)!;
const group = (root: HTMLElement, id: string) => row(root, id).closest('.flower-tool-sequence-node')!;
const toggle = (root: HTMLElement, id: string) => group(root, id).querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
const collapsed = (root: HTMLElement, id: string) => group(root, id).querySelector('.flower-tool-sequence-viewport')!.getAttribute('aria-hidden') === 'true';
afterEach(async () => { document.getSelection()?.removeAllRanges(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' }); });

describe('consecutive tools in the shared Flower surface', () => {
  it('folds older tools and bounded thinking, keeping prose, errors and outside thinking visible', async () => {
    const { root } = await mount([item('leading', 'thinking'), tool('a'), item('inside', 'thinking'), tool('b'), item('outside', 'thinking'),
      item('progress', 'assistant', 'A useful progress report.'), tool('failure', 'error'), tool('c'), tool('d', 'running')]);
    expect(toggle(root, 'a').textContent).toContain('2 tool calls');
    expect(toggle(root, 'a').textContent).toContain('1 thinking segment');
    expect(collapsed(root, 'a')).toBe(true);
    expect(collapsed(root, 'b')).toBe(true);
    expect(collapsed(root, 'c')).toBe(false);
    expect(toggle(root, 'c').textContent).toContain('1 running');
    expect(row(root, 'failure').closest('[inert]')).toBeNull();
    expect(root.querySelector('[data-flower-message-id="progress"]')?.closest('[inert]')).toBeNull();
    const thoughts = [...root.querySelectorAll<HTMLElement>('.flower-thinking-disclosure')];
    expect(thoughts.map(node => node.classList.contains('flower-thinking-disclosure-inline'))).toEqual([false, true, false]);
    expect(thoughts[1].closest('[inert]')).not.toBeNull();
    expect(thoughts[1].querySelector('.flower-activity-inline-icon svg')?.getAttribute('stroke-width')).toBe('1.7');
    toggle(root, 'a').click();
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'open');
    expect(collapsed(root, 'b')).toBe(false);
    expect(row(root, 'a').getBoundingClientRect().height).toBe(32);
    expect(Math.abs(row(root, 'b').getBoundingClientRect().top - thoughts[1].getBoundingClientRect().bottom)).toBeLessThan(1);
    expect(getComputedStyle(group(root, 'a').querySelector('.flower-tool-sequence-content')!, '::after').width).toBe('1px');
    expect(getComputedStyle(row(root, 'a').querySelector('.flower-activity-inline-title')!).fontSize).toBe('12px');
    expect(getComputedStyle(row(root, 'a').querySelector('.flower-activity-inline-title')!).lineHeight).toBe('18px');
    await page.screenshot({ element: root, path: '__screenshots__/flower-tools-mixed.png' });
  });

  it.each(['reduce', 'no-preference'] as const)('retains manual group and tool detail state through updates and navigation with %s motion', async reducedMotion => {
    await media.emulateMediaPreferences({ reducedMotion });
    const initial = [tool('a'), tool('b')];
    const { root, push } = await mount(initial);
    const original = row(root, 'a');
    const button = original.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!;
    button.click();
    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    button.focus();
    toggle(root, 'a').click();
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'closed');
    expect(document.activeElement).toBe(toggle(root, 'a'));
    push([...initial, item('progress', 'assistant'), tool('c'), tool('d')]);
    await waitFor(() => Boolean(toggle(root, 'c')));
    expect(collapsed(root, 'a')).toBe(true);
    toggle(root, 'a').click();
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'open');
    expect(row(root, 'a')).toBe(original);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
    await waitFor(() => !root.querySelector('[data-flower-activity-item-id="a"]'));
    root.querySelector<HTMLButtonElement>('[data-thread-id="sequences"] button')!.click();
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="a"]')));
    expect(collapsed(root, 'a')).toBe(false);
    expect(row(root, 'a').querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('supports native keyboard folding and forced colors without losing focus', async () => {
    await media.emulateMediaPreferences({ reducedMotion: 'reduce', forcedColors: 'active' });
    const { root } = await mount([tool('a'), tool('b')]);
    const button = toggle(root, 'a');
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(collapsed(root, 'a')).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(getComputedStyle(button).outlineStyle).toBe('solid');
    const controlled = button.getAttribute('aria-controls')!.split(' ');
    expect(controlled).toHaveLength(2);
    expect(controlled.every(id => document.getElementById(id)?.hasAttribute('inert'))).toBe(true);
    await userEvent.keyboard(' ');
    expect(collapsed(root, 'a')).toBe(false);
  });

  it('reveals a failed call and restores focus when a two-call group dissolves', async () => {
    const { root, push } = await mount([tool('a'), tool('b', 'running')]);
    const button = toggle(root, 'a'); button.focus(); button.click();
    push([tool('a'), tool('b', 'error')]);
    await waitFor(() => !root.querySelector('.flower-tool-sequence-toggle'));
    await waitFor(() => row(root, 'b').closest('[inert]') === null);
    expect(document.activeElement).toBe(row(root, 'a').querySelector('.flower-activity-inline-button'));
  });

  it('respects a manually closed group when more consecutive tools arrive', async () => {
    const initial = [tool('a'), tool('b')];
    const { root, push } = await mount(initial);
    toggle(root, 'a').focus();
    toggle(root, 'a').click();
    push([...initial, tool('c')]);
    await waitFor(() => toggle(root, 'a').textContent?.includes('3 tool calls') === true);
    expect(collapsed(root, 'a')).toBe(true);
    expect(collapsed(root, 'c')).toBe(true);
    expect(document.activeElement).toBe(toggle(root, 'a'));
  });

  it.each(['selection', 'focus', 'gesture', 'manual detail'] as const)('protects %s while an existing sequence becomes older', async protection => {
    const initial = [tool('a'), item('thinking', 'thinking'), tool('b')];
    const { root, push } = await mount(initial);
    const node = row(root, 'a');
    if (protection === 'selection') {
      const range = document.createRange(); range.selectNodeContents(node.querySelector('.flower-activity-inline-title')!);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    } else if (protection === 'focus') node.querySelector<HTMLButtonElement>('button')!.focus();
    else if (protection === 'gesture') node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 }));
    else {
      node.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.click();
      (document.activeElement as HTMLElement | null)?.blur();
    }
    push([...initial, item('progress', 'assistant'), tool('c'), tool('d')]);
    await waitFor(() => Boolean(toggle(root, 'c')));
    expect(collapsed(root, 'a')).toBe(false);
    expect(row(root, 'a')).toBe(node);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
  });

  it('keeps a selected trailing thought mounted when it becomes an inline node in a manually collapsed group', async () => {
    const initial = [tool('a'), tool('b'), item('trailing', 'thinking', 'Keep this selected thought.')];
    const { root, push } = await mount(initial);
    toggle(root, 'a').click();
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'closed');
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    thinking.querySelector<HTMLButtonElement>('button')!.click();
    const content = thinking.querySelector('.flower-thinking-content')!;
    const range = document.createRange(); range.selectNodeContents(content);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    push([...initial, tool('c')]);
    await waitFor(() => thinking.classList.contains('flower-thinking-disclosure-inline'));
    expect(root.querySelector('.flower-thinking-disclosure')).toBe(thinking);
    expect(thinking.closest('[inert]')).toBeNull();
    expect(document.getSelection()?.toString()).toContain('Keep this selected thought.');
    expect(toggle(root, 'a').getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the last visible prose anchored when an offscreen older sequence folds', async () => {
    const initial = [tool('a'), tool('b'), item('progress', 'assistant', 'Current progress. '.repeat(90))];
    const { root, push } = await mount(initial);
    const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    viewport.style.height = '110px'; viewport.style.maxHeight = '110px'; viewport.style.flex = 'none';
    await waitFor(() => viewport.scrollHeight > viewport.clientHeight + 50);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, bubbles: true }));
    const prose = root.querySelector<HTMLElement>('[data-flower-message-id="progress"]')!;
    viewport.scrollTop = prose.offsetTop + 15;
    viewport.dispatchEvent(new Event('scroll'));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const top = prose.getBoundingClientRect().top;
    push([...initial, tool('c')]);
    await waitFor(() => collapsed(root, 'a'));
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'closed');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(Math.abs(prose.getBoundingClientRect().top - top)).toBeLessThan(2);
  });

  it.each(['paper', 'porcelain-dark', 'hc-light'] as const)('uses existing %s theme contrast and keeps active tools bright at narrow widths', async theme => {
    const html = document.documentElement;
    const previous = ['style', 'class', 'data-floe-shell-theme'].map(key => [key, html.getAttribute(key)] as const);
    const preset = builtInShellThemePresets.find(value => value.name === theme)!;
    try {
      html.classList.toggle('dark', preset.mode === 'dark');
      html.classList.toggle('light', preset.mode === 'light');
      html.dataset.floeShellTheme = theme;
      for (const [key, value] of Object.entries(preset.semanticTokens ?? {})) if (value) html.style.setProperty(key, value);
      const { root } = await mount([tool('a'), tool('b', 'running')]);
      await page.viewport(390, 844);
      const quiet = row(root, 'a').querySelector<HTMLElement>('.flower-activity-inline-button')!;
      const running = row(root, 'b').querySelector<HTMLElement>('.flower-activity-inline-button')!;
      const reference = document.createElement('span'); reference.style.color = 'var(--foreground)'; root.append(reference);
      expect(getComputedStyle(quiet).color).not.toBe(getComputedStyle(running).color);
      expect(getComputedStyle(running).color).toBe(getComputedStyle(reference).color);
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
      await page.screenshot({ element: root, path: `__screenshots__/flower-tools-${theme}.png` });
    } finally {
      for (const [key, value] of previous) { if (value === null) html.removeAttribute(key); else html.setAttribute(key, value); }
    }
  });
});
