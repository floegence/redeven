import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import type { FlowerHistoryRequest, FlowerLiveStreamEnvelope, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerTurnLaunchReceipt } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

async function mountSendHistory() {
  await page.viewport(1280, 900);
  const seed = thread({ thread_id: 'send-history', title: 'Send from history', messages: [] });
  const peer = thread({ thread_id: 'other-thread', title: 'Another conversation' });
  const items: FlowerRuntimeCurrentItem[] = Array.from({ length: 330 }, (_, index) => ({
    id: `old-${index}`, ordinal: index + 1, kind: 'assistant', turn_id: 'old-turn', run_id: 'old-run',
    text: `Earlier answer ${index}\n\nA paragraph retained while reading conversation history.`,
  }));
  let version = 1;
  let active = false;
  let interest: FlowerHistoryRequest = {};
  const events: Array<FlowerLiveStreamEnvelope | Error> = [];
  let connections = 0;
  let wake: (() => void) | undefined;
  const push = (event: FlowerLiveStreamEnvelope) => { events.push(event); wake?.(); };
  const receipt = deferred<FlowerTurnLaunchReceipt>();
  let pendingRead: { hold: ReturnType<typeof deferred<void>>; match: (input: FlowerHistoryRequest) => boolean } | undefined;
  let nextError: unknown;
  const launch = vi.fn(async (_input: Parameters<ReturnType<typeof adapter>['launchTurn']>[0]) => receipt.promise);
  const current = (request: FlowerHistoryRequest): FlowerRuntimeCurrentView => {
    const anchor = request.anchor_id ? items.findIndex(item => item.id === request.anchor_id) : items.length;
    const limit = request.limit ?? 150;
    const selected = request.item_ids ? items.filter(item => request.item_ids!.includes(item.id))
      : request.direction === 'after' ? items.slice(anchor + 1, anchor + 1 + limit)
        : items.slice(Math.max(0, anchor - limit), anchor);
    return { thread_id: seed.thread_id, view_version: version, activity: active ? 'active' : 'idle',
      ...(active ? { turn_id: 'new-turn', run_id: 'new-run', run_progress: { phase: 'streaming' as const } } : {}),
      queue: [], interactions: [], turns: [], items: selected.map(item => ({ ...item })),
      window: { first_item_id: selected[0]?.id, last_item_id: selected.at(-1)?.id,
        has_before: selected[0]?.id !== items[0]?.id, has_after: selected.at(-1)?.id !== items.at(-1)?.id },
    };
  };
  const history = vi.fn(async (id: string, input: FlowerHistoryRequest) => {
    if (id === peer.thread_id) return liveBootstrap(peer);
    if (nextError) { const error = nextError; nextError = undefined; throw error; }
    if (input.observer_id) interest = input;
    const view = current(input);
    if (pendingRead?.match(input)) {
      const { hold } = pendingRead; pendingRead = undefined;
      await hold.promise;
    }
    return { thread: applyFlowerRuntimeCurrentView(seed, view), current: view };
  });
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed, peer],
    loadHistory: history, launchTurn: launch, resolveStorageGeneration: async () => 'a'.repeat(32),
    releaseHistory: async () => undefined,
    loadThread: async () => { throw new Error('Use bounded history'); },
    async *connectLiveStream({ signal }) {
      connections++;
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'send-observer', summaries: [seed, peer] };
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) {
        const event = events.shift();
        if (event instanceof Error) throw event;
        if (event) yield event; else await new Promise<void>(resolve => { wake = resolve; });
      } }
      finally { signal.removeEventListener('abort', abort); }
    },
  }, { focusThreadRequest: { request_id: 'open-send-history', thread_id: seed.thread_id } });
  root.style.height = '780px';
  const viewport = () => root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="old-329"]')) && viewport()?.dataset.flowerTailPreparing !== 'true', 3000);
  const scroll = (top: number, direction: number) => {
    viewport().dispatchEvent(new WheelEvent('wheel', { deltaY: direction, bubbles: true }));
    viewport().scrollTop = top;
    viewport().dispatchEvent(new Event('scroll'));
  };
  const publish = () => {
    const view = current(interest);
    push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id, reading_revision: interest.reading_revision, current: view, window: view.window });
  };
  const acknowledge = () => receipt.resolve({ client_request_id: launch.mock.calls[0][0].client_request_id, thread_id: seed.thread_id });
  return { root, viewport, history, launch, scroll, publish, acknowledge, interest: () => interest, connections: () => connections,
    disconnect: () => { events.push(Object.assign(new Error('Connection lost'), { code: 'transport' })); wake?.(); },
    publishTool: () => {
      version++;
      items.push({ id: 'new-tool', ordinal: items.length + 1, kind: 'tool', turn_id: 'new-turn', run_id: 'new-run',
        activity: { item_id: 'new-tool', tool_id: 'new-tool', kind: 'tool', tool_name: 'terminal_exec', status: 'running',
          severity: 'quiet', needs_attention: false, requires_approval: false,
          presentation: { label: 'Inspect the workspace', renderer: 'terminal', payload: { command: 'pwd' } } } });
      publish();
    },
    pauseNextRead: (match: (input: FlowerHistoryRequest) => boolean) => {
      const hold = deferred<void>(); pendingRead = { hold, match }; return hold;
    },
    failNextRead: () => { nextError = { code: 'transport' }; },
    reject: (kind: 'unknown' | 'rejected' = 'unknown') => receipt.reject(flowerTurnAdmissionError(kind, new Error('Send was not confirmed'))),
    shorten: () => {
      const style = document.createElement('style');
      style.textContent = '[data-flower-row-message-id^="old-"] { display: none !important; }'; root.append(style);
    },
    browse: async () => {
      scroll(400, -100);
      await waitFor(() => Boolean(interest.item_ids), 3000);
      await waitFor(() => root.querySelector('[data-flower-message-id="old-150"]') !== null, 3000);
    },
    send: async () => {
      const editor = root.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
      editor.value = 'continue'; editor.dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector<HTMLButtonElement>('[data-flower-primary-action="send"]')!.click();
      await waitFor(() => launch.mock.calls.length === 1, 3000);
    },
    admit: (liveFirst = false, completed = false, ack = true) => {
      const input = launch.mock.calls[0][0];
      active = !completed; version++;
      items.push({ id: `user:${input.client_request_id}`, ordinal: 331,
        kind: 'user', turn_id: 'new-turn', run_id: 'new-run', text: input.prompt },
      { id: 'new-answer', ordinal: 332, kind: 'assistant', turn_id: 'new-turn', run_id: 'new-run',
        text: 'New execution output.\n\n' + 'A new paragraph to follow automatically.\n\n'.repeat(24), live: !completed });
      if (liveFirst) publish();
      if (ack) acknowledge();
    },
    grow: () => { version++; items.push({ id: 'next-answer', ordinal: items.length + 1, kind: 'assistant', turn_id: 'new-turn', run_id: 'new-run', text: 'Subsequent output.\n\n'.repeat(16), live: true }); publish(); },
  };
}

