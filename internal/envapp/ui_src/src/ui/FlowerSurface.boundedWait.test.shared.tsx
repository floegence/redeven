import { expect, it, vi } from 'vitest';
import { activityItem, activityTimeline, adapter, deferred, inputRequest, liveBootstrap, renderSurfaceWithAdapterProps, runtimeCurrentView, subagentDetail, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

it('keeps a real loop failure visible after a declined tool and exposes only safe diagnostics', async () => {
  const detail = '{"reason":"repeated_tool_calls","thread_id":"thread-1","turn_id":"turn-1","run_id":"run-1"}';
  const failed = thread({ status: 'failed', error: { code: 'floret_repeated_tool_calls', message: 'private raw error', detail }, messages: [{
    id: 'declined-assistant', turn_id: 'turn-1', run_id: 'run-1', role: 'assistant', content: '', status: 'complete', created_at_ms: 2,
    blocks: [activityTimeline({ thread_id: 'thread-1', turn_id: 'turn-1', run_id: 'run-1', items: [activityItem({ status: 'declined', approval_state: 'rejected' })] })],
  }] });
  const writeText = vi.fn(async () => undefined);
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  try {
    const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [failed], loadThread: async () => liveBootstrap(failed) }, { focusThreadRequest: { request_id: 'loop', thread_id: failed.thread_id } });
    await waitFor(() => surface.querySelector('.flower-run-error') !== null);
    const card = surface.querySelector('.flower-run-error')!;
    expect(card.textContent).toContain('Repeated identical tool requests');
    expect(card.textContent).toContain('completed child reports are preserved');
    expect(card.textContent).not.toContain('private raw error');
    expect(card.querySelector('pre')?.textContent).toBe(detail);
    card.querySelector<HTMLDetailsElement>('details')!.open = true;
    card.querySelector<HTMLButtonElement>('details button')!.click();
    await waitFor(() => writeText.mock.calls.length === 1);
    expect(writeText).toHaveBeenCalledWith(detail);
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

async function mountChild(compaction = false) {
  const child = subagentSummary({ status: 'failed' });
  const parent = thread({ thread_id: child.parent_thread_id, status: 'running', subagents: [child] });
  const failed = thread({ thread_id: child.thread_id, status: 'failed', error: { code: 'floret_repeated_tool_calls', message: 'private failure' } });
  let detail = subagentDetail({ summary: child, current: { ...runtimeCurrentView(failed, 7), run_id: "child-run", ...(compaction ? { turn_kind: 'context_compaction' as const } : {}) } });
  const loadSubagentDetail = vi.fn(async () => detail);
  const retryThread = vi.fn(async (_id: string): Promise<void> => { detail = subagentDetail({ summary: { ...child, status: 'running' }, current: runtimeCurrentView(thread({ thread_id: child.thread_id, status: 'running' }), 8) }); });
  const compactThreadContext = vi.fn(async (_id: string, _input: { client_request_id: string; storage_generation: string }): Promise<FlowerRuntimeCurrentView> => ({ thread_id: child.thread_id, view_version: 8, activity: 'active', turn_id: 'compact-child', run_id: 'compact-child-run', run_progress: { phase: 'preparing' }, turn_kind: 'context_compaction', items: [] }));
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [parent], loadThread: async () => liveBootstrap(parent), loadSubagentDetail, retryThread, compactThreadContext }, { focusThreadRequest: { request_id: 'child', thread_id: parent.thread_id } });
  await waitFor(() => surface.querySelector('button[aria-controls="flower-subagents-dropdown"]') !== null);
  surface.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
  const settled = document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]');
  settled?.click();
  await waitFor(() => document.querySelector('[data-flower-subagent-row]') !== null);
  document.querySelector<HTMLButtonElement>('[data-flower-subagent-row]')!.click();
  await waitFor(() => document.querySelector('.flower-subagent-detail-window .flower-run-error') !== null);
  const retry = () => [...document.querySelectorAll<HTMLButtonElement>('.flower-subagent-detail-window .flower-run-error button')].find(button => button.textContent === 'Retry reply')!;
  return { surface, child, parent, retry, retryThread, loadSubagentDetail, compactThreadContext };
}

it('retries only the failed child while its parent runs and releases controls after failure', async () => {
  const state = await mountChild();
  const pending = deferred<void>();
  state.retryThread.mockImplementationOnce(() => pending.promise);
  state.retry().click(); state.retry().click();
  await waitFor(() => state.retryThread.mock.calls.length === 1);
  expect(state.retry().disabled).toBe(true);
  expect(state.retryThread).toHaveBeenCalledWith(state.child.thread_id);
  pending.reject(new Error('connection unavailable'));
  await waitFor(() => !state.retry().disabled);
  state.retry().click();
  await waitFor(() => state.retryThread.mock.calls.length === 2);
  expect(state.retryThread.mock.calls.every(call => call[0] === state.child.thread_id)).toBe(true);
  await waitFor(() => document.querySelector('.flower-subagent-detail-window .flower-run-error') === null);
  expect(state.surface.querySelector('.flower-composer-submit')?.getAttribute('aria-label')).toBe('Stop');
});

