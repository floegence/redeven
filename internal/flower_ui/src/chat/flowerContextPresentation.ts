import { FLOWER_CONTEXT_CATEGORIES } from '../contracts/flowerSurfaceContracts';
import type { FlowerContextCompaction, FlowerContextUsage, FlowerContextSample, FlowerModelContext, FlowerThreadTokenUsage } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import { trimString } from '../flowerSurfaceModel';

export type FlowerContextTone = 'stable' | 'warning' | 'danger' | 'estimated';

export function formatContextAmount(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return String(value);
}

export function buildFlowerContextWindow(usage: FlowerContextUsage) {
  const sample = usage.confirmed ?? usage.estimate;
  const input = sample?.input_tokens;
  const capacity = sample?.context_window_tokens;
  if (input === undefined || !Number.isFinite(input) || input < 0
    || capacity === undefined || !Number.isFinite(capacity) || capacity <= 0) return null;
  const used = Math.min(input, capacity);
  const headroom = sample?.output_headroom_tokens ?? 0;
  const reserved = Number.isFinite(headroom) ? Math.min(Math.max(0, headroom), capacity - used) : 0;
  return {
    input,
    capacity,
    estimated: !usage.confirmed,
    segments: [
      { key: 'input' as const, tokens: input },
      ...(reserved > 0 ? [{ key: 'outputReserve' as const, tokens: reserved }] : []),
      { key: 'freeSpace' as const, tokens: capacity - used - reserved },
    ].map((segment) => ({ ...segment, share: Math.min(1, segment.tokens / capacity) * 100 })),
  };
}

