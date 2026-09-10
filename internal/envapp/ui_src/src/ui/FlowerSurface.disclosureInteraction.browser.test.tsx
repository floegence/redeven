import '../index.css';
import './flower-feature.css';

import { commands, page, userEvent } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowerActivityItem, FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapter, runtimeCurrentView, subagentDetail, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function fixture(items: readonly FlowerActivityItem[]) {
  return thread({ thread_id: 'terminal-activity', title: 'SSH GPU diagnostics', status: 'running', active_run_id: 'run-terminal', messages: [{
    id: 'terminal-message', turn_id: 'turn-terminal', run_id: 'run-terminal', role: 'assistant', content: '', status: 'streaming', created_at_ms: 10,
    blocks: [activityTimeline({ thread_id: 'terminal-activity', run_id: 'run-terminal', turn_id: 'turn-terminal', status: 'running', items: [...items] })],
  }] });
}
function currentFor(items: readonly FlowerActivityItem[], version: number) {
  const current = runtimeCurrentView(fixture(items), version);
  return { ...current, items: current.items?.map((item) => {
    if (!item.activity) return item;
    const { label, description, renderer, payload, chips, target_refs, ...facts } = item.activity;
    return { ...item, activity: { ...facts, presentation: { label, description, renderer, payload, chips, target_refs } } };
  }) };
}

const write = () => activityItem({ item_id: 'write', tool_id: 'write', tool_name: 'terminal.write', renderer: 'terminal', label: '向 SSH 登录会话提交密码', status: 'success', payload: { operation: 'write', command: 'ssh udesk26', process_id: 'process-1', input_bytes: 12 } });
const read = () => activityItem({ item_id: 'read', tool_id: 'read', tool_name: 'terminal.read', renderer: 'terminal', label: '检查 GPU/LM Studio 诊断输出', status: 'success', payload: { operation: 'read', command: 'ssh udesk26 nvidia-smi', process_id: 'process-1', output: '', last_seq: 2, latest_seq: 2 } });

