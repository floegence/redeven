import '../index.css';
import './flower-feature.css';
import { beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src';
import type { FlowerLiveStreamConnectInput, FlowerLiveStreamEnvelope, FlowerThreadSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  deferred,
  liveBootstrap,
  renderSurfaceWithAdapterProps,
  renderSurfaceWithDraftCoordinator,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

beforeEach(() => page.viewport(1280, 800));

function terminalStream(summaries: readonly FlowerThreadSnapshot[], recoveredSummaries = summaries) {
  const failure = deferred<void>();
  const attempts: FlowerLiveStreamConnectInput[] = [];
  const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
    attempts.push(input);
    yield { schema_version: 1, kind: 'ready', summaries: attempts.length > 1 ? recoveredSummaries : summaries };
    if (attempts.length === 1) {
      await failure.promise;
      throw Object.assign(new Error('private encoding diagnostic'), { code: 'envelope_encoding_failed' });
    }
    if (!input.signal.aborted) {
      await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
    }
  });
  return { attempts, connectLiveStream, fail: () => failure.resolve() };
}

function expectNoticeFits(runtime: HTMLElement): HTMLButtonElement {
  const notice = runtime.querySelector<HTMLElement>('.flower-workspace-sync')!;
  const resync = notice.querySelector<HTMLButtonElement>('button')!;
  expect(notice.getAttribute('role')).toBe('status');
  expect(notice.getAttribute('aria-live')).toBe('polite');
  expect(notice.textContent).toContain('Displayed state may be outdated.');
  expect(notice.scrollWidth - notice.clientWidth).toBeLessThanOrEqual(1);
  const bounds = notice.getBoundingClientRect();
  const button = resync.getBoundingClientRect();
  expect(bounds.width).toBeGreaterThan(0);
  expect(button.left).toBeGreaterThanOrEqual(bounds.left);
  expect(button.right).toBeLessThanOrEqual(bounds.right);
  expect(button.top).toBeGreaterThanOrEqual(bounds.top);
  expect(button.bottom).toBeLessThanOrEqual(bounds.bottom);
  expect(resync.disabled).toBe(false);
  return resync;
}

it('supports keyboard resynchronization at narrow widths and preserves draft references while loading the final answer', async () => {
  const selected = thread({ thread_id: 'thread-keyboard-sync', status: 'running' });
  const completed = thread({
    ...selected, status: 'success', active_run_id: undefined,
    messages: [...selected.messages, { id: 'final-sync', turn_id: 'turn-1', role: 'assistant', content: 'Recovered final answer', status: 'complete', created_at_ms: 11_000 }],
  });
  const stream = terminalStream([selected], [completed]);
  const drafts = createFlowerComposerDraftCoordinator();
  const reference = { local_id: 'sync-reference', kind: 'file' as const, path: '/workspace/result.png', label: 'result.png' };
  const loadThread = vi.fn(async () => liveBootstrap(stream.attempts.length > 1 ? completed : selected, stream.attempts.length > 1 ? 10 : 9));
  const runtime = renderSurfaceWithDraftCoordinator({
    ...adapter(true), listThreads: vi.fn(async () => [selected]), loadThread, connectLiveStream: stream.connectLiveStream,
  }, drafts);
  await waitFor(() => runtime.querySelector(`[data-thread-id="${selected.thread_id}"] button`) !== null);
  (runtime.querySelector(`[data-thread-id="${selected.thread_id}"] button`) as HTMLButtonElement).click();
  await waitFor(() => runtime.querySelector('.flower-composer textarea') !== null);
  drafts.open(selected.thread_id).mutate(value => ({ ...value, text: 'Keep my unfinished input', references: [reference] }));
  await waitFor(() => runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.value === 'Keep my unfinished input');
  await page.viewport(360, 760);
  Object.assign(runtime.style, { width: '360px', height: '760px' });
  stream.fail();
  await waitFor(() => runtime.querySelector('[data-flower-sync-state="failed"]') !== null);
  const resync = expectNoticeFits(runtime);
  expect(runtime.textContent).toContain('Plan deploy');
  expect(runtime.textContent).not.toContain('private encoding diagnostic');
  resync.focus();
  expect(document.activeElement).toBe(resync);
  await userEvent.keyboard('{Enter}');
  await waitFor(() => stream.connectLiveStream.mock.calls.length === 2 && runtime.querySelector('.flower-workspace-sync') === null);
  await waitFor(() => runtime.textContent?.includes('Recovered final answer') ?? false);
  expect(stream.attempts[0].signal.aborted).toBe(true);
  expect(stream.attempts.filter(attempt => !attempt.signal.aborted)).toHaveLength(1);
  expect(drafts.read(selected.thread_id).value.text).toBe('Keep my unfinished input');
  expect(drafts.read(selected.thread_id).value.references).toEqual([reference]);
  expect(runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.value).toBe('Keep my unfinished input');
});

it('keeps Companion approval recovery visible and allows keyboard Stop while live synchronization is failed', async () => {
  const approvalThread = thread({ thread_id: 'thread-companion-sync', status: 'waiting_approval', approval_actions: [{
    action_id: 'approval-companion-sync', origin: 'main_tool', run_id: 'run-companion-sync', tool_id: 'tool-companion-sync', tool_name: 'terminal.exec',
    state: 'requested', status: 'pending', requested_at_ms: 20_000, can_approve: true,
    surface_role: 'primary_action', summary: { label: 'Review deployment', command: 'printf approval' },
  }] });
  const stopped = thread({ ...approvalThread, status: 'canceled', active_run_id: undefined, approval_actions: [] });
  const stream = terminalStream([approvalThread]);
  let stopAccepted = false;
  const stopThread = vi.fn(async () => { stopAccepted = true; });
  const submitApproval = vi.fn();
  const runtime = renderSurfaceWithAdapterProps({
    ...adapter(true), listThreads: vi.fn(async () => [approvalThread]), stopThread, submitApproval,
    loadThread: vi.fn(async () => liveBootstrap(stopAccepted ? stopped : approvalThread, stopAccepted ? 10 : 9)),
    connectLiveStream: stream.connectLiveStream,
  }, { presentation: 'companion', companionOpen: true, engaged: true, transcriptVisible: true });
  await waitFor(() => runtime.querySelector(`[data-thread-id="${approvalThread.thread_id}"] button`) !== null);
  (runtime.querySelector(`[data-thread-id="${approvalThread.thread_id}"] button`) as HTMLButtonElement).click();
  await waitFor(() => runtime.querySelector('[data-flower-bottom-mode="approval"]') !== null);
  await page.viewport(360, 760);
  Object.assign(runtime.style, { width: '360px', height: '760px' });
  stream.fail();
  await waitFor(() => runtime.querySelector('[data-flower-sync-state="failed"]') !== null);
  expectNoticeFits(runtime);
  const stop = runtime.querySelector<HTMLButtonElement>('.flower-composer-stop-thread')!;
  expect(stop.disabled).toBe(false);
  stop.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => runtime.querySelector('[data-flower-bottom-mode="chat"]') !== null);
  expect(stopThread).toHaveBeenCalledTimes(1);
  expect(submitApproval).not.toHaveBeenCalled();
  expect(runtime.querySelector('[data-flower-sync-state="failed"]')).not.toBeNull();
  expectNoticeFits(runtime);
  const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  expect(editor.disabled).toBe(false);
  editor.focus();
  await userEvent.keyboard('Draft after stopping');
  expect(editor.value).toBe('Draft after stopping');
});