it.each(['history', 'latest', 'short', 'completed', 'live-first'] as const)('follows new messages after sending from %s without any scroll input', async scenario => {
  const fixture = await mountSendHistory();
  if (scenario !== 'latest') await fixture.browse();
  if (scenario === 'short') fixture.shorten();
  const reads = fixture.history.mock.calls.length;
  await fixture.send();
  if (scenario === 'live-first') await waitFor(() => !fixture.interest().item_ids && !fixture.interest().anchor_id, 3000);
  fixture.admit(scenario === 'live-first', scenario === 'completed', scenario !== 'live-first');
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="new-answer"]')), 3000);
  await waitFor(() => fixture.viewport().scrollHeight - fixture.viewport().scrollTop - fixture.viewport().clientHeight <= 2, 3000);
  expect(fixture.root.textContent).not.toContain('Received, syncing');
  expect(fixture.root.querySelectorAll('[data-flower-pending-message]')).toHaveLength(0);
  expect(fixture.interest().item_ids).toBeUndefined();
  expect(fixture.interest().anchor_id).toBeUndefined();
  if (scenario === 'completed') {
    expect(fixture.root.querySelector('[data-flower-progress-run-id="new-run"]')).toBeNull();
    expect(fixture.launch).toHaveBeenCalledTimes(1);
    return;
  }
  if (scenario === 'live-first') fixture.acknowledge();
  fixture.publishTool();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-activity-item-id="new-tool"]')), 3000);
  fixture.grow();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="next-answer"]')), 3000);
  await waitFor(() => fixture.viewport().scrollHeight - fixture.viewport().scrollTop - fixture.viewport().clientHeight <= 2, 3000);
  expect(fixture.launch).toHaveBeenCalledTimes(1);
  expect(fixture.history.mock.calls.length - reads).toBeLessThanOrEqual(2);
});

