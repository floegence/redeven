import hostWorkDetail from '../../../../flower_ui/src/testdata/hostWorkCompletedDetail.json';
import { createRuntimeFlowerSurfaceAdapter } from '../../../../flower_ui/src/runtimeFlowerSurfaceAdapter';
import '../index.css';
import './flower-feature.css';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import fixture from '../../../../flower_ui/src/testdata/boundedWhitespaceCurrentView.json';
import type { FlowerRuntimeCurrentView, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, deferred, disposeRenderedSurface, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it('hydrates published whitespace prefixes without interrupting sync or replaying a task', async () => {
  await page.viewport(1100, 850);
  const current = fixture as unknown as FlowerRuntimeCurrentView;
  const selected = applyFlowerRuntimeCurrentView(thread({ thread_id: current.thread_id, messages: [], status: 'success' }), current);
  const base = adapter();
  const read = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryBody']>>(async (threadID, input) => {
    const item = current.items!.find(item => item.id === input.item_id)!;
    const full = '\n'.repeat(2048) + (item.id === 'final' ? 'Final answer.' : 'Intermediate observation.');
    return { ...item.body!, thread_id: threadID, item_id: item.id, offset_bytes: input.offset_bytes,
      through_bytes: input.through_bytes, text: full.slice(input.offset_bytes, input.through_bytes) };
  });
  const runtime = renderSurfaceWithAdapterProps({ ...base, listThreads: vi.fn(async () => [selected]),
    loadThread: vi.fn(async () => ({ thread: selected, current })),
    loadHistory: vi.fn(async () => ({ thread: selected, current })), loadHistoryBody: read, loadHistoryItem: vi.fn(async () => { throw new Error('Expected bounded body read'); }),
    connectLiveStream: async function* (input) {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [selected] };
      if (!input.signal.aborted) await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  }, { focusThreadRequest: { request_id: 'bounded-preview', thread_id: selected.thread_id } });
  runtime.style.cssText = 'width:1100px;height:800px;position:relative';
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="final"]')?.textContent?.includes('Final answer.')), 5000);
  await waitFor(() => runtime.querySelector('.flower-chat-transcript')?.getAttribute('aria-busy') !== 'true');
  expect(read).toHaveBeenCalled();
  expect(runtime.querySelector('.flower-thread-load-error')).toBeNull();
  expect(runtime.querySelector('[data-flower-sync-state="failed"]')).toBeNull();
  expect(base.launchTurn).not.toHaveBeenCalled();
  await page.screenshot({ element: runtime, path: '__screenshots__/flower-bounded-preview.png' });
});


it('retains accepted content and reports safe field diagnostics for a real malformed delta', async () => {
  const source = fixture as unknown as FlowerRuntimeCurrentView;
  const current: FlowerRuntimeCurrentView = { ...source, items: source.items!.map(item => ({ ...item, body: undefined, text: item.id + ' accepted answer' })) };
  const selected = applyFlowerRuntimeCurrentView(thread({ thread_id: current.thread_id }), current);
  const fail = deferred<void>();
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const base = adapter();
  try {
    const runtime = renderSurfaceWithAdapterProps({ ...base,
      loadThread: vi.fn(async () => ({ thread: selected, current })),
      connectLiveStream: async function* (input) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [selected] };
        await fail.promise;
        yield { schema_version: 3, kind: 'thread.batch', thread_id: current.thread_id,
          update: { thread_id: current.thread_id, turn_id: current.turn_id, run_id: current.run_id, base_version: 1, view_version: 2,
            facts: { activity: 'idle', attention: {}, queue_count: 0 }, items: [],
            turns: { value: [{ ...current.turns![0], intermediate_item_ids: ['private-missing-source'] }] } } };
        if (!input.signal.aborted) await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    }, { focusThreadRequest: { request_id: 'malformed-delta', thread_id: selected.thread_id } });
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="final"]')));
    const answer = runtime.querySelector('[data-flower-message-id="final"]');
    fail.resolve();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-sync-state="failed"]')));
    expect(runtime.querySelector('[data-flower-message-id="final"]')).toBe(answer);
    expect(answer?.textContent).toContain('final accepted answer');
    expect(diagnostic).toHaveBeenCalledWith('Flower live synchronization stopped.', expect.objectContaining({
      error_code: 'flower_turn_presentation_error', contract_field: 'intermediate_item_ids', contract_reason: 'missing_item',
    }));
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-missing-source');
    expect(base.launchTurn).not.toHaveBeenCalled();
  } finally { diagnostic.mockRestore(); }
});


