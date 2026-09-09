import '../index.css';
import './flower-feature.css';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { streamingFixture } from '../../../../flower_ui/testing/streamingFixture';
import { adapter, inputRequest, liveBootstrap, renderSurfaceWithAdapter, runtimeCurrentView, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function liveStream() {
  const values: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  return {
    push(current: FlowerRuntimeCurrentView) { values.push({ schema_version: 1, kind: 'thread.batch', thread_id: current.thread_id, current }); wake?.(); },
    async *connect({ signal }: { signal: AbortSignal }) {
      const abort = () => wake?.();
      signal.addEventListener('abort', abort, { once: true });
      try {
        while (!signal.aborted) {
          const value = values.shift();
          if (value) yield value;
          else await new Promise<void>((resolve) => { wake = resolve; });
        }
      } finally { signal.removeEventListener('abort', abort); }
    },
  };
}

describe('Flower streaming presentation stability', () => {
  it('retains queued controls and history through 300 text updates', async () => {
    await page.viewport(1280, 900);
    const seed = thread({
      thread_id: 'stream-stability', status: 'running',
      messages: [
        { id: 'history', role: 'user', content: 'Stable history', status: 'complete', created_at_ms: 1, turn_id: 'turn-1', run_id: 'run-1' },
        { id: 'reply', role: 'assistant', content: 'Streaming', status: 'streaming', created_at_ms: 2, turn_id: 'turn-1', run_id: 'run-1', live: true, active_cursor: true },
      ],
      queued_turn_count: 2,
      queued_turns: [{ queue_id: 'q1', prompt: 'Next task', created_at_ms: 10 }, { queue_id: 'q2', prompt: 'Another task', created_at_ms: 11 }],
    });
    const live = liveStream();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [seed]), loadThread: vi.fn(async () => liveBootstrap(seed, 1)), connectLiveStream: live.connect,
      deleteQueuedTurn: vi.fn(async () => liveBootstrap(seed, 2)),
    });
    runtime.style.height = '780px';
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="stream-stability"] button')));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="stream-stability"] button')!.click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 2);
    live.push({ ...runtimeCurrentView(seed, 2), items: runtimeCurrentView(seed, 2).items?.map((item) => item.id === 'reply' ? { ...item, live: true, text: 'Streaming 2' } : item) });
    await waitFor(() => runtime.textContent?.includes('Streaming 2') === true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const queued = runtime.querySelector<HTMLElement>('[data-flower-queued-turn-dock-id="q1"]')!;
    const button = queued.querySelector<HTMLButtonElement>('[data-flower-queued-turn-delete]')!;
    const history = runtime.querySelector<HTMLElement>('[data-flower-message-id="history"]')!;
    const rail = runtime.querySelector<HTMLElement>('[data-thread-id="stream-stability"]')!;
    const composer = runtime.querySelector<HTMLTextAreaElement>('textarea')!;
    await userEvent.hover(button);
    button.focus();
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(queued.parentElement!, { childList: true, subtree: true });
    observer.observe(history, { childList: true, subtree: true });
    observer.observe(rail, { childList: true, subtree: true });
    for (let version = 3; version <= 302; version += 1) {
      const current = runtimeCurrentView(seed, version);
      live.push({ ...current, items: current.items?.map((item) => item.id === 'reply' ? { ...item, live: true, text: `Streaming ${version}` } : item) });
      await Promise.resolve();
    }
    await waitFor(() => runtime.textContent?.includes('Streaming 302') === true);
    changes.push(...observer.takeRecords());
    observer.disconnect();
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="q1"]')).toBe(queued);
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(button.matches(':hover')).toBe(true);
    expect(runtime.querySelector('textarea')).toBe(composer);
    expect(runtime.querySelector('[data-thread-id="stream-stability"]')).toBe(rail);
    expect(runtime.querySelector('[data-flower-message-id="history"]')).toBe(history);
    expect(changes.filter((record) => record.addedNodes.length || record.removedNodes.length).map((record) => ({
      target: (record.target as Element).outerHTML, added: [...record.addedNodes].map((node) => node.textContent), removed: [...record.removedNodes].map((node) => node.textContent),
    }))).toEqual([]);
  });
});

// Use complete runtime facts for the same shared component exercised by the
// production-build performance runner; controls are not replaced with stubs.