it('refreshes after admission when the pre-admission latest response arrives late', async () => {
  const fixture = await mountSendHistory();
  await fixture.browse();
  const hold = fixture.pauseNextRead(input => !input.anchor_id && !input.item_ids);
  await fixture.send();
  await waitFor(() => !fixture.interest().item_ids, 3000);
  fixture.admit();
  hold.resolve();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="new-answer"]')), 3000);
  await waitFor(() => fixture.viewport().scrollHeight - fixture.viewport().scrollTop - fixture.viewport().clientHeight <= 2, 3000);
  expect(fixture.root.textContent).not.toContain('Received, syncing');
  expect(fixture.launch).toHaveBeenCalledTimes(1);
});

it('supersedes a historical page still in flight when sending', async () => {
  const fixture = await mountSendHistory();
  const hold = fixture.pauseNextRead(input => Boolean(input.anchor_id));
  fixture.scroll(400, -100);
  await waitFor(() => fixture.history.mock.calls.some(([, input]) => input.anchor_id !== undefined), 3000);
  await fixture.send(); fixture.admit();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="new-answer"]')), 3000);
  hold.resolve();
  fixture.grow();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="next-answer"]')), 3000);
  await waitFor(() => fixture.viewport().scrollHeight - fixture.viewport().scrollTop - fixture.viewport().clientHeight <= 2, 3000);
  expect(fixture.interest().anchor_id).toBeUndefined();
});

it('keeps a later reading position through send confirmation and subsequent output', async () => {
  const fixture = await mountSendHistory();
  await fixture.browse(); await fixture.send();
  await waitFor(() => !fixture.interest().item_ids, 3000);
  await waitFor(() => fixture.viewport().scrollHeight - fixture.viewport().scrollTop - fixture.viewport().clientHeight <= 2, 3000);
  fixture.scroll(fixture.viewport().scrollTop - 450, -450);
  const editor = fixture.root.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  editor.value = 'Keep my newer draft'; editor.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const bounds = fixture.viewport().getBoundingClientRect();
  const anchor = [...fixture.viewport().querySelectorAll<HTMLElement>('[data-flower-message-id]')]
    .find(element => element.getBoundingClientRect().top >= bounds.top && element.getBoundingClientRect().top < bounds.bottom)!;
  const top = anchor.getBoundingClientRect().top;
  fixture.admit();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="new-answer"]')), 3000);
  fixture.grow();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="next-answer"]')), 3000);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(anchor.isConnected).toBe(true);
  expect(Math.abs(anchor.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
  expect(editor.value).toBe('Keep my newer draft');
  expect(fixture.root.querySelector('[data-flower-scroll-to-latest]')).not.toBeNull();
});

