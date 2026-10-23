import '../index.css';
import './flower-feature.css';
import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import type { FlowerSubagentDetail, FlowerSubagentInputOperation } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, subagentDetail, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function fixture() {
  const summary = subagentSummary();
  const parent = thread({ thread_id: summary.parent_thread_id, status: 'running', subagents: [summary] });
  const base = subagentDetail({ summary });
  const detail: FlowerSubagentDetail = { ...base, current: { ...base.current, run_progress: { phase: 'streaming' }, items: [
    { id: 'guide', kind: 'steering', text: 'Prioritize original sources', turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: 1, steering: { status: 'pending' } },
  ], queue: ['first', 'second'].map(id => ({ id, request_key: id, created_at: '2026-10-14T00:00:00Z', input_fingerprint: `fingerprint-${id}`, input: { text: `Instruction ${id}` } })) } };
  return { parent, detail };
}
async function mount(operate: (parent: string, child: string, input: FlowerSubagentInputOperation) => Promise<FlowerSubagentDetail>, load?: () => Promise<FlowerSubagentDetail>, bounded = false) {
  await page.viewport(1280, 1000);
  const { parent, detail } = fixture();
  let presented = false;
  const call = vi.fn(operate), loadDetail = vi.fn(load ?? (async () => detail));
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => liveBootstrap(parent, 1)), loadSubagentDetail: loadDetail, operateSubagentInput: call,
    ...(bounded ? { loadHistory: vi.fn(async () => liveBootstrap(parent, 1)) } : {}),
  }, { onThreadSelectionEvent: event => { if (event.phase === 'content_presented') presented = true; } });
  runtime.style.height = '850px';
  await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${parent.thread_id}"] button`)));
  (runtime.querySelector(`[data-thread-id="${parent.thread_id}"] button`) as HTMLButtonElement).click();
  await waitFor(() => presented && Boolean(runtime.querySelector('button[aria-controls="flower-subagents-dropdown"]')));
  (runtime.querySelector('button[aria-controls="flower-subagents-dropdown"]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row]')));
  (document.querySelector('[data-flower-subagent-row]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-input-id="first"]')));
  return { runtime, detail, call, loadDetail };
}
const row = (id = 'first') => document.querySelector<HTMLElement>(`[data-flower-subagent-input-id="${id}"]`)!;
const buttons = (id = 'first') => [...row(id).querySelectorAll<HTMLButtonElement>('button')];

