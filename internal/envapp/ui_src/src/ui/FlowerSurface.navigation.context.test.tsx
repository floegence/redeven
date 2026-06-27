// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveEvent,
  FlowerLiveEventsResponse,
  FlowerThreadSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  deferred,
  liveBootstrap,
  modelIOStatus,
  readStatus,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function liveEvent<K extends FlowerLiveEvent['kind']>(
  threadID: string,
  seq: number,
  kind: K,
  payload: FlowerLiveEvent<K>['payload'],
): FlowerLiveEvent<K> {
  return {
    schema_version: 1,
    seq,
    endpoint_id: 'test-runtime',
    thread_id: threadID,
    run_id: 'run-current',
    turn_id: 'm-context-assistant',
    at_unix_ms: 10_000 + seq,
    kind,
    payload,
  } as FlowerLiveEvent<K>;
}

function threadWithContext(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return thread({
    thread_id: 'thread-context',
    title: 'Context telemetry',
    status: 'running',
    active_run_id: 'run-1',
    model_io_status: modelIOStatus({ run_id: 'run-1', phase: 'streaming' }),
    read_status: readStatus(false, 810, 'running'),
    context_usage: {
      run_id: 'run-1',
      step_index: 1,
      phase: 'projected_request',
      input_tokens: 182_000,
      context_window_tokens: 200_000,
      threshold_tokens: 180_000,
      used_ratio: 0.91,
      threshold_ratio: 0.9,
      pressure_status: 'near_threshold',
      source: 'full_request_estimate',
      updated_at_ms: 8200,
    },
    messages: [
      {
        id: 'm-context-user',
        role: 'user',
        content: 'Continue the migration',
        status: 'complete',
        created_at_ms: 8_000,
        blocks: [{ type: 'markdown', content: 'Continue the migration' }],
      },
      {
        id: 'm-context-assistant',
        role: 'assistant',
        content: '',
        status: 'streaming',
        active_cursor: true,
        created_at_ms: 8_100,
      },
    ],
    ...overrides,
  });
}