it('renders the complete published host-work history after reopening without replay', async () => {
  await page.viewport(1280, 900);
  const base = adapter(true);
  const load = vi.fn(async () => structuredClone(hostWorkDetail));
  const launch = vi.fn(base.launchTurn);
  const source = createRuntimeFlowerSurfaceAdapter({ ...base, launchTurn: launch,
    mapperOptions: { runtimeID: 'fixture', runtimeKind: 'env_local', sourceLabel: 'Runtime', targetLabels: [] },
    transport: { listThreads: async () => ({ threads: [hostWorkDetail.thread] }), loadThread: load, loadHistory: load,
      markThreadRead: async () => ({ read_status: hostWorkDetail.thread.read_status }),
      loadSubagentDetail: async () => { throw new Error('Unexpected subagent read'); },
      patchThread: async () => { throw new Error('Unexpected mutation'); },
      forkThread: async () => { throw new Error('Unexpected fork'); },
      submitApproval: async () => { throw new Error('Unexpected approval'); } },
  });
  for (const requestID of ['initial', 'reopened']) {
    const runtime = renderSurfaceWithAdapterProps(source, { focusThreadRequest: { request_id: requestID, thread_id: hostWorkDetail.thread.thread_id } });
    runtime.style.cssText = 'width:1100px;height:800px;position:relative';
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="answer-completed"]')?.textContent?.includes('COMPLETE_7319 received.')), 5000);
    expect(runtime.querySelector('[data-flower-message-id="answer-running"]')?.textContent).toContain('Command is running.');
    expect(runtime.querySelector('.flower-thread-load-error')).toBeNull();
    expect(runtime.textContent).not.toContain('Flower contract error');
    expect(launch).not.toHaveBeenCalled();
    if (requestID === 'reopened') await page.screenshot({ element: runtime, path: '__screenshots__/flower-host-work-completed.png' });
    disposeRenderedSurface(runtime);
    runtime.remove();
  }
});

it('reports safe kind diagnostics when a full detail contains an unsupported kind', async () => {
  const base = adapter(true);
  const malformed = structuredClone(hostWorkDetail);
  malformed.current.turns[1]!.kind = 'private-unsupported-kind';
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const load = vi.fn(async () => malformed);
  const source = createRuntimeFlowerSurfaceAdapter({ ...base,
    mapperOptions: { runtimeID: 'fixture', runtimeKind: 'env_local', sourceLabel: 'Runtime', targetLabels: [] },
    transport: { listThreads: async () => ({ threads: [hostWorkDetail.thread] }), loadThread: load, loadHistory: load,
      markThreadRead: async () => ({ read_status: hostWorkDetail.thread.read_status }),
      loadSubagentDetail: async () => { throw new Error('Unexpected subagent read'); },
      patchThread: async () => { throw new Error('Unexpected mutation'); },
      forkThread: async () => { throw new Error('Unexpected fork'); },
      submitApproval: async () => { throw new Error('Unexpected approval'); } },
  });
  const runtime = renderSurfaceWithAdapterProps(source, { focusThreadRequest: { request_id: 'unsupported-kind', thread_id: hostWorkDetail.thread.thread_id } });
  try {
    await waitFor(() => Boolean(runtime.querySelector('.flower-thread-load-error')), 5000);
    expect(diagnostic).toHaveBeenCalledWith('Flower thread detail convergence failed.', expect.objectContaining({
      error_code: 'flower_turn_presentation_error', contract_field: 'kind', contract_reason: 'unsupported_value',
    }));
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-unsupported-kind');
    expect(runtime.textContent).not.toContain('private-unsupported-kind');
    expect(base.launchTurn).not.toHaveBeenCalled();
  } finally {
    disposeRenderedSurface(runtime);
    runtime.remove();
    diagnostic.mockRestore();
  }
});