describe('Subagent immediate guidance controls', () => {
  it('scopes busy state and removes applied guidance status while preserving the message and window', async () => {
    await page.viewport(1280, 1000);
    const pending = deferred<FlowerSubagentDetail>();
    const { detail, call, runtime } = await mount(() => pending.promise);
    const window = document.querySelector<HTMLElement>('.flower-subagent-detail-window')!;
    const message = window.querySelector('[data-flower-message-id="guide"]');
    expect(message?.textContent).toContain('Prioritize original sources');
    expect(document.querySelector('[data-flower-steering-status="pending"]')).not.toBeNull();
    buttons()[0].focus(); await userEvent.keyboard('{Enter}');
    await waitFor(() => call.mock.calls.length === 1);
    expect(buttons().every(button => button.disabled)).toBe(true);
    expect(buttons('second').every(button => !button.disabled)).toBe(true);
    expect(call.mock.calls[0]).toEqual([detail.summary.parent_thread_id, detail.summary.thread_id, expect.objectContaining({ action: 'steer_queue', item_id: 'first', expected_input_fingerprint: 'fingerprint-first' })]);
    expect(runtime.querySelector<HTMLButtonElement>('[data-flower-primary-action="stop"]')?.disabled).toBe(false);
    pending.resolve({ ...detail, current: { ...detail.current, view_version: 8, queue: detail.current.queue!.slice(1), items: detail.current.items!.map(item => ({ ...item, steering: { status: 'applied' as const } })) } });
    await waitFor(() => !document.querySelector('[data-flower-subagent-input-id="first"]'));
    expect(document.querySelector('.flower-subagent-detail-window')).toBe(window);
    expect(window.querySelector('.flower-steering-status')).toBeNull();
    expect(window.textContent).not.toContain('Added to context');
    expect(window.querySelector('[data-flower-message-id="guide"]')).toBe(message);
    expect(message?.textContent).toContain('Prioritize original sources');
    await page.viewport(540, 850);
    await waitFor(() => window.getBoundingClientRect().width < 540);
    expect(window.scrollWidth).toBeLessThanOrEqual(window.clientWidth + 1);
    for (const button of buttons('second')) { expect(getComputedStyle(button).cursor).toBe('pointer'); expect(getComputedStyle(button).whiteSpace).toBe('nowrap'); }
    await page.screenshot({ element: window, path: '__screenshots__/subagent-steering/narrow.png' });
  });
  it('keeps a bounded child interval while refreshing after a command receipt', async () => {
    const source = fixture().detail;
    const bounded: FlowerSubagentDetail = { ...source, window: { first_item_id: 'guide', last_item_id: 'guide', has_before: true, has_after: true } };
    const reload = deferred<FlowerSubagentDetail>();
    let reads = 0;
    const { loadDetail } = await mount(async () => ({ ...source, current: { ...source.current, view_version: 40, items: [] } }), async () => ++reads === 1 ? bounded : reload.promise, true);
    const window = document.querySelector<HTMLElement>('.flower-subagent-detail-window')!;
    const message = window.querySelector('[data-flower-message-id="guide"]');
    buttons()[0].click();
    await waitFor(() => loadDetail.mock.calls.length === 2);
    expect(window.querySelector('[data-flower-message-id="guide"]')).toBe(message);
    expect(window.textContent).toContain('Earlier messages');
    expect(window.textContent).toContain('Newer messages');
    expect(window.querySelector('.flower-subagent-detail-loading')).toBeNull();
    reload.resolve({ ...bounded, current: { ...bounded.current, view_version: 41, queue: bounded.current.queue!.slice(1) } });
    await waitFor(() => !document.querySelector('[data-flower-subagent-input-id="first"]'));
    expect(window.querySelector('[data-flower-message-id="guide"]')).toBe(message);
  });
  it('refreshes a conflict and keeps removal and a stable retry available', async () => {
    let attempts = 0;
    const { detail, call, loadDetail } = await mount(async () => { if (++attempts === 1) throw Object.assign(new Error('changed'), { status: 409, code: 'subagent_input_conflict' }); return fixture().detail; });
    buttons()[0].click();
    await waitFor(() => Boolean(row().querySelector('[role="alert"]')));
    await waitFor(() => loadDetail.mock.calls.length === 2);
    expect(buttons().every(button => !button.disabled)).toBe(true);
    buttons()[0].click(); await waitFor(() => call.mock.calls.length === 2);
    expect(call.mock.calls[1][2]).toEqual(call.mock.calls[0][2]);
    await waitFor(() => !buttons()[0].disabled);
    buttons()[1].click(); await waitFor(() => call.mock.calls.length === 3);
    expect(call.mock.calls[2]).toEqual([detail.summary.parent_thread_id, detail.summary.thread_id, expect.objectContaining({ action: 'remove_queue', item_id: 'first' })]);
  });
  it('explains a busy execution and leaves queue actions recoverable', async () => {
    const { loadDetail } = await mount(async () => { throw Object.assign(new Error('busy'), { status: 409, code: 'subagent_input_busy' }); });
    buttons()[0].click();
    await waitFor(() => row().querySelector('[role="alert"]')?.textContent?.includes('stopping or compacting context') === true);
    await waitFor(() => loadDetail.mock.calls.length === 2);
    expect(buttons().every(button => !button.disabled)).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.flower-subagent-detail-window button[aria-label="Close"]')?.disabled).toBe(false);
  });
  it('allows closing during a request and ignores the late response', async () => {
    const pending = deferred<FlowerSubagentDetail>();
    const { detail } = await mount(() => pending.promise);
    buttons()[0].click();
    const window = document.querySelector<HTMLElement>('.flower-subagent-detail-window')!;
    const close = window.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    expect(close?.disabled).toBe(false); close.click();
    await waitFor(() => !document.querySelector('.flower-subagent-detail-window'));
    pending.resolve({ ...detail, current: { ...detail.current, view_version: 20, queue: [] } });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(document.querySelector('.flower-subagent-detail-window')).toBeNull();
  });
  it('offers explicit resubmission only for unapplied guidance cancelled by Stop', async () => {
    const source = fixture().detail;
    const visible: FlowerSubagentDetail = { ...source, current: { ...source.current, items: ['stopped', 'effect_outcome_unknown'].map((reason, index) => ({ id: reason, kind: 'steering', text: `Retained instruction ${index}`, turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: index + 1, steering: { status: 'cancelled', reason } })) } };
    const { call } = await mount(async () => visible, async () => visible);
    const resends = [...document.querySelectorAll<HTMLButtonElement>('.flower-steering-status button')];
    expect(resends).toHaveLength(1); resends[0].click();
    await waitFor(() => call.mock.calls.length === 1);
    expect(call.mock.calls[0][2]).toMatchObject({ action: 'resend_steering', item_id: 'stopped' });
  });
  it('creates a fresh request after canonical queue content changes', async () => {
    let value = fixture().detail;
    let attempts = 0;
    const { call } = await mount(async () => {
      if (++attempts === 1) {
        value = { ...value, current: { ...value.current, view_version: 9, queue: value.current.queue!.map(item => item.id === 'first' ? { ...item, input_fingerprint: 'revised-fingerprint', input: { text: 'Revised instruction' } } : item) } };
        throw Object.assign(new Error('changed'), { status: 409, code: 'subagent_input_conflict' });
      }
      return value;
    }, async () => value);
    buttons()[0].click();
    await waitFor(() => row().textContent?.includes('Revised instruction') === true);
    buttons()[0].click();
    await waitFor(() => call.mock.calls.length === 2);
    expect(call.mock.calls[1][2].expected_input_fingerprint).toBe('revised-fingerprint');
    expect(call.mock.calls[1][2].client_request_id).not.toBe(call.mock.calls[0][2].client_request_id);
  });

});