async function mountFixture(fixture: ReturnType<typeof streamingFixture>, overrides: Partial<FlowerSurfaceAdapter> = {}) {
  const runtime = renderSurfaceWithAdapter({ ...adapter(true), ...fixture.adapter, ...overrides });
  runtime.style.height = '780px';
  await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${fixture.thread.thread_id}"] button`)));
  runtime.querySelector<HTMLButtonElement>(`[data-thread-id="${fixture.thread.thread_id}"] button`)!.click();
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="streaming-tail"]')));
  await waitFor(() => runtime.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  return runtime;
}
async function unrelatedUpdates(fixture: ReturnType<typeof streamingFixture>, count = 300) {
  for (let index = 0; index < count; index += 1) {
    const current = structuredClone(fixture.current());
    fixture.replace({ ...current, view_version: current.view_version + 1, items: current.items?.map((item) => item.id === 'streaming-tail' ? { ...item, text: `Unrelated stream update ${index}` } : item) });
    await Promise.resolve();
  }
}

describe('Flower complete interaction subtree stability', () => {
  it('keeps queue drag ownership and row nodes through 300 updates and a real reorder', async () => {
    const fixture = streamingFixture(8, 0);
    const reorder = vi.fn(async (_threadID: string, ids: readonly string[]) => {
      const current = fixture.current();
      const reordered = { ...current, view_version: current.view_version + 1, queue: ids.map((id) => current.queue!.find((item) => item.id === id)!) };
      fixture.replace(reordered);
      return { thread: applyFlowerRuntimeCurrentView(fixture.thread, reordered), current: reordered };
    });
    const runtime = await mountFixture(fixture, { reorderQueuedTurns: reorder });
    const rows = [...runtime.querySelectorAll<HTMLElement>('[data-flower-queued-turn-dock-id]')];
    const transfer = new DataTransfer();
    rows[0]!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await unrelatedUpdates(fixture);
    await waitFor(() => runtime.textContent?.includes('Unrelated stream update 299') === true);
    expect(rows[0]!.getAttribute('data-flower-queued-turn-dragging')).toBe('true');
    expect([...runtime.querySelectorAll('[data-flower-queued-turn-dock-id]')]).toEqual(rows);
    for (const type of ['dragover', 'drop']) rows[1]!.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientY: rows[1]!.getBoundingClientRect().bottom + 1, dataTransfer: transfer }));
    await waitFor(() => reorder.mock.calls.length === 1);
    expect(reorder).toHaveBeenCalledWith(fixture.thread.thread_id, ['queued-second', 'queued-first']);
    await waitFor(() => runtime.querySelector('[data-flower-queued-turn-dock-id]') === rows[1]);
    expect([...runtime.querySelectorAll('[data-flower-queued-turn-dock-id]')]).toEqual([rows[1], rows[0]]);
  });

  it('retains open tool details, selection, readers and observers through 300 unrelated snapshots', async () => {
    const fixture = streamingFixture(16, 5);
    const source = fixture.current();
    const extraDetails = [
      { renderer: 'patch', tool_name: 'apply_patch', target_refs: [{ kind: 'file_action:patch-file', label: 'app.ts' }], payload: { mutations: [{ display_name: 'app.ts', change_type: 'update', additions: 1, deletions: 1, unified_diff: '@@ -1 +1 @@\n-old\n+new\n' }] } },
      { renderer: 'structured', tool_name: 'inspect', payload: { summary: 'Verified file permissions' } },
      { renderer: 'structured', tool_name: 'inspect', status: 'error', payload: { error: { message: 'Visible tool failure' } } },
      { renderer: 'question', tool_name: 'ask_user', payload: { questions: [{ id: 'historical-question', question: 'Choose a route', options: ['Fast', 'Scenic'] }] } },
      { renderer: 'subagent_operation', tool_name: 'subagents', payload: { action: 'wait', targets: [{ thread_id: 'detail-child', task_name: 'Review', status: 'completed' }] } },
      { renderer: 'web_fetch', tool_name: 'web_fetch', payload: { url: 'https://example.com/guide', format: 'markdown', content_preview: '# Stable document\n\nVisible excerpt' } },
    ];
    const extraItems = extraDetails.map(({ tool_name, status, ...presentation }, index) => ({ id: `extra-${index}`, turn_id: source.turn_id!, run_id: source.run_id!, ordinal: source.items!.length + index + 1, kind: 'tool' as const, activity: { item_id: `extra-${index}`, tool_id: `extra-${index}`, tool_name, kind: 'tool', status: status ?? 'success', severity: 'quiet', needs_attention: false, requires_approval: false, presentation: { label: `Extra detail ${index}`, ...presentation } } }));
    const current = { ...source, items: [...source.items!.slice(0, -1), ...extraItems, source.items!.at(-1)!] };

    fixture.replace({ ...current, items: current.items?.map((item) => item.id !== 'tool-0' ? item : { ...item, activity: { ...item.activity, status: 'running', presentation: { ...item.activity?.presentation as object, payload: { operation: 'exec', command: 'git status', process_id: 'fixture-process', output: 'Stable terminal output', first_seq: 1, last_seq: 1 } } } }) });
    const runtime = await mountFixture(fixture);
    for (const button of runtime.querySelectorAll<HTMLButtonElement>('[data-flower-disclosure-trigger][aria-expanded="false"]')) button.click();
    await waitFor(() => runtime.querySelectorAll('.flower-activity-inline-details[data-state="open"]').length === 11);
    const roots = [...runtime.querySelectorAll('.flower-activity-inline-details')];
    for (const selector of ['.flower-activity-terminal-output', '.flower-activity-file-read', '.flower-activity-structured-rows', '.flower-activity-todo-list', '.flower-activity-web-panel', '.flower-activity-file-diff-file', '.flower-activity-inline-detail-line', '.flower-activity-error-panel', '.flower-activity-question-panel', '.flower-activity-subagents-panel', '.flower-activity-web-fetch-panel']) expect(runtime.querySelector(selector), selector).not.toBeNull();
    const button = runtime.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="tool-1"] .flower-activity-file-actions button')!;
    button.focus();
    const code = runtime.querySelector('.flower-activity-file-read-content code')!.firstChild!;
    const range = document.createRange(); range.setStart(code, 0); range.setEnd(code, 14);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    const selectedText = window.getSelection()!.toString();
    const records: MutationRecord[] = []; const observer = new MutationObserver((values) => records.push(...values));
    roots.forEach((root) => observer.observe(root, { childList: true, subtree: true }));
    const animation = vi.spyOn(Element.prototype, 'animate');
    const OriginalResizeObserver = window.ResizeObserver;
    let observerStarts = 0;
    vi.stubGlobal('ResizeObserver', class extends OriginalResizeObserver {
      constructor(callback: ResizeObserverCallback) { super(callback); observerStarts += 1; }
    });
    onTestFinished(() => { vi.unstubAllGlobals(); animation.mockRestore(); observer.disconnect(); window.getSelection()?.removeAllRanges(); });
    const requests = { ...fixture.calls };
    await unrelatedUpdates(fixture);
    await waitFor(() => runtime.textContent?.includes('Unrelated stream update 299') === true);
    records.push(...observer.takeRecords()); observer.disconnect();
    expect(records).toHaveLength(0);
    expect([...runtime.querySelectorAll('.flower-activity-inline-details')]).toEqual(roots);
    expect(document.activeElement).toBe(button);
    expect(window.getSelection()!.toString()).toBe(selectedText);
    expect(fixture.calls).toEqual(requests);
    expect(animation).not.toHaveBeenCalled(); animation.mockRestore();
    expect(observerStarts).toBe(0); vi.unstubAllGlobals();
    window.getSelection()!.removeAllRanges();
    const latest = fixture.current();
    fixture.replace({ ...latest, view_version: latest.view_version + 1, items: latest.items?.map((item) => item.id !== 'tool-1' ? item : { ...item, activity: { ...item.activity, presentation: { ...item.activity?.presentation as object, payload: { operation: 'read', content: 'Changed file content', line_count: 1, total_lines: 1 } } } }) });
    await waitFor(() => runtime.textContent?.includes('Changed file content') === true);
    expect(button.isConnected).toBe(true);
    button.click(); expect(fixture.calls.preview).toBe(1);
  });

  it('executes one native queue click during 300 snapshots and transfers focus after real deletion', async () => {
    const fixture = streamingFixture(8, 0);
    const runtime = await mountFixture(fixture);
    const first = runtime.querySelector<HTMLElement>('[data-flower-queued-turn-dock-id="queued-first"]')!;
    const button = first.querySelector<HTMLButtonElement>('[data-flower-queued-turn-delete]')!;
    let updating: Promise<void> | undefined;
    button.addEventListener('pointerdown', () => { updating = unrelatedUpdates(fixture); }, { once: true });
    await userEvent.click(button, { delay: 160 }); await updating;
    await waitFor(() => !first.isConnected);
    expect(fixture.calls.delete).toBe(1);
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queued-second"]')?.contains(document.activeElement)).toBe(true);
    runtime.querySelector<HTMLButtonElement>('[data-flower-queued-turn-delete]')!.click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 0);
    await waitFor(() => document.activeElement?.tagName === 'TEXTAREA');
  });

  it.each(['approval', 'input', 'subagents'] as const)('preserves %s controls and applies real semantic changes', async (mode) => {
    const fixture = streamingFixture(8, 0);
    const current = fixture.current();
    const request = inputRequest({ prompt_id: 'question-stability', tool_id: 'ask-tool', questions: [{ id: 'channel', header: 'Channel', question: 'Choose a channel', response_mode: 'select_or_write', choices: [{ choice_id: 'stable', label: 'Stable', kind: 'select' }, { choice_id: 'beta', label: 'Beta', kind: 'select' }], write_label: 'Custom' }] });
    if (mode !== 'subagents') fixture.replace({ ...current, interactions: [{ id: mode === 'input' ? request.prompt_id : 'approval-stability', turn_id: current.turn_id!, run_id: current.run_id!, kind: mode === 'input' ? 'input' : 'approval', ...(mode === 'input' ? { input: { summary: 'Choose a channel', questions: [{ id: 'channel', prompt: 'Choose a channel', kind: 'select_or_write', options: ['Stable', 'Beta'], write_label: 'Custom' }] } } : { approval: { label: 'Inspect directory', command: 'ls', tool_name: 'terminal.exec', tool_call_id: 'approve-tool' } }) }] });
    const runtime = await mountFixture(fixture);
    if (mode === 'subagents') {
      fixture.emit({ schema_version: 1, kind: 'thread.batch', thread_id: fixture.thread.thread_id, subagents: [subagentSummary({ parent_thread_id: fixture.thread.thread_id, thread_id: 'child-stability', status: 'completed' })] });
      await waitFor(() => Boolean(runtime.querySelector('[aria-controls="flower-subagents-dropdown"]')));
      runtime.querySelector<HTMLButtonElement>('[aria-controls="flower-subagents-dropdown"]')!.click();
    }
    const selector = mode === 'approval' ? '[data-flower-bottom-mode="approval"]' : mode === 'input' ? '[data-flower-bottom-mode="input_request"]' : '#flower-subagents-dropdown';
    await waitFor(() => Boolean(document.querySelector(selector)));
    const panel = document.querySelector(selector)!;
    if (mode === 'input') panel.querySelector<HTMLButtonElement>('[data-flower-input-answer-kind="custom"]')!.click();
    const input = panel.querySelector<HTMLTextAreaElement>('textarea');
    if (input) { input.value = 'Keep this answer'; input.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    const button = panel.querySelector<HTMLButtonElement>('button:not(:disabled)')!;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    button.focus();
    const nodes = [...panel.querySelectorAll('button, input, textarea')];
    const records: MutationRecord[] = []; const observer = new MutationObserver((values) => records.push(...values)); observer.observe(panel, { childList: true, subtree: true });
    await unrelatedUpdates(fixture); await waitFor(() => runtime.textContent?.includes('Unrelated stream update 299') === true);
    records.push(...observer.takeRecords()); observer.disconnect();
    expect(records).toHaveLength(0);
    expect([...panel.querySelectorAll('button, input, textarea')]).toEqual(nodes);
    expect(document.activeElement).toBe(button);
    if (input) expect(input.value).toBe('Keep this answer');
    const latest = fixture.current();
    if (mode === 'input') {
      fixture.replace({ ...latest, view_version: latest.view_version + 1, interactions: latest.interactions?.map((interaction) => ({ ...interaction, input: { ...interaction.input!, questions: interaction.input!.questions.map((question) => ({ ...question, prompt: 'Updated channel prompt' })) } })) });
      await waitFor(() => panel.textContent?.includes('Updated channel prompt') === true);
      expect(button.isConnected).toBe(true); if (input) expect(input.value).toBe('Keep this answer');
    } else if (mode === 'approval') {
      fixture.replace({ ...latest, view_version: latest.view_version + 1, interactions: [] });
      await waitFor(() => !runtime.querySelector('[data-flower-bottom-mode="approval"]'));
      await waitFor(() => document.activeElement?.tagName === 'TEXTAREA');
    }
  });
});
