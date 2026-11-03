import '../index.css';
import './flower-feature.css';
import { commands, page } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import type { FlowerHistoryRequest, FlowerLiveStreamEnvelope, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, deferred, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it.each([{ offset: 40, chunked: false }, { offset: -28, chunked: false }, { offset: 40, chunked: true }, { offset: -28, chunked: true }])('keeps the visible table row fixed when a clipped preview completes (%j)', async ({ offset, chunked }) => {
  await page.viewport(1440, 1000);
  const seed = thread({ thread_id: 'visible-table-reader', messages: [] });
  const heading = '## Historical weather\n\n| City | Weather | Detail |\n| --- | --- | --- |\n';
  const rows = Array.from({ length: 36 }, (_, i) => '| City ' + i + ' | Clear | Recorded observation ' + i + ' |');
  const preview = heading + rows.slice(0, 12).join('\n');
  const text = heading + rows.join('\n') + '\n\nThe full table is available.';
  const held = deferred<void>();
  const old: FlowerRuntimeCurrentItem = { id: 'visible-table', kind: 'assistant', ordinal: 2, canonical_ordinal: 2,
    turn_id: 'table-turn', run_id: 'table-run', text: preview,
    body: { field: 'content', source_id: 'visible-table', bytes: text.length, preview_bytes: preview.length } };
  const items: FlowerRuntimeCurrentItem[] = [
    { id: 'table-user', kind: 'user', ordinal: 1, canonical_ordinal: 1, turn_id: 'table-turn', run_id: 'table-run', text: 'Read the historical table.' }, old,
    { id: 'following-user', kind: 'user', ordinal: 3, canonical_ordinal: 3, turn_id: 'following-turn', run_id: 'following-run', text: 'Next request.' },
    { id: 'following-answer', kind: 'assistant', ordinal: 4, canonical_ordinal: 4, turn_id: 'following-turn', run_id: 'following-run', text: 'Later answer.\n\n'.repeat(16) },
  ];
  const history = async (_id: string, request: FlowerHistoryRequest) => {
    const selected = request.anchor_id || request.item_ids ? items : items.slice(2);
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, view_version: 1, activity: 'idle', last_outcome: 'completed', items: selected,
      window: { first_item_id: selected[0].id, last_item_id: selected.at(-1)!.id, has_before: selected[0].id !== 'table-user', has_after: false } };
    return { current, thread: applyFlowerRuntimeCurrentView(seed, current) };
  };
  const body = vi.fn(async () => { await held.promise; return { ...old, body: undefined, text }; });
  const chunks = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryBody']>>(async (_tid, input) => {
    await held.promise;
    return { ...input, thread_id: seed.thread_id, bytes: text.length, text: text.slice(input.offset_bytes) };
  });
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed],
    loadHistory: history, loadHistoryItem: body, ...(chunked ? { loadHistoryBody: chunks } : {}),
    async *connectLiveStream({ signal }) {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'visible-table-reader', summaries: [seed] };
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  }, { focusThreadRequest: { request_id: 'open-visible-table', thread_id: seed.thread_id } });
  root.style.height = '880px';
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id=following-answer]')) && !root.querySelector('[data-flower-tail-preparing=true]'));
  const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true }));
  viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id=visible-table] tbody tr')));
  const row = () => root.querySelectorAll<HTMLElement>('[data-flower-message-id=visible-table] tbody tr')[8];
  const targetTop = viewport.getBoundingClientRect().top + offset;
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true }));
  viewport.scrollTop += row().getBoundingClientRect().top - targetTop;
  viewport.dispatchEvent(new Event('scroll'));
  await waitFor(() => chunked ? chunks.mock.calls.length > 0 : body.mock.calls.length > 0);
  await new Promise(resolve => setTimeout(resolve, 150));
  const wheel = commands as unknown as { wheelScrollRegion: (input: { regionSelector: string; deltaY: number; preserveScroll: boolean }) => Promise<unknown> };
  await wheel.wheelScrollRegion({ regionSelector: '.flower-chat-transcript', deltaY: -20, preserveScroll: true });
  await new Promise(resolve => setTimeout(resolve, 150));
  const top = row().getBoundingClientRect().top;
  expect(top).toBeGreaterThan(viewport.getBoundingClientRect().top - 20);
  expect(top).toBeLessThan(viewport.getBoundingClientRect().top + 100);
  const frames: number[] = []; let sampling = true;
  const sample = () => { if (!sampling) return; frames.push(row().getBoundingClientRect().top); requestAnimationFrame(sample); };
  requestAnimationFrame(sample);
  try {
    held.resolve();
    await waitFor(() => root.textContent?.includes('The full table is available.') === true);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(frames.length).toBeGreaterThan(5);
    expect(Math.max(...frames.map(value => Math.abs(value - top)))).toBeLessThanOrEqual(2);
    expect(root.querySelector('.flower-history-text-loading')).toBeNull();
    expect(root.querySelectorAll('[data-flower-message-id=visible-table] tbody tr')).toHaveLength(36);
    if (chunked) { expect(chunks).toHaveBeenCalledOnce(); expect(body).not.toHaveBeenCalled(); }
    else expect(body).toHaveBeenCalledOnce();
  } finally { sampling = false; held.resolve(); }
});

