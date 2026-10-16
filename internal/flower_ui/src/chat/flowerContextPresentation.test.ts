import { buildFlowerContextComposition } from './flowerContextPresentation';
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
  formatCacheHitPercent,
  cacheHitRatio,
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
      ariaLabel: 'Context window', ratioValue: '91%',
      cacheHitLabel: 'Session cache hit rate', cacheHitValue: '—', tone: 'warning',
      ratio: 0.91, progressValue: 91, warning: 'Near limit',
      ariaValueText: 'Context window: 91%, Latest request cache hit rate: Not available, Session cache hit rate: Not available, Near limit',
    });
  });

  it('uses confirmed tokens when the ratio is absent and distinguishes zero from unknown', () => {
    expect(contextUsagePercent(usage({ input_tokens: 500, context_window_tokens: 1000 }).confirmed!)).toBe(50);
    expect(contextUsagePercent(usage({ input_tokens: 0, context_window_tokens: 1000 }).confirmed!)).toBe(0);
    const unknown = buildFlowerComposerContextIndicatorView(usage(), DEFAULT_FLOWER_SURFACE_COPY);
    expect(unknown.progressValue).toBeNull();
    expect(unknown.ratioValue).toBe('—');
    expect(unknown.warning).toBe('');
    expect(unknown.ariaValueText).toBe('Context window: Not available, Latest request cache hit rate: Not available, Session cache hit rate: Not available');
  });

  it('localizes tooltip percentages and accessible usage', () => {
    const copy = { ...DEFAULT_FLOWER_SURFACE_COPY, chat: { ...DEFAULT_FLOWER_SURFACE_COPY.chat,
      contextIndicator: { ...DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator, percent: (percent: number) => `${percent}% 已用` },
    } };
    const view = buildFlowerComposerContextIndicatorView(usage({ input_tokens: 72000, context_window_tokens: 100000 }), copy);
    expect(view.ratioValue).toBe('72% 已用');
    expect(view.ariaValueText).toBe('Context window: 72% 已用, Latest request cache hit rate: Not available, Session cache hit rate: Not available');
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

    expect(cacheHitRatio(current.thread_usage)).toBe(0.45);
    expect(view.cacheHitValue).toBe('45%');
    expect(view.ariaValueText).toContain('Session cache hit rate: 45%');
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

    expect(cacheHitRatio(current.thread_usage)).toBeCloseTo(0.2642789722);
    expect(formatCacheHitPercent(current.thread_usage, 'Not available')).toBe('26%');
  });

  it('formats zero, exact, near-perfect, and unavailable cache hit rates honestly', () => {
    expect(formatCacheHitPercent(usage({
      thread_usage: { input_tokens: 100, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
    }).thread_usage, 'Not available')).toBe('0%');
    expect(formatCacheHitPercent(usage({
      thread_usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 100, cache_write_tokens: 0 },
    }).thread_usage, 'Not available')).toBe('100%');
    expect(formatCacheHitPercent(usage({
      thread_usage: { input_tokens: 1, output_tokens: 0, cache_read_tokens: 1999, cache_write_tokens: 0 },
    }).thread_usage, 'Not available')).toBe('99.95%');
    expect(formatCacheHitPercent(usage({
      thread_usage: { input_tokens: 0, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 },
    }).thread_usage, 'Not available')).toBe('Not available');
  });

  it('prefers confirmed usage and shows the installed estimate after invalidation', () => {
    const confirmed: FlowerContextSample = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 71872, context_window_tokens: 950000 };
    const estimate: FlowerContextSample = { ...confirmed, phase: 'projected_request', input_tokens: 291336, updated_at_ms: 2 };
    const build = (snapshot: FlowerContextUsage) => buildFlowerComposerContextIndicatorView(snapshot, DEFAULT_FLOWER_SURFACE_COPY);
    expect(build({ estimate }).progressValue).toBe(31);
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
    expect(build({ estimate: { ...estimate, input_tokens: 1000, context_window_tokens: 100000 } })).toMatchObject({ progressValue: 1, tone: 'estimated' });
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
    }), DEFAULT_FLOWER_SURFACE_COPY)).toBe(DEFAULT_FLOWER_SURFACE_COPY.chat.compactionContextTooSmall);
  });
});

 it('shows distinct latest and cumulative rates through the same formatter', () => {
  const view=buildFlowerComposerContextIndicatorView({recent_request_usage:{input_tokens:30,output_tokens:5,cache_read_tokens:60,cache_write_tokens:10},thread_usage:{input_tokens:80,output_tokens:20,cache_read_tokens:60,cache_write_tokens:10}},DEFAULT_FLOWER_SURFACE_COPY);
  expect(view.recentCacheHitValue).toBe('60%');expect(view.cacheHitValue).toBe('40%');
  expect(view.ariaValueText).toContain('Latest request cache hit rate: 60%');
  expect(buildFlowerComposerContextIndicatorView({recent_request_usage:{input_tokens:100,output_tokens:1,cache_read_tokens:0,cache_write_tokens:0}},DEFAULT_FLOWER_SURFACE_COPY).recentCacheHitValue).toBe('0%');
 });

