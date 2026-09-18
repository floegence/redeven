import { describe, expect, it } from 'vitest';

import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type { FlowerContextCompaction, FlowerContextUsage, FlowerContextSample } from '../contracts/flowerSurfaceContracts';
import {
  buildFlowerComposerContextIndicatorView,
  compactionDividerDetail,
  compactionDividerLabel,
  contextPressureTone,
  contextUsagePercent,
  formatContextTokenCount,
  formatThreadCacheHitPercent,
  threadCacheHitRatio,
} from './flowerContextPresentation';

function usage(overrides: Partial<FlowerContextSample> & Pick<FlowerContextUsage, 'thread_usage'> = {}): FlowerContextUsage {
  const { thread_usage, ...sample } = overrides;
  return { confirmed: { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1000, ...sample }, thread_usage };
}

function compaction(overrides: Partial<FlowerContextCompaction> = {}): FlowerContextCompaction {
  return {
    operation_id: 'compact-1',
    phase: 'complete',
    status: 'compacted',
    updated_at_ms: 1000,
    ...overrides,
  };
}

describe('flower context presentation', () => {
  it('shows one confirmed ratio and only actionable pressure', () => {
    const view = buildFlowerComposerContextIndicatorView(usage({
      input_tokens: 182_000, context_window_tokens: 200_000, used_ratio: 0.91,
      pressure_status: 'near_threshold',
    }), DEFAULT_FLOWER_SURFACE_COPY);
    expect(view).toMatchObject({
      ariaLabel: 'Context', ratioValue: '91%',
      cacheHitLabel: 'Cache hit rate', cacheHitValue: '—', tone: 'warning',
      ratio: 0.91, progressValue: 91, warning: 'Near limit',
      ariaValueText: 'Context: 91%, Cache hit rate: Not available, Near limit',
    });
  });

  it('uses confirmed tokens when the ratio is absent and distinguishes zero from unknown', () => {
    expect(contextUsagePercent(usage({ input_tokens: 500, context_window_tokens: 1000 }).confirmed!)).toBe(50);
    expect(contextUsagePercent(usage({ input_tokens: 0, context_window_tokens: 1000 }).confirmed!)).toBe(0);
    const unknown = buildFlowerComposerContextIndicatorView(usage(), DEFAULT_FLOWER_SURFACE_COPY);
    expect(unknown.progressValue).toBeNull();
    expect(unknown.ratioValue).toBe('—');
    expect(unknown.warning).toBe('');
    expect(unknown.ariaValueText).toBe('Context: Not available, Cache hit rate: Not available');
  });

  it('localizes tooltip percentages and accessible usage', () => {
    const copy = { ...DEFAULT_FLOWER_SURFACE_COPY, chat: { ...DEFAULT_FLOWER_SURFACE_COPY.chat,
      contextIndicator: { ...DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator, percent: (percent: number) => `${percent}% 已用` },
    } };
    const view = buildFlowerComposerContextIndicatorView(usage({ input_tokens: 72000, context_window_tokens: 100000 }), copy);
    expect(view.ratioValue).toBe('72% 已用');
    expect(view.ariaValueText).toBe('Context: 72% 已用, Cache hit rate: Not available');
  });

  it('calculates the whole-conversation cache hit rate from disjoint input buckets', () => {
    const current = usage({
      thread_usage: {
        input_tokens: 50,
        output_tokens: 20,
        cache_read_tokens: 45,
        cache_write_tokens: 5,
      },
    });
    const view = buildFlowerComposerContextIndicatorView(current, DEFAULT_FLOWER_SURFACE_COPY);

    expect(threadCacheHitRatio(current)).toBe(0.45);
    expect(view.cacheHitValue).toBe('45%');
    expect(view.ariaValueText).toContain('Cache hit rate: 45%');
  });

  it('shows the first live cache hit rate without waiting for a refresh', () => {
    const current = usage({
      thread_usage: {
        input_tokens: 44_896,
        output_tokens: 4_365,
        cache_read_tokens: 16_128,
        cache_write_tokens: 0,
      },
    });

    expect(threadCacheHitRatio(current)).toBeCloseTo(0.2642789722);
    expect(formatThreadCacheHitPercent(current, 'Not available')).toBe('26%');
  });

  it('formats zero, exact, near-perfect, and unavailable cache hit rates honestly', () => {
    expect(formatThreadCacheHitPercent(usage({
      thread_usage: { input_tokens: 100, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
    }), 'Not available')).toBe('0%');
    expect(formatThreadCacheHitPercent(usage({
      thread_usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 100, cache_write_tokens: 0 },
    }), 'Not available')).toBe('100%');
    expect(formatThreadCacheHitPercent(usage({
      thread_usage: { input_tokens: 1, output_tokens: 0, cache_read_tokens: 1999, cache_write_tokens: 0 },
    }), 'Not available')).toBe('99.95%');
    expect(formatThreadCacheHitPercent(usage({
      thread_usage: { input_tokens: 0, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 },
    }), 'Not available')).toBe('Not available');
  });

  it('never substitutes inflated estimates for confirmed usage across requests and reconnect', () => {
    const confirmed: FlowerContextSample = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 71872, context_window_tokens: 950000 };
    const estimate: FlowerContextSample = { ...confirmed, phase: 'projected_request', input_tokens: 291336, updated_at_ms: 2 };
    const build = (snapshot: FlowerContextUsage) => buildFlowerComposerContextIndicatorView(snapshot, DEFAULT_FLOWER_SURFACE_COPY);
    expect(build({ estimate }).progressValue).toBeNull();
    const running = build({ confirmed, estimate });
    expect(running.ratioValue).toBe('8%');
    expect(running.warning).toBe('');
    expect(build(JSON.parse(JSON.stringify({ confirmed, estimate })))).toEqual(running);
    expect(build({ confirmed: { ...confirmed, input_tokens: 74312 } }).ratioValue).toBe('8%');
    const risk = build({ confirmed, estimate: { ...estimate, input_tokens: 960000, pressure_status: 'hard_limit' } });
    expect(risk.ratioValue).toBe('8%');
    expect(risk.tone).toBe('danger');
    expect(risk.warning).toBe('At limit');
    // Canonical invalidation clears old measurements on compaction/model changes.
    expect(build({}).progressValue).toBeNull();
    expect(build({ estimate: { ...estimate, input_tokens: 1000, context_window_tokens: 100000 } }).progressValue).toBeNull();
    expect(build({ confirmed: { ...confirmed, input_tokens: 1000, context_window_tokens: 100000 } }).ratioValue).toBe('1%');
  });

  it('maps all pressure statuses into stable UI tones', () => {
    expect(contextPressureTone('stable')).toBe('stable');
    expect(contextPressureTone('near_threshold')).toBe('warning');
    expect(contextPressureTone('will_compact')).toBe('warning');
    expect(contextPressureTone('hard_limit')).toBe('danger');
    expect(contextPressureTone('estimated')).toBe('estimated');
    expect(contextPressureTone('provider_custom')).toBe('stable');
  });

  it('formats token counts compactly without showing zero as a valid total', () => {
    expect(formatContextTokenCount(123)).toBe('123');
    expect(formatContextTokenCount(1234)).toBe('1.2k');
    expect(formatContextTokenCount(10_200)).toBe('10k');
    expect(formatContextTokenCount(1_250_000)).toBe('1.3M');
    expect(formatContextTokenCount(0)).toBe('');
  });

  it('labels compaction lifecycle states without deriving run lifecycle state', () => {
    expect(compactionDividerLabel(compaction({ status: 'compacting' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Compacting context');
    expect(compactionDividerLabel(compaction({ status: 'compacted' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Context compacted');
    expect(compactionDividerLabel(compaction({ status: 'failed' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Context compaction failed');
    expect(compactionDividerLabel(compaction({ status: 'cancelled' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Context compaction cancelled');
    expect(compactionDividerLabel(compaction({ status: 'noop' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Context does not need compression');
    expect(compactionDividerLabel(compaction({ status: 'checkpoint' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Context checkpoint');
  });

  it('prefers token deltas for compaction details and falls back to errors or reasons', () => {
    expect(compactionDividerDetail(compaction({
      tokens_before: 60_000,
      tokens_after_estimate: 488,
      error: 'ignored',
    }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('60k to 488');
    expect(compactionDividerDetail(compaction({
      tokens_before: undefined,
      tokens_after_estimate: undefined,
      error: 'summary failed',
      reason: 'threshold',
    }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('summary failed');
    expect(compactionDividerDetail(compaction({
      reason: 'threshold',
      trigger: 'pre_request',
    }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('threshold');
    expect(compactionDividerDetail(compaction({
      status: 'noop',
      reason: 'context_too_small',
      trigger: 'manual',
    }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('context_too_small');
  });
});
