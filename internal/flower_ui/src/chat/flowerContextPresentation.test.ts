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
  return { confirmed: { available: true, measured: true, phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1000, ...sample }, thread_usage };
}

function compaction(overrides: Partial<FlowerContextCompaction> = {}): FlowerContextCompaction {
  return {
    operation_id: 'compact-1', turn_id: 'turn-1', canonical_ordinal: 1,
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
      ariaLabel: 'Request input (tokens)', ratioValue: '91%',
      cacheHitLabel: 'Session cache hit rate', cacheHitValue: '—', tone: 'warning',
      ratio: 0.91, progressValue: 91, warning: 'Near limit',
      ariaValueText: 'Request input (tokens): = 182000 tokens, Measured, Last request, 91%, Latest request cache hit rate: Not available, Session cache hit rate: Not available, Near limit',
    });
  });

  it('uses confirmed tokens when the ratio is absent and distinguishes zero from unknown', () => {
    expect(contextUsagePercent(usage({ input_tokens: 500, context_window_tokens: 1000 }).confirmed!)).toBe(50);
    expect(contextUsagePercent(usage({ input_tokens: 0, context_window_tokens: 1000 }).confirmed!)).toBe(0);
    const unknown = buildFlowerComposerContextIndicatorView(usage(), DEFAULT_FLOWER_SURFACE_COPY);
    expect(unknown.progressValue).toBeNull();
    expect(unknown.ratioValue).toBe('—');
    expect(unknown.warning).toBe('');
    expect(unknown.ariaValueText).toBe('Request input (tokens): Not available, Latest request cache hit rate: Not available, Session cache hit rate: Not available');
  });

  it('localizes tooltip percentages and accessible usage', () => {
    const copy = { ...DEFAULT_FLOWER_SURFACE_COPY, chat: { ...DEFAULT_FLOWER_SURFACE_COPY.chat,
      contextIndicator: { ...DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator, percent: (percent: number) => `${percent}% 已用` },
    } };
    const view = buildFlowerComposerContextIndicatorView(usage({ input_tokens: 72000, context_window_tokens: 100000 }), copy);
    expect(view.ratioValue).toBe('72% 已用');
    expect(view.ariaValueText).toBe('Request input (tokens): = 72000 tokens, Measured, Last request, 72% 已用, Latest request cache hit rate: Not available, Session cache hit rate: Not available');
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

  it('shows confirmed usage and waits for another confirmation after invalidation', () => {
    const confirmed: FlowerContextSample = { available: true, measured: true, phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 71872, context_window_tokens: 950000 };
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
    expect(risk.warning).toBe('Current request: At limit');
    // Canonical invalidation clears old measurements on compaction/model changes.
    expect(build({}).progressValue).toBeNull();
    expect(build({ estimate: { ...estimate, input_tokens: 1000, context_window_tokens: 100000 } })).toMatchObject({ progressValue: null, tone: 'estimated' });
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
    }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Estimated message context: 60k to 488 tokens. Excludes system instructions and tool definitions.');
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

  it.each(['failed', 'cancelled', 'compacting'] as const)('does not describe %s as successful compression', (status) => {
    expect(compactionDividerDetail(compaction({ status, tokens_before: 159143, tokens_after_estimate: 17462, error: 'summary unavailable' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('summary unavailable');
  });
});

 it('shows distinct latest and cumulative rates through the same formatter', () => {
  const view=buildFlowerComposerContextIndicatorView({confirmed:{available:true,measured:true,phase:'provider_usage',pressure_status:'stable',input_tokens:100,updated_at_ms:1},recent_request_usage:{input_tokens:30,output_tokens:5,cache_read_tokens:60,cache_write_tokens:10},thread_usage:{input_tokens:80,output_tokens:20,cache_read_tokens:60,cache_write_tokens:10}},DEFAULT_FLOWER_SURFACE_COPY);
  expect(view.recentCacheHitValue).toBe('60%');expect(view.cacheHitValue).toBe('40%');
  expect(view.ariaValueText).toContain('Latest request cache hit rate: 60%');
  expect(buildFlowerComposerContextIndicatorView({confirmed:{available:true,measured:true,phase:'provider_usage',pressure_status:'stable',input_tokens:100,updated_at_ms:1},recent_request_usage:{input_tokens:100,output_tokens:1,cache_read_tokens:0,cache_write_tokens:0}},DEFAULT_FLOWER_SURFACE_COPY).recentCacheHitValue).toBe('0%');
 });

describe('request source attribution', () => {
  it('groups released category values without scaling parents or children', () => {
    const confirmed: FlowerContextSample = { available:true, measured:true, characters_available:true,
      phase:'provider_usage', pressure_status:'stable', updated_at_ms:1, input_tokens:1100,
      characters: { source: 'prepared_characters_v1', unit: 'unicode_code_points', total_characters: (100)+(600)+(240)+(30)+(20)+(10)+(50), categories: [{ category: 'system', characters: 100 },{ category: 'tool_definition', characters: 600, details: [{ key:'opaque',source:'mcp',namespace:'docs',characters:300 },{ key:'terminal.exec',source:'builtin',characters:200 },{ key:'web_search',source:'provider',characters:100 }] },{ category: 'model_context', characters: 240, details: [{ key:'skills',characters:100 },{ key:'repository_rules',characters:70 },{ key:'execution_environment',characters:40 },{ key:'',characters:30 }] },{ category: 'user', characters: 30 },{ category: 'assistant', characters: 20 },{ category: 'tool_call', characters: 10 },{ category: 'tool_result', characters: 50 }] },
    };
    const result = buildFlowerContextComposition({confirmed})!;
    const rows = new Map(result.rows.map(row => [row.key,row]));
    expect(rows.get('mcp_tools')).toMatchObject({characters:300,items:[{label:'docs · opaque',characters:300}]});
    expect(rows.get('system_tools')?.characters).toBe(200);
    expect(rows.get('provider_tools')?.characters).toBe(100);
    expect(rows.get('messages')?.characters).toBe(60);
    expect(rows.get('skills')?.characters).toBe(100);
    expect(rows.get('rule_files')?.characters).toBe(70);
    expect(rows.get('environment')).toMatchObject({characters:40,items:[{key:'execution_environment',characters:40}]});
    expect(rows.get('context_framing')?.characters).toBe(30);
    expect(result.rows.reduce((sum,row)=>sum+row.characters,0)).toBe(1050);
    expect(result.rows.reduce((sum,row)=>sum+row.share,0)).toBeCloseTo(100);
  });
  it('only renders upstream-approved attribution and never borrows from a newer request', () => {
    const base: FlowerContextSample = {available:true,measured:true,phase:'provider_usage',pressure_status:'stable',updated_at_ms:1,input_tokens:100};
    const estimate: FlowerContextSample = {...base,characters_available:true,characters: { source: 'prepared_characters_v1', unit: 'unicode_code_points', total_characters: (100), categories: [{ category: 'user', characters: 100 }] }};
    expect(buildFlowerContextComposition({confirmed:base,estimate})).toBeNull();
    expect(buildFlowerContextComposition({confirmed:{...base,characters_available:false,characters: undefined}})).toBeNull();
  });
});