// Composition belongs to the same request as the displayed total. Never
// substitute a newer request's categories or auto-loaded character counts.
export function buildFlowerContextComposition(usage: FlowerContextUsage) {
  const breakdown = (usage.confirmed ?? usage.estimate)?.breakdown;
  if (!breakdown?.source) return null;
  const rows = FLOWER_CONTEXT_CATEGORIES.map(key => ({ key, tokens: breakdown[key] ?? 0 }))
    .filter(row => Number.isSafeInteger(row.tokens) && row.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  return { total, rows: rows.map(row => ({ ...row, share: row.tokens / total * 100 })) };
}

// Snapshot text has character counts, not request-scoped token measurements.
export function buildFlowerModelContextDistribution(sections: FlowerModelContext['snapshot']['sections']) {
  const rows = sections.map(section => {
    let characters = 0;
    for (let index = 0; index < section.text.length; characters++) {
      index += section.text.codePointAt(index)! > 0xffff ? 2 : 1;
    }
    return { ...section, characters };
  }).sort((a, b) => b.characters - a.characters);
  const total = rows.reduce((sum, row) => sum + row.characters, 0);
  return { total, rows: rows.map(row => ({ ...row, share: total > 0 ? row.characters / total * 100 : 0 })) };
}

export type FlowerComposerContextIndicatorView = Readonly<{
  ariaLabel: string;
  ariaValueText: string;
  ratioValue: string;
  tone: FlowerContextTone;
  ratio: number | null;
  progressValue: number | null;
  recentCacheHitLabel: string;
  recentCacheHitValue: string;
  cacheHitLabel: string;
  cacheHitValue: string;
  warning: string;
}>;

export function formatContextTokenCount(tokens: number | undefined): string {
  const value = Math.max(0, Math.floor(Number(tokens ?? 0)));
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

export function contextUsageRatio(usage: FlowerContextSample): number | null {
  const direct = Number(usage.used_ratio);
  if (Number.isFinite(direct) && direct >= 0) return Math.min(1, direct);
  const input = Number(usage.input_tokens);
  const windowTokens = Number(usage.context_window_tokens ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(windowTokens) || input < 0 || windowTokens <= 0) return null;
  return Math.min(1, input / windowTokens);
}

export function contextUsagePercent(usage: FlowerContextSample): number | null {
  const ratio = contextUsageRatio(usage);
  return ratio === null ? null : Math.max(0, Math.round(ratio * 100));
}

export function contextPressureTone(pressure: string): FlowerContextTone {
  switch (trimString(pressure)) {
    case 'near_threshold':
    case 'will_compact':
      return 'warning';
    case 'hard_limit':
      return 'danger';
    case 'estimated':
      return 'estimated';
    default:
      return 'stable';
  }
}

export function cacheHitRatio(totals: FlowerThreadTokenUsage | undefined): number | null {
  if (!totals) return null;
  const input = Number(totals.input_tokens);
  const cacheRead = Number(totals.cache_read_tokens);
  const cacheWrite = Number(totals.cache_write_tokens);
  if (![input, cacheRead, cacheWrite].every((value) => Number.isFinite(value) && value >= 0)) return null;
  const totalInput = input + cacheRead + cacheWrite;
  if (!Number.isFinite(totalInput) || totalInput <= 0) return null;
  return Math.max(0, Math.min(1, cacheRead / totalInput));
}

export function formatCacheHitPercent(totals: FlowerThreadTokenUsage | undefined, unavailable: string): string {
  const ratio = cacheHitRatio(totals);
  if (ratio === null) return unavailable;
  const percent = ratio * 100;
  if (percent === 100) return '100%';
  if (Math.round(percent) < 100) return `${Math.round(percent)}%`;
  const digits = percent >= 99.9 ? 2 : 1;
  const factor = 10 ** digits;
  const bounded = Math.floor((percent + Number.EPSILON) * factor) / factor;
  return `${bounded.toFixed(digits).replace(/\.0+$/, '')}%`;
}

export function buildFlowerComposerContextIndicatorView(
  usage: FlowerContextUsage,
  copy: FlowerSurfaceCopy,
): FlowerComposerContextIndicatorView {
  const labels = copy.chat.contextIndicator ?? DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator;
  // Native usage remains preferred. Compaction invalidates that sample, so its
  // installed estimate is the current measurement until the next normal request.
  const sample = usage.confirmed ?? usage.estimate;
  const ratio = sample ? contextUsageRatio(sample) : null;
  const progressValue = ratio === null ? null : Math.round(ratio * 100);
  const ratioValue = progressValue === null ? labels.unknownPercent : labels.percent(progressValue);
  const pressure = usage.estimate ?? usage.confirmed;
  const warning = (() => {
    switch (pressure?.pressure_status) {
      case 'near_threshold': return labels.nearThreshold;
      case 'will_compact': return labels.willCompact;
      case 'hard_limit': return labels.hardLimit;
      default: return '';
    }
  })();
  const cacheHitValue = formatCacheHitPercent(usage.thread_usage, labels.unknownPercent);
  const recentCacheHitValue = formatCacheHitPercent(usage.recent_request_usage, labels.unknownPercent);
  const accessibleRecentCache = formatCacheHitPercent(usage.recent_request_usage, labels.unavailable);
  const accessibleUsage = progressValue === null ? labels.unavailable : ratioValue;
  const accessibleCache = formatCacheHitPercent(usage.thread_usage, labels.unavailable);
  return {
    ariaLabel: labels.label,
    ariaValueText: `${labels.label}: ${accessibleUsage}, ${labels.recentCacheHitLabel}: ${accessibleRecentCache}, ${labels.cacheHitLabel}: ${accessibleCache}${warning ? `, ${warning}` : ''}`,
    ratioValue,
    tone: usage.confirmed ? contextPressureTone(pressure?.pressure_status ?? 'estimated') : 'estimated',
    ratio,
    progressValue,
    recentCacheHitLabel: labels.recentCacheHitLabel,
    recentCacheHitValue,
    cacheHitLabel: labels.cacheHitLabel,
    cacheHitValue,
    warning,
  };
}

export function compactionDividerLabel(compaction: FlowerContextCompaction, copy: FlowerSurfaceCopy): string {
  const labels = copy.chat.compactionDivider ?? DEFAULT_FLOWER_SURFACE_COPY.chat.compactionDivider;
  const fallback = DEFAULT_FLOWER_SURFACE_COPY.chat.compactionDivider;
  switch (trimString(compaction.status)) {
    case 'compacting':
      return trimString(labels.compacting) || fallback.compacting;
    case 'compacted':
      return trimString(labels.compacted) || fallback.compacted;
    case 'failed':
      return trimString(labels.failed) || fallback.failed;
    case 'cancelled':
      return trimString(labels.cancelled) || fallback.cancelled;
    case 'noop':
      return trimString(labels.noop) || fallback.noop;
    default:
      return trimString(labels.fallback) || fallback.fallback;
  }
}

export function compactionDividerDetail(compaction: FlowerContextCompaction, copy: FlowerSurfaceCopy): string {
  if (compaction.status === 'noop') {
    switch (compaction.reason) {
      case 'context_too_small': return copy.chat.compactionContextTooSmall;
      case 'no_compactable_context': return copy.chat.compactionNoCompleteHistory;
      case 'insufficient_savings': return copy.chat.compactionNoSavings;
    }
  }
  const before = formatContextTokenCount(compaction.tokens_before);
  const after = formatContextTokenCount(compaction.tokens_after_estimate);
  const labels = copy.chat.compactionDivider ?? DEFAULT_FLOWER_SURFACE_COPY.chat.compactionDivider;
  if (before && after) return labels.tokenChange(before, after);
  return trimString(compaction.error) || trimString(compaction.reason) || trimString(compaction.trigger);
}