it('reuses the same child compaction identity after an uncertain transport result', async () => {
  const state = await mountChild(true);
  state.compactThreadContext.mockRejectedValueOnce(flowerTurnAdmissionError('unknown', new Error('connection lost')));
  state.retry().click(); state.retry().click();
  await waitFor(() => state.compactThreadContext.mock.calls.length === 1);
  expect(state.retryThread).not.toHaveBeenCalled();
  expect(state.compactThreadContext.mock.calls[0][0]).toBe(state.child.thread_id);
  await waitFor(() => document.querySelector('[data-flower-child-compaction-delivery="unknown"]') !== null);
  document.querySelector<HTMLButtonElement>('[data-flower-child-compaction-delivery="unknown"] button')!.click();
  await waitFor(() => state.compactThreadContext.mock.calls.length === 2);
  expect(state.compactThreadContext.mock.calls[1]).toEqual(state.compactThreadContext.mock.calls[0]);
  await waitFor(() => document.querySelector('[data-flower-child-compaction-delivery]') === null);
  expect(state.surface.querySelector('.flower-composer-submit')?.getAttribute('aria-label')).toBe('Stop');
});


it('opens a waiting child in the shared interaction surface and returns without waking its parent', async () => {
  const child = subagentSummary({ status: 'waiting_input', can_send_input: true });
  const request = inputRequest({ tool_id: 'wait-call', tool_name: 'subagents', questions: [{ id: 'subagent_attention', header: '', question: 'How should the parent continue?', response_mode: 'select', choices: [
    { choice_id: 'handled', value: 'Continue after handling the child thread', label: 'Continue after handling the child thread', kind: 'select' },
    { choice_id: 'available', value: 'Continue using available results', label: 'Continue using available results', kind: 'select' },
  ] }] });
  const parent = thread({ thread_id: child.parent_thread_id, status: 'waiting_user', subagents: [child], input_request: request, messages: [{
    id: 'wait-result', role: 'assistant', turn_id: 'turn-1', run_id: 'parent-run', content: '', status: 'complete', created_at_ms: 2,
    blocks: [activityTimeline({ thread_id: child.parent_thread_id, turn_id: 'turn-1', run_id: 'parent-run', items: [activityItem({ item_id: 'wait-call', tool_id: 'wait-call', tool_name: 'subagents' })] })],
  }], active_run_id: 'parent-run' });
  const childThread = thread({ thread_id: child.thread_id, title: child.task_name, status: 'waiting_user', input_request: inputRequest() });
  const base = adapter();
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [parent], loadThread: async id => liveBootstrap(id === parent.thread_id ? parent : childThread) }, { focusThreadRequest: { request_id: 'attention', thread_id: parent.thread_id } });
  await waitFor(() => surface.querySelector('[data-flower-input-request-prompt]')?.textContent?.includes('Continue using available results') === true);
  const panel = surface.querySelector('[data-flower-input-request-prompt]')!;
  expect(panel.textContent).toContain('explicitly continue this parent');
  const stop = surface.querySelector<HTMLButtonElement>('.flower-composer-stop')!;
  expect(stop.getAttribute('aria-label')).toBe('Stop'); expect(stop.disabled).toBe(false);
  await waitFor(() => surface.querySelector('.flower-attention-child') !== null);
  surface.querySelector<HTMLButtonElement>('.flower-attention-child')!.click();
  await waitFor(() => surface.querySelector('[data-flower-input-request-prompt]')?.textContent?.includes('Where should Flower deploy') === true);
  expect(base.submitInput).not.toHaveBeenCalled();
  [...surface.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Return to parent')!.click();
  await waitFor(() => surface.querySelector('[data-flower-input-request-prompt]')?.textContent?.includes('Continue using available results') === true);
  expect(base.submitInput).not.toHaveBeenCalled();
  surface.querySelector<HTMLButtonElement>('.flower-composer-stop')!.click();
  await waitFor(() => (base.stopThread as ReturnType<typeof vi.fn>).mock.calls.length === 1);
  expect(base.stopThread).toHaveBeenCalledWith(parent.thread_id);
});

