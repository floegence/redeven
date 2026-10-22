import '../index.css';
import './flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView, FlowerRuntimeCurrentItem, FlowerToolCallPreview } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const media = commands as unknown as { emulateMediaPreferences: (input: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void> };
const item = (id: string, kind: FlowerRuntimeCurrentItem['kind'], text = id): FlowerRuntimeCurrentItem => ({ id, kind, text, turn_id: 'turn', run_id: 'run', ordinal: 0 });
const emptyLiveText = (id: string): FlowerRuntimeCurrentItem => ({ ...item(id, 'assistant', ''), live: true });
const tool = (id: string, status: 'success' | 'running' | 'error' = 'success', toolName = 'terminal.exec', renderer = 'terminal'): FlowerRuntimeCurrentItem => ({ ...item(id, 'tool'), activity: {
  item_id: id, tool_id: id, kind: 'tool', tool_name: toolName, status, severity: status === 'error' ? 'error' : status === 'running' ? 'normal' : 'quiet',
  needs_attention: status !== 'success', requires_approval: false,
  ...(status === 'error' ? { attention_reasons: ['error'] } : status === 'running' ? { attention_reasons: ['running'] } : {}),
  presentation: { label: `Execute ${id}`, renderer, payload: { operation: renderer === 'web_search' ? 'search' : 'exec', query: `query ${id}`, command: `echo ${id}`, output: `${id} output`, ...(status === 'error' ? { error: { message: `${id} failed` } } : {}) } },
} });
function current(items: FlowerRuntimeCurrentItem[], version = 1): FlowerRuntimeCurrentView {
  return { thread_id: 'sequences', turn_id: 'turn', run_id: 'run', view_version: version, activity: 'active', run_progress: { phase: 'streaming' },
    turns: [{ turn_id: 'turn', run_id: 'run', started_at: '2026-10-21T10:00:00Z', elapsed_ms: 0, waiting_ms: 0,
      work_duration_ms: 0, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false }],
    items: items.map((value, i) => ({ ...value, ordinal: i + 1 })),
  };
}
const preview = (id: string): FlowerToolCallPreview => ({
  thread_id: 'sequences', turn_id: 'turn', run_id: 'run', logical_request_id: 'request',
  attempt_id: 'attempt', attempt_epoch: 0, call_id: id, name: 'apply_patch', arguments_complete: false,
  preview: { display_name: `${id}.ts`, additions: 2 },
});
async function mount(items: FlowerRuntimeCurrentItem[], previews: readonly FlowerToolCallPreview[] = []) {
  await page.viewport(1280, 900);
  let latest = { ...current(items), ...(previews.length ? { tool_call_previews: previews } : {}) };
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
  await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id]')));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  return { root, push(next: FlowerRuntimeCurrentItem[], nextPreviews: readonly FlowerToolCallPreview[] = []) {
    latest = { ...current(next, latest.view_version + 1), ...(nextPreviews.length ? { tool_call_previews: nextPreviews } : {}) };
    values.push({ schema_version: 2, kind: 'thread.batch', thread_id: 'sequences', current: latest }); wake?.();
  } };
}
const row = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-activity-item-id="${id}"]`)!;
const group = (root: HTMLElement, id: string) => row(root, id).closest<HTMLElement>('.flower-tool-sequence-node')!;
const toggle = (root: HTMLElement, id: string) => group(root, id).querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
const collapsed = (root: HTMLElement, id: string) => group(root, id).querySelector('.flower-tool-sequence-viewport')!.getAttribute('aria-hidden') === 'true';
function expectConnectorBetween(root: HTMLElement, previousID: string, nextID: string) {
  const previousIcon = row(root, previousID).querySelector('.flower-tool-icon, .flower-activity-inline-loader')!.getBoundingClientRect();
  const previousCenter = previousIcon.top + previousIcon.height / 2;
  const nextIcon = row(root, nextID).querySelector('.flower-tool-icon, .flower-activity-inline-loader')!.getBoundingClientRect();
  const nextCenter = nextIcon.top + nextIcon.height / 2;
  const content = group(root, previousID).querySelector('.flower-tool-sequence-content')!;
  const rect = content.getBoundingClientRect();
  const connector = getComputedStyle(content, '::after');
  const connectorX = rect.left + Number.parseFloat(connector.left);
  const start = rect.top + Number.parseFloat(connector.top);
  const end = rect.bottom - Number.parseFloat(connector.bottom);
  expect(connector.width).toBe('1px');
  expect(Number.parseFloat(connector.height)).toBeGreaterThan(0);
  expect(connector.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(Number.parseFloat(connector.opacity)).toBeGreaterThan(0.5);
  expect(connector.content).not.toBe('none');
  expect(Math.abs(connectorX - (previousIcon.left + previousIcon.width / 2))).toBeLessThan(1);
  expect(Math.abs(start - previousCenter)).toBeLessThan(1);
  expect(Math.abs(end - nextCenter)).toBeLessThan(1);
}
afterEach(async () => { document.getSelection()?.removeAllRanges(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' }); });

describe('consecutive tools in the shared Flower surface', () => {
  it('folds web search, goal activity and thinking after the final tool into one styled sequence', async () => {
    const { root } = await mount([
      tool('search', 'success', 'web_search', 'web_search'),
      tool('goal', 'success', 'goal', 'structured'),
      item('after-goal', 'thinking'),
    ]);
    const sequenceToggle = toggle(root, 'search');
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    const sequenceKey = group(root, 'search').dataset.flowerSequence;
    expect(sequenceToggle.textContent).toContain('2 tool calls');
    expect(sequenceToggle.textContent).toContain('1 thinking segment');
    expect(group(root, 'goal').dataset.flowerSequence).toBe(sequenceKey);
    expect(thinking.classList.contains('flower-thinking-disclosure-inline')).toBe(true);
    expect(thinking.querySelector('.flower-activity-inline-icon svg')).not.toBeNull();

    sequenceToggle.click();
    await waitFor(() => collapsed(root, 'search'));
    expect(row(root, 'search').closest('[inert]')).not.toBeNull();
    expect(row(root, 'goal').closest('[inert]')).not.toBeNull();
    expect(thinking.closest('[inert]')).not.toBeNull();
  });

  it('folds older tools and bounded thinking, keeping prose and outside thinking visible', async () => {
    const { root } = await mount([item('leading', 'thinking'), tool('a'), item('inside', 'thinking'), tool('b'), item('outside', 'thinking'),
      item('progress', 'assistant', 'A useful progress report.'), tool('failure', 'error'), tool('c'), tool('d', 'running')]);
    expect(toggle(root, 'a').textContent).toContain('2 tool calls');
    expect(toggle(root, 'a').textContent).toContain('2 thinking segments');
    expect(collapsed(root, 'a')).toBe(true);
    expect(collapsed(root, 'b')).toBe(true);
    expect(collapsed(root, 'failure')).toBe(false);
    expect(toggle(root, 'failure').textContent).toContain('3 tool calls');
    expect(toggle(root, 'failure').textContent).toContain('1 failed tool call');
    expect(toggle(root, 'failure').textContent).toContain('1 running');
    expect(row(root, 'failure').closest('[inert]')).toBeNull();
    expect(root.querySelector('[data-flower-message-id="progress"]')?.closest('[inert]')).toBeNull();
    const thoughts = [...root.querySelectorAll<HTMLElement>('.flower-thinking-disclosure')];
    expect(thoughts.map(node => node.classList.contains('flower-thinking-disclosure-inline'))).toEqual([false, true, true]);
    expect(thoughts[1].closest('[inert]')).not.toBeNull();
    expect(thoughts[2].closest('[inert]')).not.toBeNull();
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

  it('folds failed and successful calls together, and colors failure text and glyph with the warning palette', async () => {
    const { root } = await mount([tool('failed', 'error'), tool('succeeded'), item('progress', 'assistant'), tool('c'), tool('d')]);
    const failedGroup = group(root, 'failed');
    expect(toggle(root, 'failed').textContent).toContain('2 tool calls');
    expect(toggle(root, 'failed').textContent).toContain('1 failed tool call');
    expect(collapsed(root, 'failed')).toBe(true);
    expect(row(root, 'failed').closest('[inert]')).not.toBeNull();
    toggle(root, 'failed').click();
    await waitFor(() => failedGroup.getAttribute('data-state') === 'open');
    const failedRow = row(root, 'failed');
    const failedGlyph = failedRow.querySelector<HTMLElement>('.flower-tool-icon')!;
    const failedTitle = failedRow.querySelector<HTMLElement>('.flower-activity-inline-title')!;
    const failedButton = failedRow.querySelector<HTMLElement>('.flower-activity-inline-button')!;
    const warning = document.createElement('span'); warning.style.color = 'var(--redeven-status-warning)'; root.append(warning);
    const warningForeground = document.createElement('span'); warningForeground.style.color = 'var(--redeven-status-warning-foreground)'; root.append(warningForeground);
    expect(failedRow.querySelectorAll('.flower-activity-inline-icon svg')).toHaveLength(1);
    expect(getComputedStyle(failedGlyph).color).toBe(getComputedStyle(warning).color);
    expect(getComputedStyle(failedTitle).color).toBe(getComputedStyle(warningForeground).color);
    expect(getComputedStyle(failedButton).color).toBe(getComputedStyle(warningForeground).color);
    expect(getComputedStyle(failedTitle).fontSize).toBe('12px');
    warningForeground.remove();
    warning.remove();
    failedRow.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.click();
    await waitFor(() => Boolean(failedRow.querySelector('[data-state="open"]')));
    expect(failedRow.textContent).toContain('failed failed');
  });

  it('keeps running and completed commands on the same connected row geometry across empty live messages', async () => {
    const initial = [tool('a'), tool('b'), emptyLiveText('live-empty-1'), tool('c', 'running'), emptyLiveText('live-empty-2'), tool('d', 'running')];
    const { root, push } = await mount(initial);
    const button = toggle(root, 'a');
    const groupKey = group(root, 'a').dataset.flowerSequence;
    const runningRows = [row(root, 'c'), row(root, 'd')];
    const runningTops = runningRows.map(entry => entry.getBoundingClientRect().top);
    expect(button.textContent).toContain('4 tool calls');
    expect(button.textContent).toContain('2 running');
    expect(group(root, 'c').dataset.flowerSequence).toBe(groupKey);
    expect(group(root, 'd').dataset.flowerSequence).toBe(groupKey);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    const completedLine = row(root, 'b').querySelector<HTMLElement>('.flower-activity-inline-button')!.getBoundingClientRect();
    const runningLine = row(root, 'c').querySelector<HTMLElement>('.flower-activity-inline-button')!.getBoundingClientRect();
    expect(Math.abs(completedLine.height - runningLine.height)).toBeLessThan(1);
    expect(getComputedStyle(row(root, 'b').querySelector('.flower-activity-inline-icon')!).width).toBe('16px');
    expect(getComputedStyle(row(root, 'c').querySelector('.flower-activity-inline-icon')!).width).toBe('16px');
    expectConnectorBetween(root, 'b', 'c');
    expectConnectorBetween(root, 'c', 'd');
    await page.screenshot({ element: root, path: '__screenshots__/flower-tools-running-connector.png' });
    for (const id of ['b', 'live-empty-1', 'c', 'live-empty-2']) {
      expect(root.querySelector(`[data-flower-row-message-id="${id}"]`)?.closest('.flower-turn-row')
        ?.getAttribute('data-flower-sequence-continues')).toBe('true');
    }

    push([tool('a'), tool('b'), emptyLiveText('live-empty-1'), tool('c'), emptyLiveText('live-empty-2'), tool('d', 'success')]);
    await waitFor(() => row(root, 'd').classList.contains('flower-activity-inline-row-success'));
    expect(group(root, 'd').dataset.flowerSequence).toBe(groupKey);
    expect(row(root, 'c')).toBe(runningRows[0]);
    expect(row(root, 'd')).toBe(runningRows[1]);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - runningTops[0])).toBeLessThan(1);
    expect(Math.abs(row(root, 'd').getBoundingClientRect().top - runningTops[1])).toBeLessThan(1);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    expectConnectorBetween(root, 'b', 'c');
    expectConnectorBetween(root, 'c', 'd');
  });

  it('keeps the argument-generation preview row compact and connected as it becomes a running tool', async () => {
    const { root, push } = await mount([tool('a'), tool('b')], [preview('c')]);
    const pendingRow = root.querySelector<HTMLElement>('[data-flower-tool-call-id="c"]')!;
    const pendingNode = pendingRow.closest<HTMLElement>('.flower-tool-sequence-node')!;
    const groupKey = pendingNode.dataset.flowerSequence;
    expect(pendingRow.classList.contains('flower-activity-inline-row-generating')).toBe(true);
    expect(root.querySelector('.flower-tool-sequence-toggle')?.textContent).toContain('3 tool calls');
    expect(Math.abs(pendingRow.getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    const previewIcon = pendingRow.querySelector('.flower-tool-icon')!.getBoundingClientRect();
    const previousIcon = row(root, 'b').querySelector('.flower-tool-icon')!.getBoundingClientRect();
    const previousConnector = group(root, 'b').querySelector('.flower-tool-sequence-content')!;
    const previousConnectorStyle = getComputedStyle(previousConnector, '::after');
    const previousConnectorRect = previousConnector.getBoundingClientRect();
    expect(previousConnectorStyle.width).toBe('1px');
    expect(Math.abs(previousConnectorRect.top + Number.parseFloat(previousConnectorStyle.top) - (previousIcon.top + previousIcon.height / 2))).toBeLessThan(1);
    expect(Math.abs(previousConnectorRect.bottom - Number.parseFloat(previousConnectorStyle.bottom) - (previewIcon.top + previewIcon.height / 2))).toBeLessThan(1);

    push([tool('a'), tool('b'), tool('c', 'running')]);
    await waitFor(() => Boolean(row(root, 'c')));
    expect(group(root, 'c').dataset.flowerSequence).toBe(groupKey);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    expectConnectorBetween(root, 'b', 'c');
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

  it('reveals a waiting call and restores focus when a two-call group dissolves', async () => {
    const { root, push } = await mount([tool('a'), tool('b', 'running')]);
    const button = toggle(root, 'a'); button.focus(); button.click();
    push([tool('a'), { ...tool('b'), activity: { ...tool('b').activity!, status: 'waiting' } }]);
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

  it('keeps a selected trailing thought expanded when its sequence becomes older', async () => {
    const initial = [tool('a'), item('trailing', 'thinking', 'Keep this selected thought.')];
    const { root, push } = await mount(initial);
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    thinking.querySelector<HTMLButtonElement>('button')!.click();
    await waitFor(() => Boolean(thinking.querySelector('.flower-thinking-content')));
    const content = thinking.querySelector('.flower-thinking-content')!;
    const range = document.createRange(); range.selectNodeContents(content);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    push([...initial, item('progress', 'assistant', 'A new visible progress message.'), tool('c'), tool('d')]);
    await waitFor(() => Boolean(toggle(root, 'c')));
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