describe('used context composition', () => {
  it('allocates the displayed input total using that same request distribution', () => {
    const base = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 10000 } as const;
    const result = buildFlowerContextComposition({ confirmed: { ...base, breakdown: { source: 'semantic_input_bpe_v1', tool_result_tokens: 300, user_tokens: 100 } },
      estimate: { ...base, phase: 'projected_request', breakdown: { source: 'next', tool_result_tokens: 90000 } } })!;
    expect(result.total).toBe(10000);
    expect(result.rows.map(({ key, tokens, share }) => ({ key, tokens, share }))).toEqual([{ key: 'tool_outputs', tokens: 7500, share: 75 }, { key: 'messages', tokens: 2500, share: 25 }]);
    expect(buildFlowerContextComposition({ confirmed: base, estimate: { ...base, breakdown: { source: 'next', user_tokens: 10 } } })).toBeNull();
    expect(buildFlowerContextComposition({ estimate: { ...base, breakdown: { source: 'empty' } } })).toBeNull();
  });
});


describe('request source attribution', () => {
  it('separates registry origins and managed sections without adding parent weights again', () => {
    const sample = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 1050 } as const;
    const result = buildFlowerContextComposition({ confirmed: { ...sample, breakdown: { source: 'semantic_input_bpe_v2',
      system_tokens: 100, tool_definition_tokens: 600, model_context_tokens: 240,
      user_tokens: 30, assistant_tokens: 20, tool_call_tokens: 10, tool_result_tokens: 50,
      details: { items: [
        { category: 'tool_definition', key: 'opaque', source: 'mcp', namespace: 'docs', tokens: 300 },
        { category: 'tool_definition', key: 'terminal.exec', source: 'builtin', tokens: 200 },
        { category: 'tool_definition', key: 'web_search', source: 'provider', tokens: 100 },
        { category: 'model_context', key: 'skills', tokens: 100 },
        { category: 'model_context', key: 'repository_rules', tokens: 70 },
        { category: 'model_context', key: 'execution_environment', tokens: 40 },
        { category: 'model_context', key: '', tokens: 30 },
      ] },
    } } })!;
    expect(result.total).toBe(1050);
    const rows = new Map(result.rows.map(row => [row.key, row]));
    expect(rows.get('mcp_tools')).toMatchObject({ tokens: 300, items: [{ label: 'docs · opaque', tokens: 300 }] });
    expect(rows.get('system_tools')?.tokens).toBe(200);
    expect(rows.get('provider_tools')?.tokens).toBe(100);
    expect(rows.get('messages')?.tokens).toBe(60);
    expect(rows.get('skills')?.tokens).toBe(100);
    expect(rows.get('rule_files')?.tokens).toBe(70);
    expect(rows.get('environment')?.tokens).toBe(40);
    expect(rows.get('context_framing')?.tokens).toBe(30);
    expect(result.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(100);
  });
  it('does not infer origins from names or allocate historical samples from current snapshots', () => {
    const base = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1 } as const;
    const current = buildFlowerContextComposition({ confirmed: { ...base, breakdown: { source: 'v2', tool_definition_tokens: 20,
      details: { items: [{ category: 'tool_definition', key: 'mcp_looks_external', tokens: 20 }] } } } })!;
    expect(current.rows[0].key).toBe('unattributed_tools');
    const old = buildFlowerContextComposition({ confirmed: { ...base, breakdown: { source: 'v1', model_context_tokens: 30 } } })!;
    expect(old.rows[0].key).toBe('unattributed_context');
  });
});