it.each(['input', 'approval'] as const)('handles child %s in the shared composer and resumes only the explicitly selected parent', async kind => {
  const child = subagentSummary({ status: 'waiting_input', can_send_input: true });
  const parentRequest = inputRequest({ prompt_id: 'parent-attention', tool_id: 'wait-call', tool_name: 'subagents', questions: [{
    id: 'subagent_attention', header: '', question: 'How should the parent continue?', response_mode: 'select', choices: [
      { choice_id: 'handled', value: 'Continue after handling the child thread', label: 'Continue after handling the child thread', kind: 'select' },
      { choice_id: 'available', value: 'Continue using available results', label: 'Continue using available results', kind: 'select' },
    ],
  }] });
  const parent = thread({ thread_id: child.parent_thread_id, status: 'waiting_user', subagents: [child], input_request: parentRequest });
  const childThread = thread({ thread_id: child.thread_id, parent_thread_id: parent.thread_id,
    status: kind === 'input' ? 'waiting_user' : 'waiting_approval',
    ...(kind === 'input' ? { input_request: inputRequest({ prompt_id: 'child-input' }) } : { approval_actions: [{
      action_id: 'child-approval', turn_id: 'turn-fixture', run_id: 'run-fixture', origin: 'main_tool', tool_id: 'child-tool', tool_name: 'terminal.exec',
      state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true, queue_order: 0, summary: { label: 'Inspect child workspace' },
    }] }),
  });
  const base = adapter();
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [parent], loadThread: async id => liveBootstrap(id === parent.thread_id ? parent : childThread, 5) },
    { focusThreadRequest: { request_id: 'child-decision', thread_id: parent.thread_id } });
  await waitFor(() => surface.querySelector('.flower-attention-child') !== null);
  surface.querySelector<HTMLButtonElement>('.flower-attention-child')!.click();
  await waitFor(() => surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === child.thread_id);
  if (kind === 'input') {
    await waitFor(() => surface.querySelector('.flower-input-request-choice') !== null);
    surface.querySelector<HTMLButtonElement>('.flower-input-request-choice')!.click();
    const submit = () => [...surface.querySelectorAll<HTMLButtonElement>('.flower-composer button')].find(button => button.textContent?.trim() === 'Continue')!;
    await waitFor(() => Boolean(submit() && !submit().disabled));
    submit().click();
    await waitFor(() => (base.submitInput as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect(base.submitInput).toHaveBeenCalledWith(expect.objectContaining({ thread_id: child.thread_id, prompt_id: 'child-input' }));
  } else {
    await waitFor(() => surface.querySelector('.flower-composer-approval-decision') !== null);
    const allow = [...surface.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision')].find(button => button.textContent?.trim() === 'Allow once')!;
    expect(allow.disabled).toBe(false);
    allow.click();
    await waitFor(() => (base.submitApproval as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect(base.submitApproval).toHaveBeenCalledWith({ thread_id: child.thread_id, interaction_id: 'child-approval', approved: true });
    expect(base.submitInput).not.toHaveBeenCalled();
  }
  [...surface.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Return to parent')!.click();
  await waitFor(() => surface.querySelector('[data-flower-input-request-prompt]')?.textContent?.includes('Continue using available results') === true);
  const choice = kind === 'input' ? 'Continue after handling the child thread' : 'Continue using available results';
  const choiceButton = () => [...surface.querySelectorAll<HTMLButtonElement>('.flower-input-request-choice')].find(button => button.textContent?.includes(choice));
  await waitFor(() => Boolean(choiceButton()));
  choiceButton()!.click();
  const submit = () => [...surface.querySelectorAll<HTMLButtonElement>('.flower-composer button')].find(button => button.textContent?.trim() === 'Continue')!;
  await waitFor(() => Boolean(submit() && !submit().disabled));
  submit().click();
  await waitFor(() => (base.submitInput as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].thread_id === parent.thread_id));
  expect(base.submitInput).toHaveBeenCalledWith(expect.objectContaining({ thread_id: parent.thread_id, prompt_id: 'parent-attention', answers: { subagent_attention: { choice_id: choice } } }));
});

it('allows a child compaction invalidated by storage restore to be refreshed and removed', async () => {
  const state = await mountChild(true);
  state.compactThreadContext.mockRejectedValueOnce(Object.assign(new Error('storage restored'), { code: 'AI_STORAGE_RESTORED' }));
  state.retry().click();
  await waitFor(() => document.querySelector('[data-flower-child-compaction-delivery="failed"]') !== null);
  const card = document.querySelector('[data-flower-child-compaction-delivery="failed"]')!;
  expect(card.textContent).toContain('restored');
  expect(card.querySelector('button[aria-label="Retry send"]')).toBeNull();
  const reads = state.loadSubagentDetail.mock.calls.length;
  card.querySelector<HTMLButtonElement>('button[aria-label="Refresh confirmation"]')!.click();
  await waitFor(() => state.loadSubagentDetail.mock.calls.length > reads);
  document.querySelector<HTMLButtonElement>('[data-flower-child-compaction-delivery="failed"] button.flower-queued-turn-delete')!.click();
  await waitFor(() => document.querySelector('[data-flower-child-compaction-delivery]') === null);
  expect(state.compactThreadContext).toHaveBeenCalledTimes(1);
});

it('keeps a selected child current through the single workspace stream and root reconnect baseline', async () => {
  const child = subagentSummary({ status: 'waiting_input', can_send_input: true });
  const parent = thread({ thread_id: child.parent_thread_id, status: 'waiting_user', subagents: [child], input_request: inputRequest({ tool_name: 'subagents', questions: [{
    id: 'subagent_attention', header: '', question: 'How should the parent continue?', response_mode: 'write',
  }] }) });
  let childThread = thread({ thread_id: child.thread_id, status: 'waiting_user', input_request: inputRequest({ prompt_id: 'child-live-input' }) });
  const queued: FlowerLiveStreamEnvelope[] = [{ schema_version: 1, kind: 'ready', summaries: [parent] }];
  let wake: (() => void) | undefined;
  const push = (event: FlowerLiveStreamEnvelope) => { queued.push(event); wake?.(); wake = undefined; };
  const base = adapter();
  const loadThread = vi.fn(async (id: string) => liveBootstrap(id === parent.thread_id ? parent : childThread, id === parent.thread_id ? 5 : 6));
  const connectLiveStream = vi.fn(async function* ({ signal }: { signal: AbortSignal }): AsyncIterable<FlowerLiveStreamEnvelope> {
    while (!signal.aborted) {
      const event = queued.shift();
      if (event) { yield event; continue; }
      await new Promise<void>(resolve => {
        const resume = () => { signal.removeEventListener('abort', resume); resolve(); };
        wake = resume;
        signal.addEventListener('abort', resume, { once: true });
      });
    }
  });
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [parent], loadThread, connectLiveStream }, { focusThreadRequest: { request_id: 'live-child', thread_id: parent.thread_id } });
  await waitFor(() => surface.querySelector('.flower-attention-child') !== null);
  surface.querySelector<HTMLButtonElement>('.flower-attention-child')!.click();
  await waitFor(() => surface.querySelector('[data-flower-input-request-prompt]')?.textContent?.includes('Where should Flower deploy') === true);
  childThread = thread({ thread_id: child.thread_id, status: 'success', active_run_id: undefined, messages: [{ id: 'child-final', role: 'assistant', content: 'CHILD_LIVE_COMPLETED', status: 'complete', created_at_ms: 4 }] });
  push({ schema_version: 1, kind: 'thread.batch', thread_id: parent.thread_id, subagent_current: runtimeCurrentView(childThread, 7) });
  await waitFor(() => surface.textContent?.includes('CHILD_LIVE_COMPLETED') === true && surface.querySelector('[data-flower-input-request-prompt]') === null);
  const reads = loadThread.mock.calls.length;
  push({ schema_version: 1, kind: 'ready', summaries: [parent] });
  await waitFor(() => loadThread.mock.calls.length > reads);
  expect([...surface.querySelectorAll('button')].some(button => button.textContent === 'Return to parent')).toBe(true);
  expect(surface.textContent).toContain('CHILD_LIVE_COMPLETED');
  expect(loadThread.mock.calls.at(-1)?.[0]).toBe(child.thread_id);
  expect(connectLiveStream).toHaveBeenCalledTimes(1);
  expect(base.submitInput).not.toHaveBeenCalled();
  expect(base.submitApproval).not.toHaveBeenCalled();
});

it('ignores a late child recovery preflight after its detail window closes', async () => {
  const state = await mountChild();
  const pending = deferred<Awaited<ReturnType<typeof state.loadSubagentDetail>>>();
  state.loadSubagentDetail.mockImplementationOnce(() => pending.promise);
  state.retry().click();
  await waitFor(() => state.retry().disabled);
  const detailWindow = document.querySelector('.flower-subagent-detail-window')!;
  detailWindow.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
  await waitFor(() => document.querySelector('.flower-subagent-detail-window') === null);
  pending.resolve(subagentDetail({ summary: state.child, current: runtimeCurrentView(thread({ thread_id: state.child.thread_id, status: 'failed', error: { code: 'floret_repeated_tool_calls', message: 'loop stopped' } }), 8) }));
  await Promise.resolve(); await Promise.resolve();
  expect(state.retryThread).not.toHaveBeenCalled();
  expect(state.surface.querySelector('.flower-composer-submit')?.getAttribute('aria-label')).toBe('Stop');
});
