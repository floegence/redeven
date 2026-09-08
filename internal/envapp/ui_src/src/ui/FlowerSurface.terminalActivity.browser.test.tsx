import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import type { FlowerActivityItem, FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapter, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';

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
  await waitFor(() => runtime.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { runtime, live, base };
}
const rowFor = (runtime: HTMLElement, id: string) => runtime.querySelector(`[data-flower-activity-item-id="${id}"]`)!;
const toggleFor = (runtime: HTMLElement, id: string) => rowFor(runtime, id).querySelector<HTMLButtonElement>('.flower-activity-inline-button')!;

describe('SSH terminal activity', () => {
  it('supports keyboard disclosure, safe input facts, empty reads, updates, and reopening a task', async () => {
    const { runtime, live, base } = await mount([write(), read()]);
    const button = toggleFor(runtime, 'write');
    expect(button.textContent).toContain('向 SSH 登录会话提交密码');
    expect(button.querySelector('.flower-activity-inline-chevron')).not.toBeNull();
    expect(getComputedStyle(button).cursor).toBe('pointer');
    button.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    const writeRow = rowFor(runtime, 'write');
    expect(writeRow.textContent).toContain('Bytes sent');
    expect(writeRow.textContent).toContain('12');
    expect(writeRow.textContent).toContain('ssh udesk26');
    expect(writeRow.querySelector('.flower-activity-terminal-output')).toBeNull();
    expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();
    toggleFor(runtime, 'read').click();
    await waitFor(() => rowFor(runtime, 'read').textContent?.includes('No new output.') === true);
    expect(rowFor(runtime, 'read').textContent).toContain('2 / 2');
    expect(rowFor(runtime, 'read').textContent).not.toContain('0–2');
    const nextRead = { ...read(), payload: { ...read().payload, output: 'GPU ready', first_seq: 3, last_seq: 4, latest_seq: 4, has_more: false } };
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor([write(), nextRead], 2) });
    await waitFor(() => rowFor(runtime, 'read').textContent?.includes('GPU ready') === true);
    expect(toggleFor(runtime, 'write').getAttribute('aria-expanded')).toBe('true');
    expect(toggleFor(runtime, 'read').getAttribute('aria-expanded')).toBe('true');
    expect(base.readTerminalProcess).not.toHaveBeenCalled();
    (runtime.querySelector('[data-thread-id="peer"] button') as HTMLButtonElement).click();
    await waitFor(() => !runtime.querySelector('[data-flower-activity-item-id="write"]'));
    (runtime.querySelector('[data-thread-id="terminal-activity"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="write"]')));
    expect(toggleFor(runtime, 'write').getAttribute('aria-expanded')).toBe('true');
    expect(toggleFor(runtime, 'read').getAttribute('aria-expanded')).toBe('true');
    await page.viewport(390, 844);
    await waitFor(() => rowFor(runtime, 'write').clientWidth > 0);
    for (const id of ['write', 'read']) {
      const row = rowFor(runtime, id);
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    await waitFor(() => Array.from(runtime.querySelectorAll('.flower-activity-inline-details')).every((panel) => panel.getAttribute('data-state') === 'open' && panel.getAttribute('data-layout-motion') === 'idle'));
    await page.viewport(1280, 900);
  });

  it('keeps failures and waiting details visible and allows expanding termination', async () => {
    const failure = activityItem({ ...read(), item_id: 'failed', tool_id: 'failed', label: '检查失败的诊断', status: 'error', payload: { operation: 'read', error: { message: 'Session closed' } } });
    const waiting = activityItem({ ...write(), item_id: 'waiting', tool_id: 'waiting', label: '等待 SSH 输入授权', status: 'waiting', requires_approval: true, approval_state: 'requested' });
    const stopped = activityItem({ ...read(), item_id: 'stopped', tool_id: 'stopped', label: '停止诊断任务', payload: { operation: 'terminate', command: 'ssh udesk26', output: 'Stopped', terminated: true } });
    const { runtime } = await mount([write(), failure, waiting, stopped]);
    for (const id of ['failed', 'waiting']) expect(toggleFor(runtime, id).getAttribute('aria-expanded')).toBe('true');
    expect(rowFor(runtime, 'failed').textContent).toContain('Session closed');
    toggleFor(runtime, 'stopped').click();
    await waitFor(() => rowFor(runtime, 'stopped').textContent?.includes('Stopped') === true);
    const commandAction = rowFor(runtime, 'stopped').querySelector<HTMLButtonElement>('.flower-activity-terminal-actions button')!;
    commandAction.focus();
    expect(document.activeElement).toBe(commandAction);
    toggleFor(runtime, 'stopped').click();
    await waitFor(() => document.activeElement === toggleFor(runtime, 'stopped'));
    expect(toggleFor(runtime, 'stopped').getAttribute('aria-expanded')).toBe('false');
  });
});
