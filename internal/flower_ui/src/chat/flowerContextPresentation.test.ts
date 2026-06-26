import { describe, expect, it } from 'vitest';

import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type { FlowerContextCompaction, FlowerContextUsage } from '../contracts/flowerSurfaceContracts';
import {
  buildFlowerComposerContextIndicatorView,
  compactionDividerDetail,
  compactionDividerLabel,
  contextPressureTone,
  contextUsagePercent,
  formatFullContextTokenCount,
  formatContextTokenCount,
} from './flowerContextPresentation';

function usage(overrides: Partial<FlowerContextUsage> = {}): FlowerContextUsage {
  return {
    phase: 'projected_request',
    pressure_status: 'stable',
    updated_at_ms: 1000,
    ...overrides,
  };
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
  it('builds percent and token detail from direct context usage ratios', () => {
    const view = buildFlowerComposerContextIndicatorView(usage({
      input_tokens: 182_000,
      context_window_tokens: 200_000,
      threshold_tokens: 180_000,
      request_safe_limit_tokens: 190_000,
      used_ratio: 0.91,
      threshold_ratio: 0.9,
      pressure_status: 'near_threshold',
    }), DEFAULT_FLOWER_SURFACE_COPY);

    expect(view).toMatchObject({
      ariaLabel: 'Context',
      percentLabel: '91%',
      usedValue: '182,000 of 200,000',
      thresholdValue: '180,000',
      safeLimitValue: '190,000',
      statusValue: 'Near limit',
      tone: 'warning',
      ratio: 0.91,
      progressValue: 91,
      ariaValueText: 'Context: 91%, 182,000 of 200,000',
    });
  });

  it('falls back to input over window tokens when used ratio is absent', () => {
    expect(contextUsagePercent(usage({
      input_tokens: 500,
      context_window_tokens: 1000,
      pressure_status: 'stable',
    }))).toBe(50);
  });

  it('keeps unknown ratios text-only instead of fabricating zero percent', () => {
    const view = buildFlowerComposerContextIndicatorView(usage({
      pressure_status: 'estimated',
    }), DEFAULT_FLOWER_SURFACE_COPY);

    expect(view.ratio).toBeNull();
    expect(view.progressValue).toBeNull();
    expect(view.percentLabel).toBe('--%');
    expect(view.usedValue).toBe('Not available');
    expect(view.statusValue).toBe('Estimated');
    expect(view.ariaValueText).toBe('Context: Estimated');
    expect(view.tone).toBe('estimated');
  });

  it('keeps the circular label compact while localizing tooltip ratio text', () => {
    const copy = {
      ...DEFAULT_FLOWER_SURFACE_COPY,
      chat: {
        ...DEFAULT_FLOWER_SURFACE_COPY.chat,
        contextIndicator: {
          ...DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator,
          percent: (percent: number) => `${percent}% 已用`,
        },
      },
    };
    const view = buildFlowerComposerContextIndicatorView(usage({
      input_tokens: 72_000,
      context_window_tokens: 100_000,
      used_ratio: 0.72,
      pressure_status: 'stable',
    }), copy);

    expect(view.percentLabel).toBe('72%');
    expect(view.ratioValue).toBe('72% 已用');
    expect(view.ariaValueText).toBe('Context: 72% 已用, 72,000 of 100,000');
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
    expect(formatFullContextTokenCount(182_000)).toBe('182,000');
    expect(formatFullContextTokenCount(0)).toBe('');
  });

  it('labels compaction lifecycle states without deriving run lifecycle state', () => {
    expect(compactionDividerLabel(compaction({ status: 'compacting' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Compacting context');
    expect(compactionDividerLabel(compaction({ status: 'compacted' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Context compacted');
    expect(compactionDividerLabel(compaction({ status: 'failed' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Context compaction failed');
    expect(compactionDividerLabel(compaction({ status: 'cancelled' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Context compaction cancelled');
    expect(compactionDividerLabel(compaction({ status: 'provider_custom' as 'compacted' }), DEFAULT_FLOWER_SURFACE_COPY)).toBe('Context checkpoint');
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
  });
});