describe('FlowerSurface context telemetry', () => {
  it('renders active run context usage beside the composer submit action with accessible progress', async () => {
    const selectedThread = threadWithContext();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selectedThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context"] button')));
    (runtime.querySelector('[data-thread-id="thread-context"] button') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-context-indicator')));
    const header = runtime.querySelector('.flower-chat-header');
    const actions = runtime.querySelector('.flower-composer-actions');
    const indicator = actions?.querySelector('.flower-composer-context-indicator');
    const progress = indicator?.querySelector('[role="progressbar"]');
    const submit = actions?.querySelector('.flower-composer-submit');

    expect(header?.querySelector('.flower-composer-context-indicator')).toBeNull();
    expect(indicator?.textContent).toContain('91%');
    expect(indicator?.textContent).toContain('Context');
    expect(indicator?.textContent).toContain('182,000 of 200,000');
    expect(indicator?.textContent).toContain('Near limit');
    expect(indicator?.getAttribute('data-context-pressure')).toBe('warning');
    expect(progress?.getAttribute('aria-valuenow')).toBe('91');
    expect(progress?.hasAttribute('aria-describedby')).toBe(false);
    (progress as HTMLElement | null)?.focus();
    await waitFor(() => Boolean(progress?.getAttribute('aria-describedby')));
    const tooltipID = progress?.getAttribute('aria-describedby');
    expect(tooltipID).toBeTruthy();
    expect(indicator?.querySelector(`#${tooltipID}`)?.getAttribute('aria-hidden')).toBeNull();
    expect(indicator && submit ? Array.from(actions?.children ?? []).indexOf(indicator) : -1).toBeLessThan(indicator && submit ? Array.from(actions?.children ?? []).indexOf(submit) : 0);
    expect(runtime.querySelector('.flower-model-status-lane .flower-composer-context-indicator')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-lane')?.textContent).toContain('Thinking...');
  });

  it('shows stale run context usage as the last known pressure', async () => {
    const selectedThread = threadWithContext({
      active_run_id: 'run-current',
      model_io_status: modelIOStatus({ run_id: 'run-current', phase: 'streaming' }),
      context_usage: {
        run_id: 'run-old',
        phase: 'projected_request',
        input_tokens: 900,
        context_window_tokens: 1000,
        used_ratio: 0.9,
        pressure_status: 'near_threshold',
        updated_at_ms: 8200,
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selectedThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context"] button')));
    (runtime.querySelector('[data-thread-id="thread-context"] button') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-context-indicator')));
    const indicator = runtime.querySelector('.flower-composer-context-indicator');
    expect(indicator?.getAttribute('data-context-freshness')).toBe('last_known');
    expect(indicator?.textContent).toContain('90%');
    expect(indicator?.textContent).toContain('Last known context');
    expect(runtime.querySelector('.flower-model-status-lane')?.textContent).toContain('Thinking...');
  });

  it('switches from last known to current context usage when the active run reports usage', async () => {
    const liveEvents = deferred<FlowerLiveEventsResponse>();
    const selectedThread = threadWithContext({
      active_run_id: 'run-current',
      model_io_status: modelIOStatus({ run_id: 'run-current', phase: 'streaming' }),
      context_usage: {
        run_id: 'run-old',
        phase: 'projected_request',
        input_tokens: 900,
        context_window_tokens: 1000,
        used_ratio: 0.9,
        pressure_status: 'near_threshold',
        updated_at_ms: 8200,
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selectedThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedThread, 0)),
      listThreadLiveEvents: vi.fn(() => liveEvents.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context"] button')));
    (runtime.querySelector('[data-thread-id="thread-context"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-composer-context-indicator')?.getAttribute('data-context-freshness') === 'last_known');

    liveEvents.resolve({
      stream_generation: 1,
      retained_from_seq: 1,
      next_cursor: 1,
      events: [
        liveEvent('thread-context', 1, 'context.usage.updated', {
          usage: {
            run_id: 'run-current',
            phase: 'projected_request',
            input_tokens: 400,
            context_window_tokens: 1000,
            used_ratio: 0.4,
            pressure_status: 'stable',
            updated_at_ms: 10_001,
          },
        }),
      ],
    });

    await waitFor(() => runtime.querySelector('.flower-composer-context-indicator')?.getAttribute('data-context-freshness') === 'current');
    const indicator = runtime.querySelector('.flower-composer-context-indicator');
    expect(indicator?.textContent).toContain('40%');
    expect(indicator?.textContent).toContain('Context');
    expect(indicator?.textContent).not.toContain('Last known context');
  });

  it('renders unknown percent context status when no reliable ratio exists', async () => {
    const selectedThread = threadWithContext({
      context_usage: {
        run_id: 'run-1',
        phase: 'provider_usage',
        pressure_status: 'estimated',
        updated_at_ms: 8200,
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selectedThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context"] button')));
    (runtime.querySelector('[data-thread-id="thread-context"] button') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-context-indicator')));
    const indicator = runtime.querySelector('.flower-composer-context-indicator');
    const progress = indicator?.querySelector('[role="progressbar"]');
    expect(indicator?.textContent).toContain('Context');
    expect(indicator?.textContent).toContain('Estimated');
    expect(indicator?.textContent).toContain('--%');
    expect(indicator?.textContent).not.toContain('0%');
    expect(progress?.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('renders compaction dividers as timeline decorations without creating transcript messages', async () => {
    const selectedThread = threadWithContext({
      context_compactions: [{
        operation_id: 'compact-1',
        run_id: 'run-1',
        phase: 'complete',
        status: 'compacted',
        tokens_before: 60_000,
        tokens_after_estimate: 488,
        updated_at_ms: 8300,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-1',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'm-context-assistant',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-1',
          run_id: 'run-1',
          phase: 'complete',
          status: 'compacted',
          tokens_before: 60_000,
          tokens_after_estimate: 488,
          updated_at_ms: 8300,
        },
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selectedThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context"] button')));
    (runtime.querySelector('[data-thread-id="thread-context"] button') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider')));
    const divider = runtime.querySelector('.flower-compaction-divider');
    expect(divider?.getAttribute('data-flower-compaction-status')).toBe('compacted');
    expect(divider?.textContent).toContain('Context compacted');
    expect(divider?.textContent).not.toContain('60k to 488');
    const pill = runtime.querySelector('.flower-compaction-divider-pill') as HTMLElement;
    expect(pill.getAttribute('role')).toBe('button');
    expect(pill.getAttribute('tabindex')).toBe('0');
    pill.dispatchEvent(new Event('pointerenter'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider-tooltip[data-open="true"]')));
    expect(runtime.querySelector('.flower-compaction-divider-tooltip')?.textContent).toContain('60k to 488');
    pill.dispatchEvent(new Event('pointerleave'));
    await waitFor(() => !runtime.querySelector('.flower-compaction-divider-tooltip'));
    pill.focus();
    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider-tooltip[data-open="true"]')));
    pill.blur();
    await waitFor(() => !runtime.querySelector('.flower-compaction-divider-tooltip'));
    pill.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider-tooltip[data-open="true"]')));
    expect(divider?.querySelector('button, a')).toBeNull();
    const messageIDs = Array.from(runtime.querySelectorAll('[data-flower-message-id]'))
      .map((node) => node.getAttribute('data-flower-message-id'));
    expect(new Set(messageIDs)).toEqual(new Set(['m-context-user', 'm-context-assistant']));
    expect(runtime.querySelector('[data-flower-message-id] .flower-compaction-divider')).toBeNull();
  });
});