describe('distribution quality', () => {
  it('includes protocol formatting in shares without adding budget reserves to the total', () => {
    const result = buildFlowerContextComposition({ estimate: { phase: 'projected_request', pressure_status: 'stable', updated_at_ms: 1,
      input_tokens: 900, breakdown: { source: 'rendered', quality: 'token_estimate', tokenizer: 'deepseek_v4', user_tokens: 100, framing_tokens: 20 } } })!;
    expect(result.total).toBe(900);
    expect(result.showTokenAmounts).toBe(true);
    expect(result.rows.find(row => row.key === 'protocol_framing')?.tokens).toBe(150);
    expect(result.rows.find(row => row.key === 'protocol_framing')?.share).toBeCloseTo(100 / 6);
  });
  it('shows proportional amounts for unknown vocabularies, media and historical records', () => {
    for (const metadata of [{}, { quality: 'relative_weight' as const }, { quality: 'token_estimate' as const, tokenizer: 'deepseek_v4', attachment_tokens: 10 }]) {
      const result = buildFlowerContextComposition({ confirmed: { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1,
        input_tokens: 1100, breakdown: { source: 'recorded', user_tokens: 100, ...metadata } } })!;
      expect(result.showTokenAmounts).toBe(true);
      expect(result.total).toBe(1100);
      expect(result.rows.reduce((sum, row) => sum + row.tokens, 0)).toBe(1100);
      expect(result.historical).toBe(!metadata.quality);
    }
  });
  it('keeps rounded category and nested allocations additive without changing their shares', () => {
    const result = buildFlowerContextComposition({ confirmed: { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1,
      input_tokens: 7, breakdown: { source: 'rendered', system_tokens: 2, tool_definition_tokens: 3, user_tokens: 1,
        details: { items: [
          { category: 'tool_definition', key: 'first', source: 'mcp', tokens: 1 },
          { category: 'tool_definition', key: 'second', source: 'mcp', tokens: 1 },
          { category: 'tool_definition', key: 'third', source: 'mcp', tokens: 1 },
        ] } } } })!;
    expect(result.rows.map(row => [row.key, row.tokens])).toEqual([['mcp_tools', 4], ['system_prompt', 2], ['messages', 1]]);
    expect(result.rows.reduce((sum, row) => sum + row.tokens, 0)).toBe(7);
    const group = result.rows[0];
    expect(group.share).toBe(50);
    expect(group.items.map(item => item.tokens)).toEqual([1, 2, 1]);
    expect(group.items.reduce((sum, item) => sum + item.tokens, 0)).toBe(group.tokens);
    expect(group.items.every(item => Math.abs(item.share - 100 / 3) < 1e-10)).toBe(true);
  });
  it('shows zero amounts but keeps only shares when the displayed request total is unavailable', () => {
    const sample = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1,
      breakdown: { source: 'rendered', user_tokens: 2, system_tokens: 1 } } as const;
    const zero = buildFlowerContextComposition({ confirmed: { ...sample, input_tokens: 0 } })!;
    expect(zero.total).toBe(0);
    expect(zero.showTokenAmounts).toBe(true);
    expect(zero.rows.every(row => row.tokens === 0)).toBe(true);
    for (const input_tokens of [undefined, NaN, Infinity, -1]) {
      const unknown = buildFlowerContextComposition({ confirmed: { ...sample, input_tokens }, estimate: { ...sample, input_tokens: 100 } })!;
      expect(unknown.total).toBeNull();
      expect(unknown.showTokenAmounts).toBe(false);
      expect(unknown.rows[0].share).toBeCloseTo(200 / 3);
    }
    const estimate = buildFlowerContextComposition({ estimate: { ...sample, phase: 'projected_request', input_tokens: 300 } })!;
    expect(estimate.total).toBe(300);
    expect(estimate.rows[0].tokens).toBe(200);
  });
});
