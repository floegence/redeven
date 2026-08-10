import '../index.css';
import './flower-feature.css';

import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';

import type { FlowerTurnLaunchReceipt } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  deferred,
  flowerSurfaceNotifications,
  liveBootstrap,
  renderSurfaceWithAdapter,
  renderSurfaceWithAdapterProps,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

async function verifyPendingSubmission(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  const admission = deferred<FlowerTurnLaunchReceipt>();
  const launchTurn = vi.fn(() => admission.promise);
  const runtime = renderSurfaceWithAdapter({
    ...adapter(true),
    listThreads: vi.fn(async () => []),
    launchTurn,
  });
  await waitFor(() => Boolean(runtime.querySelector('textarea')));

  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = 'Inspect the first-turn submission experience';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
  (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-pending-submission-id]')));

  const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLElement;
  const pending = runtime.querySelector('[data-flower-pending-submission-id]') as HTMLElement;
  const bubble = pending.querySelector('.flower-pending-submission-bubble') as HTMLElement;
  const pendingRect = pending.getBoundingClientRect();
  const transcriptRect = transcript.getBoundingClientRect();

  expect(pending.textContent).toContain('Inspect the first-turn submission experience');
  expect(pending.textContent).toContain('Sending message...');
  expect(pending.querySelector('[data-flower-message-id]')).toBeNull();
  expect(getComputedStyle(bubble).borderStyle).toBe('dashed');
  expect(textarea.value).toBe('');
  expect(textarea.disabled).toBe(true);
  expect(pendingRect.left).toBeGreaterThanOrEqual(transcriptRect.left - 1);
  expect(pendingRect.right).toBeLessThanOrEqual(transcriptRect.right + 1);
  expect(pending.scrollWidth).toBeLessThanOrEqual(pending.clientWidth + 1);
  expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
}