it('preserves a selected historical paragraph when the latest read finishes after user input', async () => {
  const fixture = await mountSendHistory();
  await fixture.browse();
  const hold = fixture.pauseNextRead(input => !input.anchor_id && !input.item_ids);
  await fixture.send();
  fixture.scroll(1600, -100);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const bounds = fixture.viewport().getBoundingClientRect();
  const anchor = [...fixture.viewport().querySelectorAll<HTMLElement>('[data-flower-message-id]')]
    .find(element => element.getBoundingClientRect().top >= bounds.top && element.getBoundingClientRect().top < bounds.bottom)!;
  const selection = document.getSelection()!;
  const range = document.createRange(); range.selectNodeContents(anchor); selection.removeAllRanges(); selection.addRange(range);
  const text = selection.toString();
  const top = anchor.getBoundingClientRect().top;
  fixture.admit(); hold.resolve();
  await waitFor(() => Boolean(fixture.interest().item_ids), 3000);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(anchor.isConnected).toBe(true);
  expect(selection.toString()).toBe(text);
  expect(Math.abs(anchor.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
  expect(fixture.root.querySelector('[data-flower-scroll-to-latest]')).not.toBeNull();
  selection.removeAllRanges();
  fixture.root.querySelector<HTMLButtonElement>('[data-flower-scroll-to-latest]')!.click();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="new-answer"]')), 3000);
  await waitFor(() => fixture.viewport().scrollHeight - fixture.viewport().scrollTop - fixture.viewport().clientHeight <= 2, 3000);
  expect(fixture.root.textContent).not.toContain('Received, syncing');
  expect(fixture.launch).toHaveBeenCalledTimes(1);
});

it('does not select the sending thread again when its receipt arrives after navigation', async () => {
  const fixture = await mountSendHistory();
  await fixture.browse(); await fixture.send();
  fixture.root.querySelector<HTMLButtonElement>('[data-thread-id="other-thread"] button')!.click();
  await waitFor(() => fixture.root.querySelector('main')?.dataset.flowerSelectedThreadId === 'other-thread', 3000);
  fixture.admit();
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(fixture.root.querySelector('main')?.dataset.flowerSelectedThreadId).toBe('other-thread');
  expect(fixture.root.querySelector('[data-flower-message-id="new-answer"]')).toBeNull();
  expect(fixture.launch).toHaveBeenCalledTimes(1);
});

it('recovers a latest-window transport failure without sending again', async () => {
  const fixture = await mountSendHistory();
  await fixture.browse(); fixture.failNextRead();
  await fixture.send(); fixture.admit();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="new-answer"]')), 3000);
  await waitFor(() => fixture.viewport().scrollHeight - fixture.viewport().scrollTop - fixture.viewport().clientHeight <= 2, 3000);
  expect(fixture.root.textContent).not.toContain('Received, syncing');
  expect(fixture.launch).toHaveBeenCalledTimes(1);
});

it('keeps an unknown send visible without replaying it during latest-window recovery', async () => {
  const fixture = await mountSendHistory();
  await fixture.browse(); await fixture.send(); fixture.reject();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-transport-delivery="unknown"]')), 3000);
  expect(fixture.root.querySelector('[data-flower-pending-message]')?.textContent).toContain('continue');
  expect(fixture.launch).toHaveBeenCalledTimes(1);
});

it('keeps canonical confirmation when its delayed HTTP request fails', async () => {
  const fixture = await mountSendHistory();
  await fixture.browse(); await fixture.send();
  await waitFor(() => !fixture.interest().item_ids && !fixture.interest().anchor_id, 3000);
  fixture.admit(true, false, false);
  await waitFor(() => fixture.root.querySelector('[data-flower-pending-message]') === null, 3000);
  fixture.reject();
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(fixture.root.querySelector('[data-flower-transport-delivery]')).toBeNull();
  expect(fixture.root.querySelector('[data-flower-message-id="new-answer"]')).not.toBeNull();
  expect(fixture.launch).toHaveBeenCalledTimes(1);
});

it('retains a rejected submitted message without pretending that the thread is running', async () => {
  const fixture = await mountSendHistory();
  await fixture.browse(); await fixture.send(); fixture.reject('rejected');
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-transport-delivery="failed"]')), 3000);
  expect(fixture.root.querySelector('[data-flower-pending-message]')?.textContent).toContain('continue');
  expect(fixture.root.querySelector('[data-flower-progress-run-id="new-run"]')).toBeNull();
  expect(fixture.launch).toHaveBeenCalledTimes(1);
});

it('restores the latest interest after a transport disconnect without replaying the send', async () => {
  const fixture = await mountSendHistory();
  await fixture.browse(); await fixture.send(); fixture.admit();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="new-answer"]')), 3000);
  const reads = fixture.history.mock.calls.length;
  fixture.disconnect();
  await waitFor(() => fixture.connections() === 2 && fixture.history.mock.calls.length > reads, 5000);
  expect(fixture.interest().item_ids).toBeUndefined();
  expect(fixture.interest().anchor_id).toBeUndefined();
  fixture.grow();
  await waitFor(() => Boolean(fixture.root.querySelector('[data-flower-message-id="next-answer"]')), 3000);
  await waitFor(() => fixture.viewport().scrollHeight - fixture.viewport().scrollTop - fixture.viewport().clientHeight <= 2, 3000);
  expect(fixture.launch).toHaveBeenCalledTimes(1);
});
