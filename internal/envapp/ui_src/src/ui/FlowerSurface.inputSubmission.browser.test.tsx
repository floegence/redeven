import '../index.css';
import './flower-feature.css';
import { expect, it, vi } from 'vitest';
import type { FlowerInputRequest, FlowerLiveStreamEnvelope, FlowerSubmitInputReceipt, FlowerApprovalCommandResult } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { adapter, deferred, flush, inputRequest, liveBootstrap, renderSurfaceWithDraftCoordinator, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function controlledStream(summaries: ReturnType<typeof thread>[]) {
  const queued: FlowerLiveStreamEnvelope[] = [{ schema_version: 1, kind: 'ready', summaries }];
  let wake: (() => void) | undefined;
  return {
    push(value: FlowerLiveStreamEnvelope) { queued.push(value); wake?.(); },
    async *connect({ signal }: { signal: AbortSignal }) {
      while (!signal.aborted) {
        const value = queued.shift();
        if (value) { yield value; continue; }
        await new Promise<void>((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
      }
    },
  };
}

async function setup(options: { request?: FlowerInputRequest; canMutate?: boolean } = {}) {
  const request = options.request ?? inputRequest({ questions: [{ id: 'answer', header: 'Answer', question: 'Provide the requested value.', response_mode: 'write', is_secret: true, choices: [] }] });
  const waiting = thread({ thread_id: 'thread-input-race', status: 'waiting_user', input_request: request });
  const other = thread({ thread_id: 'thread-other-race' });
  const stream = controlledStream([waiting, other]);
  const response = deferred<FlowerSubmitInputReceipt>();
  const submitInput = vi.fn(() => response.promise);
  const drafts = createFlowerComposerDraftCoordinator();
  const runtime = renderSurfaceWithDraftCoordinator({ ...adapter(true),
    listThreads: vi.fn(async () => [waiting, other]), loadThread: vi.fn(async (id) => liveBootstrap(id === waiting.thread_id ? waiting : other)), submitInput,
    canMutate: options.canMutate ?? true,
    connectLiveStream: stream.connect,
  }, drafts);
  const select = async (id: string) => {
    await waitFor(() => !!runtime.querySelector(`[data-thread-id="${id}"] button`));
    (runtime.querySelector(`[data-thread-id="${id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector(`[data-thread-id="${id}"]`)?.getAttribute('data-flower-thread-active') === 'true');
  };
  await select(waiting.thread_id);
  await waitFor(() => !!runtime.querySelector('.flower-composer-continue, .flower-computer-control-actions button:last-child'));
  const input = () => runtime.querySelector('.flower-decision-surface input, .flower-decision-surface textarea') as HTMLInputElement;
  const type = (text: string) => { input().value = text; input().dispatchEvent(new Event('input', { bubbles: true })); };
  const submit = () => (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
  const emit = (current: ReturnType<typeof runtimeCurrentView>) => stream.push({ schema_version: 1, kind: 'thread.batch', thread_id: waiting.thread_id, current });
  return { waiting, other, request, drafts, response, submitInput, runtime, select, type, submit, input, emit };
}

it('guards repeated submission and keeps edits made while a failed request is pending', async () => {
  const s = await setup();
  s.type('first secret'); s.submit(); s.submit();
  s.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  expect(s.submitInput).toHaveBeenCalledTimes(1);
  expect((s.runtime.querySelector('.flower-composer-stop') as HTMLButtonElement).disabled).toBe(false);
  s.type('new secret');
  s.response.reject(new Error('Response lost'));
  await waitFor(() => !(s.runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).disabled);
  expect(s.input().value).toBe('new secret');
  expect(s.input().placeholder).not.toBe('Provide the requested value.');
});

it.each(['success', 'failure'] as const)('preserves the next question and ordinary draft after a late %s', async (outcome) => {
  const s = await setup();
  s.type('first secret'); s.submit();
  const next = { ...s.waiting, input_request: { ...s.request, prompt_id: 'prompt-next' } };
  s.emit(runtimeCurrentView(next, 3));
  await waitFor(() => s.drafts.read(s.waiting.thread_id).value.input_prompt_signature?.endsWith(':prompt-next') === true);
  s.type('next secret');
  s.drafts.open(s.waiting.thread_id).mutate((value) => ({ ...value, text: 'ordinary draft' }));
  if (outcome === 'success') s.response.resolve({ thread_id: s.waiting.thread_id, consumed_prompt_id: s.request.prompt_id,
    current: runtimeCurrentView({ ...s.waiting, status: 'success', input_request: undefined }, 2) });
  else s.response.reject(new Error('Late failure'));
  await flush(); await flush();
  expect(s.input().value).toBe('next secret');
  expect(s.drafts.read(s.waiting.thread_id).value.text).toBe('ordinary draft');
});

it('clears sensitive answers on canonical cancellation while another thread is selected', async () => {
  const s = await setup();
  s.type('ephemeral secret');
  await s.select(s.other.thread_id);
  s.emit(runtimeCurrentView({ ...s.waiting, input_request: undefined, status: 'canceled' }, 3));
  await waitFor(() => Object.keys(s.drafts.read(s.waiting.thread_id).value.input_drafts ?? {}).length === 0);
  expect(s.drafts.read(s.waiting.thread_id).value.input_prompt_signature).toBeUndefined();
});

it('rejects an obsolete option identity and preserves read-only restrictions', async () => {
  const request = inputRequest();
  const s = await setup({ request });
  s.drafts.open(s.waiting.thread_id).mutate((value) => ({ ...value, input_drafts: { target: { choice_id: 'removed', answer_kind: 'choice' } } }));
  s.submit();
  expect((s.runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).disabled).toBe(true);
  expect(s.submitInput).not.toHaveBeenCalled();
  const readonly = await setup({ canMutate: false });
  readonly.drafts.open(readonly.waiting.thread_id).mutate((value) => ({ ...value, input_drafts: { answer: { text: 'valid answer' } } }));
  readonly.submit();
  readonly.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  expect(readonly.submitInput).not.toHaveBeenCalled();
});

it('retains a newly arrived approval during a pending batch and keeps navigation usable', async () => {
  const approval = (id: string) => ({ action_id: id, turn_id: 'turn-fixture', run_id: 'run-fixture', tool_id: id,
    tool_name: 'terminal.exec', origin: 'main_tool' as const, state: 'requested' as const, status: 'pending' as const,
    can_approve: true, requested_at_ms: 1, summary: { label: `Run ${id}`, command: `printf ${id}` } });
  const first = approval('first'); const second = approval('second'); const later = approval('later');
  const waiting = thread({ thread_id: 'thread-batch-race', status: 'waiting_approval', approval_actions: [first, second] });
  const other = thread({ thread_id: 'thread-batch-other' });
  const stream = controlledStream([waiting, other]);
  const response = deferred<FlowerApprovalCommandResult>();
  const submitApproval = vi.fn(() => response.promise);
  const drafts = createFlowerComposerDraftCoordinator();
  const runtime = renderSurfaceWithDraftCoordinator({ ...adapter(true), listThreads: vi.fn(async () => [waiting, other]),
    loadThread: vi.fn(async (id) => liveBootstrap(id === waiting.thread_id ? waiting : other)),
    connectLiveStream: stream.connect, submitApproval }, drafts);
  await waitFor(() => !!runtime.querySelector(`[data-thread-id="${waiting.thread_id}"] button`));
  (runtime.querySelector(`[data-thread-id="${waiting.thread_id}"] button`) as HTMLButtonElement).click();
  const button = (label: string) => Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision')).find((button) => button.textContent?.trim() === label);
  await waitFor(() => !!button('Allow all'));
  button('Allow all')!.click();
  stream.push({ schema_version: 1, kind: 'thread.batch', thread_id: waiting.thread_id,
    current: runtimeCurrentView({ ...waiting, approval_actions: [first, second, later] }, 2) });
  await waitFor(() => runtime.querySelectorAll('[data-flower-composer-approval="true"]').length === 3);
  expect(submitApproval).toHaveBeenCalledExactlyOnceWith({ thread_id: waiting.thread_id, interaction_ids: ['first', 'second'], approved: true });
  expect(runtime.querySelector<HTMLButtonElement>('[data-flower-approval-action-id="first"] .flower-composer-approval-decision')?.disabled).toBe(true);
  expect(runtime.querySelector<HTMLButtonElement>('[data-flower-approval-action-id="later"] .flower-composer-approval-decision')?.disabled).toBe(false);
  expect(button('Allow all')?.disabled).toBe(true);
  (runtime.querySelector(`[data-thread-id="${other.thread_id}"] button`) as HTMLButtonElement).click();
  await waitFor(() => runtime.querySelector(`[data-thread-id="${other.thread_id}"]`)?.getAttribute('data-flower-thread-active') === 'true');
  response.resolve({ ok: true, current: runtimeCurrentView({ ...waiting, approval_actions: [later] }, 3) });
  await flush();
  (runtime.querySelector(`[data-thread-id="${waiting.thread_id}"] button`) as HTMLButtonElement).click();
  await waitFor(() => runtime.querySelectorAll('[data-flower-composer-approval="true"]').length === 1);
  expect(runtime.querySelector('[data-flower-approval-action-id="later"]')).not.toBeNull();
});

it('uses the same pending guard for returning computer control', async () => {
  const s = await setup({ request: inputRequest({ tool_name: 'computer.screenshot', questions: [{ id: 'computer_control',
    header: '', question: 'Return control when ready.', response_mode: 'select',
    choices: [{ choice_id: 'return', value: 'Return control to Flower', label: 'Return control', kind: 'select' }] }] }) });
  const button = s.runtime.querySelector<HTMLButtonElement>('.flower-computer-control-actions button:last-child')!;
  button.click(); button.click();
  expect(s.submitInput).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  s.response.reject(new Error('Try again'));
  await waitFor(() => !button.disabled);
});

it('disables the old decision when a malformed current view enters recovery', async () => {
  const s = await setup();
  s.type('draft remains available for recovery');
  const current = runtimeCurrentView(s.waiting, 2);
  s.emit({ ...current, interactions: [...current.interactions!, { ...current.interactions![0], id: 'ambiguous-input' }] });
  await waitFor(() => !!s.runtime.querySelector('.flower-thread-sync-error'));
  s.submit();
  expect(s.submitInput).not.toHaveBeenCalled();
  expect(s.input().value).toBe('draft remains available for recovery');
});