describe('Flower pending submission browser presentation', () => {
  it('keeps immediate first-turn feedback contained on mobile', async () => {
    await verifyPendingSubmission(375, 812);
  });

  it('keeps immediate first-turn feedback contained on desktop', async () => {
    await verifyPendingSubmission(1280, 900);
  });

  it('keeps an unresolved admission in the transcript when the canonical thread is running', async () => {
    const prompt = '长沙天气';
    const admission = deferred<FlowerTurnLaunchReceipt>();
    let canonical = thread({
      thread_id: 'thread-admission-running',
      status: 'running',
      active_run_id: 'run-existing',
      messages: [],
    });
    const loadThread = vi.fn(async () => liveBootstrap(canonical));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [canonical]),
      loadThread,
      launchTurn: vi.fn(async (input) => ({
        ...await admission.promise,
        client_request_id: input.client_request_id,
      })),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-admission-running"] button')));
    (runtime.querySelector('[data-thread-id="thread-admission-running"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = prompt;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-pending-submission-id]')));
    expect(runtime.querySelector('.flower-queued-turn-dock')).toBeNull();
    expect(runtime.querySelector('[data-flower-pending-submission-id]')?.textContent).toContain(prompt);

    canonical = thread({
      ...canonical,
      messages: [{
        id: 'message-canonical-user',
        turn_id: 'turn-canonical-user',
        role: 'user',
        content: prompt,
        status: 'complete',
        created_at_ms: Date.now(),
      }],
    });
    admission.resolve({
      client_request_id: 'replaced-by-launch-adapter',
      thread_id: canonical.thread_id,
      admission_id: 'admission-canonical-user',
      kind: 'admitting',
    });

    await waitFor(() => runtime.querySelector('[data-flower-pending-submission-id]') === null);
    expect(runtime.querySelector('.flower-queued-turn-dock')).toBeNull();
    expect(Array.from(runtime.querySelectorAll('[data-flower-message-id]')).filter((row) => row.textContent?.includes(prompt))).toHaveLength(1);
  });

  it('does not let an earlier identical canonical user message consume a new admission preview', async () => {
    const prompt = 'Repeat this exact request';
    const admission = deferred<FlowerTurnLaunchReceipt>();
    const canonical = thread({
      thread_id: 'thread-repeated-admission',
      status: 'running',
      active_run_id: 'run-existing',
      messages: [{
        id: 'message-earlier-user',
        turn_id: 'turn-earlier-user',
        role: 'user',
        content: prompt,
        status: 'complete',
        created_at_ms: Date.now(),
      }],
    });
    const launchTurn = vi.fn(async (input) => ({
      ...await admission.promise,
      client_request_id: input.client_request_id,
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [canonical]),
      loadThread: vi.fn(async () => liveBootstrap(canonical)),
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-repeated-admission"] button')));
    (runtime.querySelector('[data-thread-id="thread-repeated-admission"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = prompt;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-pending-submission-id]')));

    admission.resolve({
      client_request_id: 'replaced-by-launch-adapter',
      thread_id: canonical.thread_id,
      admission_id: 'admission-new-identical-user',
      kind: 'admitting',
    });
    await waitFor(() => !(runtime.querySelector('textarea') as HTMLTextAreaElement).disabled);

    expect(runtime.querySelector('[data-flower-pending-submission-id]')?.textContent).toContain(prompt);
    expect(runtime.querySelectorAll('[data-flower-message-id]')).toHaveLength(1);
    expect(runtime.querySelector('.flower-queued-turn-dock')).toBeNull();
  });

  it('renders a compact canonical queue and deletes only the selected middle item', async () => {
    let canonical = thread({
      thread_id: 'thread-compact-queue',
      status: 'running',
      active_run_id: 'run-active',
      messages: [],
      queued_turn_count: 3,
      queued_turns: [
        { queue_id: 'queue-first', prompt: 'First queued request', created_at_ms: 10 },
        {
          queue_id: 'queue-middle',
          prompt: 'Middle queued request with enough text to require compact single-line truncation instead of a full message bubble',
          created_at_ms: 20,
          attachments: [{ attachment_id: 'attachment-1', name: 'notes.txt', mime_type: 'text/plain', size_bytes: 128 }],
        },
        { queue_id: 'queue-last', prompt: 'Last queued request', created_at_ms: 30 },
      ],
    });
    const deleteQueuedTurn = vi.fn(async (_threadID: string, queueID: string) => {
      canonical = thread({
        ...canonical,
        queued_turn_count: 2,
        queued_turns: canonical.queued_turns?.filter((turn) => turn.queue_id !== queueID),
      });
      return liveBootstrap(canonical, 2);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [canonical]),
      loadThread: vi.fn(async () => liveBootstrap(canonical)),
      deleteQueuedTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-queue"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-queue"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 3);

    const middle = runtime.querySelector('[data-flower-queued-turn-dock-id="queue-middle"]') as HTMLElement;
    const label = middle.querySelector('.flower-queued-turn-label') as HTMLElement;
    expect(middle.querySelector('.flower-message-bubble')).toBeNull();
    expect(middle.querySelector('.flower-message-time')).toBeNull();
    expect(middle.querySelector('.flower-queued-turn-state')).toBeNull();
    expect(getComputedStyle(label).textOverflow).toBe('ellipsis');
    expect(middle.getBoundingClientRect().height).toBeGreaterThanOrEqual(34);
    expect(middle.getBoundingClientRect().height).toBeLessThanOrEqual(40);
    expect(middle.textContent).toContain('1');

    (middle.querySelector('[data-flower-queued-turn-delete]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 2);

    expect(deleteQueuedTurn).toHaveBeenCalledWith('thread-compact-queue', 'queue-middle');
    expect(Array.from(runtime.querySelectorAll('[data-flower-queued-turn-dock-id]')).map((row) => row.getAttribute('data-flower-queued-turn-dock-id'))).toEqual([
      'queue-first',
      'queue-last',
    ]);

    await page.viewport(375, 812);
    const dock = runtime.querySelector('.flower-queued-turn-dock') as HTMLElement;
    expect(dock.scrollWidth).toBeLessThanOrEqual(dock.clientWidth + 1);
    for (const row of Array.from(runtime.querySelectorAll('[data-flower-queued-turn-dock-id]')) as HTMLElement[]) {
      expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(34);
      expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(40);
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it('uses the same compact queue contract in the open companion drawer', async () => {
    await page.viewport(375, 812);
    const canonical = thread({
      thread_id: 'thread-companion-queue',
      status: 'running',
      messages: [],
      queued_turn_count: 1,
      queued_turns: [{
        queue_id: 'queue-companion',
        prompt: 'A compact queued request in the companion drawer that must stay on one line',
        created_at_ms: 1,
      }],
    });
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => [canonical]),
      loadThread: vi.fn(async () => liveBootstrap(canonical)),
      deleteQueuedTurn: vi.fn(async () => liveBootstrap({ ...canonical, queued_turn_count: 0, queued_turns: [] }, 2)),
    }, {
      presentation: 'companion',
      companionOpen: true,
      engaged: true,
      transcriptVisible: true,
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-companion-queue"] button')));
    (runtime.querySelector('[data-thread-id="thread-companion-queue"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-queued-turn-dock-id="queue-companion"]')));

    const row = runtime.querySelector('[data-flower-queued-turn-dock-id="queue-companion"]') as HTMLElement;
    expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(34);
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(40);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    expect(row.querySelector('[data-flower-queued-turn-delete]')).not.toBeNull();
    expect(row.querySelector('.flower-queued-turn-send')).not.toBeNull();
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it('moves a submission into the queue dock only after an explicit queued receipt', async () => {
    const prompt = 'Queue this follow-up';
    let canonical = thread({
      thread_id: 'thread-explicit-queue',
      status: 'running',
      active_run_id: 'run-active',
      messages: [],
      queued_turn_count: 0,
      queued_turns: [],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [canonical]),
      loadThread: vi.fn(async () => liveBootstrap(canonical)),
      launchTurn: vi.fn(async (input) => {
        canonical = thread({
          ...canonical,
          queued_turn_count: 1,
          queued_turns: [{ queue_id: 'queue-explicit', prompt, created_at_ms: Date.now() }],
        });
        return {
          client_request_id: input.client_request_id,
          thread_id: canonical.thread_id,
          queue_id: 'queue-explicit',
          kind: 'queued' as const,
        };
      }),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-explicit-queue"] button')));
    (runtime.querySelector('[data-thread-id="thread-explicit-queue"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = prompt;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-queued-turn-dock-id="queue-explicit"]')));
    expect(runtime.querySelector('[data-flower-pending-submission-id]')).toBeNull();
    expect(runtime.querySelectorAll('[data-flower-queued-turn-dock-id="queue-explicit"]')).toHaveLength(1);
  });

  it('rolls an optimistic queued-turn deletion back in its original order when the command fails', async () => {
    const deletion = deferred<ReturnType<typeof liveBootstrap>>();
    const canonical = thread({
      thread_id: 'thread-delete-rollback',
      status: 'running',
      messages: [],
      queued_turn_count: 3,
      queued_turns: [
        { queue_id: 'queue-a', prompt: 'A', created_at_ms: 1 },
        { queue_id: 'queue-b', prompt: 'B', created_at_ms: 2 },
        { queue_id: 'queue-c', prompt: 'C', created_at_ms: 3 },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [canonical]),
      loadThread: vi.fn(async () => liveBootstrap(canonical, 2)),
      deleteQueuedTurn: vi.fn(() => deletion.promise),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-delete-rollback"] button')));
    (runtime.querySelector('[data-thread-id="thread-delete-rollback"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 3);

    (runtime.querySelector('[data-flower-queued-turn-dock-id="queue-b"] [data-flower-queued-turn-delete]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 2);
    deletion.reject(new Error('Queue item was already changed.'));
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 3);

    expect(Array.from(runtime.querySelectorAll('[data-flower-queued-turn-dock-id]')).map((row) => row.getAttribute('data-flower-queued-turn-dock-id'))).toEqual([
      'queue-a',
      'queue-b',
      'queue-c',
    ]);
    expect(flowerSurfaceNotifications().at(-1)).toMatchObject({ tone: 'error', message: 'Queue item was already changed.' });
  });

  it('reconciles a delete conflict to canonical state when the queued item was already admitted', async () => {
    let canonical = thread({
      thread_id: 'thread-delete-conflict',
      status: 'running',
      messages: [],
      queued_turn_count: 2,
      queued_turns: [
        { queue_id: 'queue-promoted', prompt: 'Promoted elsewhere', created_at_ms: 1 },
        { queue_id: 'queue-still-waiting', prompt: 'Still waiting', created_at_ms: 2 },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [canonical]),
      loadThread: vi.fn(async () => liveBootstrap(canonical, 3)),
      deleteQueuedTurn: vi.fn(async () => {
        canonical = thread({
          ...canonical,
          queued_turn_count: 1,
          queued_turns: canonical.queued_turns?.filter((turn) => turn.queue_id !== 'queue-promoted'),
        });
        throw new Error('Queued turn was already admitted.');
      }),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-delete-conflict"] button')));
    (runtime.querySelector('[data-thread-id="thread-delete-conflict"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 2);

    (runtime.querySelector('[data-flower-queued-turn-dock-id="queue-promoted"] [data-flower-queued-turn-delete]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 1);

    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queue-promoted"]')).toBeNull();
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queue-still-waiting"]')).not.toBeNull();
  });

  it('does not let a late queued receipt replace a newer thread selection', async () => {
    const admission = deferred<FlowerTurnLaunchReceipt>();
    const threadA = thread({ thread_id: 'thread-late-receipt-a', status: 'running', messages: [] });
    const threadB = thread({ thread_id: 'thread-late-receipt-b', status: 'idle', messages: [] });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [threadA, threadB]),
      loadThread: vi.fn(async (threadID) => liveBootstrap(threadID === threadA.thread_id ? threadA : threadB)),
      launchTurn: vi.fn(async (input) => ({
        ...await admission.promise,
        client_request_id: input.client_request_id,
      })),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-late-receipt-a"] button')));
    (runtime.querySelector('[data-thread-id="thread-late-receipt-a"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === threadA.thread_id);

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Late queue receipt';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-pending-submission-id]')));

    (runtime.querySelector('[data-thread-id="thread-late-receipt-b"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === threadB.thread_id);
    admission.resolve({
      client_request_id: 'replaced-by-launch-adapter',
      thread_id: threadA.thread_id,
      queue_id: 'queue-late-receipt-a',
      kind: 'queued',
    });
    await waitFor(() => !(runtime.querySelector('textarea') as HTMLTextAreaElement).disabled);

    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe(threadB.thread_id);
    expect(runtime.querySelector('.flower-queued-turn-dock')).toBeNull();
    expect(runtime.querySelector('[data-flower-pending-submission-id]')).toBeNull();
  });
});
