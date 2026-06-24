// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { FlowerThreadSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  flush,
  liveBootstrap,
  modelIOStatus,
  readStatus,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

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
  it('renders active run context usage in the thread header with accessible progress', async () => {
    const selectedThread = threadWithContext();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selectedThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context"] button')));
    (runtime.querySelector('[data-thread-id="thread-context"] button') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-context-usage-meter')));
    const header = runtime.querySelector('.flower-chat-header');
    const meter = header?.querySelector('.flower-context-usage-meter');
    const progress = meter?.querySelector('[role="progressbar"]');

    expect(meter?.textContent).toContain('Context');
    expect(meter?.textContent).toContain('91%');
    expect(meter?.textContent).toContain('182k of 200k');
    expect(meter?.textContent).toContain('Near limit');
    expect(meter?.getAttribute('data-context-pressure')).toBe('warning');
    expect(progress?.getAttribute('aria-valuenow')).toBe('91');
    expect(runtime.querySelector('.flower-model-status-lane .flower-context-usage-meter')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-lane')?.textContent).toContain('Thinking...');
  });

  it('hides context usage from a stale run instead of showing old pressure', async () => {
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
    await flush();

    expect(runtime.querySelector('.flower-context-usage-meter')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-lane')?.textContent).toContain('Thinking...');
  });

  it('renders text-only context status when no reliable ratio exists', async () => {
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

    await waitFor(() => Boolean(runtime.querySelector('.flower-context-usage-meter')));
    const meter = runtime.querySelector('.flower-context-usage-meter');
    expect(meter?.textContent).toContain('Context');
    expect(meter?.textContent).toContain('Estimated');
    expect(meter?.textContent).not.toContain('0%');
    expect(meter?.querySelector('[role="progressbar"]')).toBeNull();
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
        anchor_message_id: 'm-context-assistant',
        placement: 'before',
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
    expect(divider?.textContent).toContain('60k to 488');
    expect(divider?.querySelector('button, a')).toBeNull();
    expect(runtime.querySelectorAll('[data-flower-message-id]')).toHaveLength(2);
    expect(runtime.querySelector('[data-flower-message-id] .flower-compaction-divider')).toBeNull();
  });
});