function stream() {
  const queue: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  return {
    push(value: FlowerLiveStreamEnvelope) { queue.push(value); wake?.(); },
    async *connect({ signal }: { signal: AbortSignal }): AsyncIterable<FlowerLiveStreamEnvelope> {
      while (!signal.aborted) {
        const value = queue.shift();
        if (value) { yield value; continue; }
        await new Promise<void>((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
      }
    },
  };
}

async function mount(items: readonly FlowerActivityItem[]) {
  const current = fixture(items);
  const peer = thread({ thread_id: 'peer', title: 'Another task' });
  const live = stream();
  const base = adapter(true);
  const runtime = renderSurfaceWithAdapter({ ...base, listThreads: vi.fn(async () => [current, peer]), loadThread: vi.fn(async (id) => liveBootstrap(id === peer.thread_id ? peer : current, 1)), connectLiveStream: live.connect });
  runtime.style.height = '780px';
  await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="terminal-activity"] button')));
  (runtime.querySelector('[data-thread-id="terminal-activity"] button') as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="write"]')));
  return { runtime, live };
}
const rowFor = (runtime: HTMLElement, id: string) => runtime.querySelector(`[data-flower-activity-item-id="${id}"]`)!;
const toggleFor = (runtime: HTMLElement, id: string) => rowFor(runtime, id).querySelector<HTMLButtonElement>('.flower-activity-inline-button')!;

beforeEach(async () => { await page.viewport(1280, 900); });

describe('Activity disclosure interaction', () => {
  it.each([60, 100, 160])('preserves a real mouse click during a %i ms press and live append', async (pressDuration) => {
    await page.viewport(1280, 900);
    const items = [write(), ...Array.from({ length: 24 }, (_, index) => activityItem({
      ...read(), item_id: `read-${index}`, tool_id: `read-${index}`, label: `Check diagnostic output ${index}`,
    }))];
    const { runtime, live } = await mount(items);
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor(items, 2) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const target = toggleFor(runtime, 'read-23');
    await waitFor(() => runtime.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let before = 0;
    const activated = vi.fn();
    target.addEventListener('click', activated);
    target.addEventListener('pointerdown', () => {
      before = target.getBoundingClientRect().top;
      setTimeout(() => {
        const nextItems = [...items, ...Array.from({ length: 4 }, (_, index) => activityItem({
          ...read(), item_id: `new-${index}`, tool_id: `new-${index}`, label: `Next diagnostic ${index}`,
        }))];
        live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor(nextItems, 3) });
      }, 10);
    }, { once: true });
    await userEvent.click(target, { delay: pressDuration });
    await waitFor(() => Boolean(rowFor(runtime, 'new-3')));
    expect(target).toBe(toggleFor(runtime, 'read-23'));
    expect(Math.abs(target.getBoundingClientRect().top - before)).toBeLessThanOrEqual(1);
    expect(target.getAttribute('aria-expanded')).toBe('true');
    expect(activated).toHaveBeenCalledTimes(1);
    await waitFor(() => rowFor(runtime, 'read-23').getAttribute('data-state') === 'open');
    expect(rowFor(runtime, 'read-23').querySelector('.flower-activity-inline-details')!.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it('protects content from an already visible float while the composer resizes', async () => {
    const items = [write(), ...Array.from({ length: 24 }, (_, index) => activityItem({
      ...read(), item_id: `read-${index}`, tool_id: `read-${index}`, label: `Check diagnostic output ${index}`,
    }))];
    const { runtime, live } = await mount(items);
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor(items, 2) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; deltaY: number }) => Promise<unknown> };
    await wheel.wheelScrollRegion({ regionSelector: '.flower-chat-transcript', deltaY: -180 });
    await waitFor(() => Boolean(runtime.querySelector('.flower-scroll-to-latest-button')));
    const latest = runtime.querySelector<HTMLButtonElement>('.flower-scroll-to-latest-button')!;
    const latestClick = vi.fn();
    latest.addEventListener('click', latestClick);
    const target = toggleFor(runtime, 'read-16');
    const titleClick = vi.fn();
    target.addEventListener('click', titleClick);
    let wasBlocked = false;
    let titleTop = 0;
    target.addEventListener('pointerdown', () => {
      titleTop = target.getBoundingClientRect().top;
      setTimeout(() => {
        wasBlocked = getComputedStyle(latest).pointerEvents === 'none';
        const composer = runtime.querySelector<HTMLElement>('.flower-chat-bottom-dock-track')!;
        composer.style.minHeight = `${composer.clientHeight + 48}px`;
        live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor([...items, { ...read(), item_id: 'new-output', tool_id: 'new-output' }], 3) });
      }, 10);
    }, { once: true });
    await userEvent.click(target, { delay: 160 });
    expect(wasBlocked).toBe(true);
    expect(titleClick).toHaveBeenCalledTimes(1);
    expect(latestClick).not.toHaveBeenCalled();
    expect(target.getAttribute('aria-expanded')).toBe('true');
    expect(Math.abs(target.getBoundingClientRect().top - titleTop)).toBeLessThanOrEqual(1);
    expect(getComputedStyle(latest.parentElement!).position).toBe('absolute');
    await waitFor(() => latest.getAttribute('data-pointer-blocked') !== 'true');

    latest.addEventListener('pointerdown', () => {
      setTimeout(() => {
        const viewport = runtime.querySelector<HTMLElement>('.flower-chat-transcript')!;
        viewport.scrollTop = viewport.scrollHeight;
        viewport.dispatchEvent(new Event('scroll'));
      }, 10);
    }, { once: true });
    await userEvent.click(latest, { delay: 160 });
    expect(latestClick).toHaveBeenCalledTimes(1);
    await waitFor(() => !runtime.querySelector('.flower-scroll-to-latest-button'));
  });

  it('keeps an early tool button and manual choice as safe details and file errors arrive', async () => {
    const early = activityItem({ item_id: 'early', tool_id: 'early', tool_name: 'use_skill', renderer: 'structured', label: 'diagnostic-guide', status: 'running', payload: {} });
    const file = activityItem({ item_id: 'file', tool_id: 'file', tool_name: 'read_file', renderer: 'file', label: 'Read project guide', status: 'error', payload: { operation: 'read', display_name: 'README.md', error: { message: 'Access denied' } } });
    const { runtime, live } = await mount([write(), early, file]);
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor([write(), early, file], 2) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const button = toggleFor(runtime, 'early');
    expect(button.tagName).toBe('BUTTON');
    button.focus();
    await userEvent.keyboard(' ');
    await waitFor(() => rowFor(runtime, 'early').textContent?.includes('Waiting for tool details') === true);
    expect(toggleFor(runtime, 'file').getAttribute('aria-expanded')).toBe('false');
    expect(rowFor(runtime, 'file').textContent).toContain('Access denied');
    const ready = { ...early, status: 'success' as const, payload: { operation: 'use_skill', rows: [{ title: 'Guide loaded', content: 'Ready for diagnostics', format: 'text' }] } };
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor([write(), ready, file], 3) });
    await waitFor(() => rowFor(runtime, 'early').textContent?.includes('Ready for diagnostics') === true);
    expect(toggleFor(runtime, 'early')).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(button);
    const failed = { ...ready, status: 'error' as const, payload: { error: { message: 'Guide refresh failed' } } };
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor([write(), failed, file], 4) });
    await waitFor(() => rowFor(runtime, 'early').getAttribute('data-flower-activity-status') === 'error');
    expect(toggleFor(runtime, 'early')).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(button);
    await waitFor(() => rowFor(runtime, 'early').getAttribute('data-state') === 'open');
    expect(rowFor(runtime, 'early').textContent).toContain('Guide refresh failed');
  });


  it('keeps following through automatic attention expansion without claiming a reading anchor', async () => {
    const items = [write(), ...Array.from({ length: 24 }, (_, index) => activityItem({
      ...read(), item_id: `read-${index}`, tool_id: `read-${index}`, label: `Check diagnostic output ${index}`,
    }))];
    const { runtime, live } = await mount(items);
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor(items, 2) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const waiting = items.map((item) => item.item_id === 'read-23'
      ? { ...item, status: 'waiting' as const, needs_attention: true }
      : item);
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor(waiting, 3) });
    await waitFor(() => rowFor(runtime, 'read-23').getAttribute('data-state') === 'open');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const viewport = runtime.querySelector<HTMLElement>('.flower-chat-transcript')!;
    expect(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight).toBeLessThanOrEqual(1);
    expect(runtime.querySelector('.flower-scroll-to-latest-button')).toBeNull();
  });


  it('preserves a native child-tool press during streamed child updates without scrolling the parent', async () => {
    const parent = fixture([write()]);
    const child = subagentSummary({ parent_thread_id: parent.thread_id, thread_id: 'diagnostic-child', status: 'running' });
    const items = Array.from({ length: 24 }, (_, index) => activityItem({
      ...read(), item_id: `child-read-${index}`, tool_id: `child-read-${index}`, status: 'running', label: `Inspect child diagnostic ${index}`,
    }));
    const childCurrent = (rows: typeof items, version: number) => ({ ...currentFor(rows, version), thread_id: child.thread_id });
    const live = stream();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [parent]),
      loadThread: vi.fn(async () => liveBootstrap(parent, 1)), connectLiveStream: live.connect,
      loadSubagentDetail: vi.fn(async () => subagentDetail({ summary: child, current: childCurrent(items, 1) })),
    });
    runtime.style.height = '780px';
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${parent.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${parent.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="write"]')));
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: parent.thread_id, subagents: [child] });
    await waitFor(() => runtime.querySelector('.flower-header-icon-badge')?.textContent === '1');
    runtime.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row="0"]')));
    document.querySelector<HTMLButtonElement>('[data-flower-subagent-row="0"]')!.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-activity-item-id="child-read-23"]')));
    const detail = document.querySelector<HTMLElement>('[data-flower-subagent-detail="open"]')!;
    const floatingWindow = detail.closest<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
    await waitFor(() => floatingWindow.dataset.floatingPresence === 'open');
    const title = toggleFor(detail, 'child-read-23');
    const parentViewport = runtime.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const beforeParent = parentViewport.scrollTop;
    let beforeTitle = 0;
    const clicked = vi.fn();
    title.addEventListener('click', clicked);
    title.addEventListener('pointerdown', () => {
      beforeTitle = title.getBoundingClientRect().top;
      setTimeout(() => {
        const appended = [...items, ...Array.from({ length: 4 }, (_, index) => activityItem({
          ...read(), item_id: `new-child-${index}`, tool_id: `new-child-${index}`, status: 'running',
        }))];
        live.push({ schema_version: 1, kind: 'thread.batch', thread_id: parent.thread_id, subagent_current: childCurrent(appended, 2) });
      }, 10);
    }, { once: true });
    await userEvent.click(title, { delay: 160 });
    await waitFor(() => Boolean(rowFor(detail, 'new-child-3')));
    expect(title).toBe(toggleFor(detail, 'child-read-23'));
    expect(title.getAttribute('aria-expanded')).toBe('true');
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(Math.abs(title.getBoundingClientRect().top - beforeTitle)).toBeLessThanOrEqual(1);
    expect(parentViewport.scrollTop).toBe(beforeParent);
  });

});