it.each([
  { moving: false, chunked: false, reduced: false, native: false },
  { moving: true, chunked: false, reduced: false, native: false },
  { moving: false, chunked: true, reduced: true, native: false },
  { moving: true, chunked: true, reduced: false, native: false },
  { moving: true, chunked: false, reduced: false, native: true },
  { moving: true, chunked: true, reduced: true, native: true },
])('keeps cold history continuous during live generation (%j)', async ({ moving, chunked, reduced, native }) => {
  await page.viewport(1440, 1000);
  const matchMedia = window.matchMedia.bind(window);
  const media = vi.spyOn(window, 'matchMedia').mockImplementation(query => {
    const result = matchMedia(query);
    if (query.includes('prefers-reduced-motion')) Object.defineProperty(result, 'matches', { value: reduced });
    return result;
  });
  const seed = thread({ thread_id: 'cold-history', messages: [] });
  const preview = '## Earlier report\n\nA completed report with a long results table.\n\n';
  const text = preview + '| City | Weather | Detail |\n| --- | --- | --- |\n'
    + Array.from({ length: 36 }, (_, i) => `| City ${i} | Clear | Recorded historical observation ${i} |`).join('\n')
    + '\n\nThe complete report ends here.';
  const held = deferred<void>();
  const old: FlowerRuntimeCurrentItem = { id: 'old-answer', kind: 'assistant', ordinal: 2, canonical_ordinal: 2,
    turn_id: 'old-turn', run_id: 'old-run', text: preview, body: { field: 'content', source_id: 'old-answer', bytes: text.length, preview_bytes: preview.length } };
  const items: FlowerRuntimeCurrentItem[] = [
    { id: 'old-user', kind: 'user', ordinal: 1, canonical_ordinal: 1, turn_id: 'old-turn', run_id: 'old-run', text: 'Prepare a report.' }, old,
    { id: 'active-user', kind: 'user', ordinal: 3, canonical_ordinal: 3, turn_id: 'active-turn', run_id: 'active-run', text: 'Continue with the next task.' },
    ...Array.from({ length: 24 }, (_, i): FlowerRuntimeCurrentItem => ({ id: `tool-${i}`, kind: 'tool', ordinal: i + 4,
      turn_id: 'active-turn', run_id: 'active-run', activity: { item_id: `tool-${i}`, tool_id: `tool-${i}`, tool_name: 'terminal.exec',
        status: 'success', kind: 'tool', severity: 'quiet', needs_attention: false, requires_approval: false } })),
    { id: 'active-answer', kind: 'assistant', ordinal: 28, turn_id: 'active-turn', run_id: 'active-run', live: true,
      text: 'Current progress.\n\n'.repeat(32) },
  ];
  let version = 1;
  const events: FlowerLiveStreamEnvelope[] = []; let wake: (() => void) | undefined;
  const history = vi.fn(async (_id: string, request: FlowerHistoryRequest) => {
    const selected = request.anchor_id || request.item_ids ? items : items.slice(2);
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, view_version: version, activity: 'active',
      turn_id: 'active-turn', run_id: 'active-run', run_progress: { phase: 'streaming' }, items: selected, interactions: [], queue: [],
      turns: [{ turn_id: 'old-turn', run_id: 'old-run', outcome: 'completed' as const, final_boundary_complete: true, final_item_ids: ['old-answer'],
        started_at: '2026-10-01T00:00:00Z', ended_at: '2026-10-01T00:01:00Z', elapsed_ms: 60000, waiting_ms: 0, work_duration_ms: 60000 }].filter(() => selected.some(item => item.id === 'old-answer')),
      window: { first_item_id: selected[0].id, last_item_id: selected.at(-1)!.id, has_before: selected[0].id !== 'old-user', has_after: false } };
    return { current, thread: applyFlowerRuntimeCurrentView(seed, current) };
  });
  const body = vi.fn(async () => { await held.promise; return { ...old, body: undefined, text }; });
  const chunks = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryBody']>>(async (_tid, input) => {
    const first = input.offset_bytes === preview.length;
    if (!first) await held.promise;
    const end = first ? preview.length + 200 : text.length;
    return { ...input, thread_id: seed.thread_id, bytes: text.length, text: text.slice(input.offset_bytes, end) };
  });
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistory: history, loadHistoryItem: body, ...(chunked ? { loadHistoryBody: chunks } : {}),
    async *connectLiveStream({ signal }) {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'cold-observer', summaries: [seed] };
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const event = events.shift(); if (event) yield event; else await new Promise<void>(resolve => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
  }, { focusThreadRequest: { request_id: 'open-cold', thread_id: seed.thread_id } });
  root.style.height = '880px';
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id=active-answer]')) && !root.querySelector('[data-flower-tail-preparing=true]'));
  const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
  await new Promise(resolve => setTimeout(resolve, 100));
  const editor = root.querySelector<HTMLTextAreaElement>('textarea')!;
  editor.focus(); editor.value = 'Preserve the next request'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  const anchor = root.querySelector<HTMLElement>('[data-flower-message-id=active-user]')!;
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
  viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
  let expectedTop = anchor.getBoundingClientRect().top;
  let nativeMovement = false;
  const samples: { drift: number; skeleton: boolean; scroll: number; height: number }[] = []; let sampling = true;
  const sample = () => { samples.push({ drift: Math.max(0, expectedTop - anchor.getBoundingClientRect().top, anchor.getBoundingClientRect().top - expectedTop - (nativeMovement ? 60 : 0)), scroll: viewport.scrollTop, height: viewport.scrollHeight, skeleton: Boolean(viewport.querySelector('.flower-history-text-loading')) }); if (sampling) requestAnimationFrame(sample); };
  requestAnimationFrame(sample);
  try {
    await waitFor(() => chunked ? chunks.mock.calls.length === 2 : body.mock.calls.length > 0);
    const oldRow = root.querySelector<HTMLElement>('[data-flower-message-id=old-answer]')!;
    const bubble = oldRow.querySelector('.flower-message-bubble');
    expect(oldRow.textContent).toContain('A completed report with a long results table.');
    expect(oldRow.querySelector('table')).toBeNull();
    const answer = items.at(-1)!; const suffix = 'Live updates continue.\n\n';
    events.push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id, reading_revision: history.mock.calls.at(-1)![1].reading_revision,
      update: { thread_id: seed.thread_id, turn_id: 'active-turn', run_id: 'active-run', base_version: version++, view_version: version,
        facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
        items: [{ kind: 'append', item_id: answer.id, append: { offset_bytes: answer.text!.length, text: suffix } }] } }); wake?.();
    await new Promise(resolve => setTimeout(resolve, 100));
    if (native) {
      nativeMovement = true;
      viewport.addEventListener('wheel', () => held.resolve(), { once: true });
      const wheel = commands as unknown as { wheelScrollRegion: (input: { regionSelector: string; deltaY: number; preserveScroll: boolean }) => Promise<unknown> };
      await wheel.wheelScrollRegion({ regionSelector: '.flower-chat-transcript', deltaY: -60, preserveScroll: true });
    } else if (moving) {
      const before = viewport.scrollTop;
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, bubbles: true }));
      viewport.scrollTop -= 60;
      expectedTop -= viewport.scrollTop - before;
      viewport.dispatchEvent(new Event('scroll'));
    }
    held.resolve();
    await waitFor(() => root.textContent?.includes('The complete report ends here.') === true);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(samples.length).toBeGreaterThan(5);
    expect(Math.max(...samples.map(sample => sample.drift))).toBeLessThanOrEqual(2);
    expect(samples.every(sample => !sample.skeleton)).toBe(true);
    if (native) expect(anchor.getBoundingClientRect().top - expectedTop).toBeCloseTo(60, 0);
    expect(root.textContent).toContain(suffix.trim());
    expect(oldRow.querySelector('.flower-message-bubble')).toBe(bubble);
    expect(oldRow.querySelectorAll('tbody tr')).toHaveLength(36);
    expect(oldRow.querySelector('[data-flower-history-body-pending]')).toBeNull();
    expect(root.querySelector('textarea')).toBe(editor);
    expect(editor.value).toBe('Preserve the next request');
    expect(document.activeElement).toBe(editor);
    if (chunked) { expect(chunks).toHaveBeenCalledTimes(2); expect(body).not.toHaveBeenCalled(); }
    else expect(body).toHaveBeenCalledOnce();
  } finally { sampling = false; held.resolve(); media.mockRestore(); }
});
