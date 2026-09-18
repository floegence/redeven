import type { FlowerContextCompaction, FlowerContextUsage, FlowerContextSample } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import { trimString } from '../flowerSurfaceModel';

export type FlowerContextTone = 'stable' | 'warning' | 'danger' | 'estimated';
export type FlowerComposerContextIndicatorView = Readonly<{
  ariaLabel: string;
  ariaValueText: string;
  percentLabel: string;
  ratioValue: string;
  tone: FlowerContextTone;
  ratio: number | null;
  progressValue: number | null;
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

function formatCompactContextPercent(percent: number): string {
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

export function threadCacheHitRatio(usage: FlowerContextUsage): number | null {
  const totals = usage.thread_usage;
  if (!totals) return null;
  const input = Number(totals.input_tokens);
  const cacheRead = Number(totals.cache_read_tokens);
  const cacheWrite = Number(totals.cache_write_tokens);
  if (![input, cacheRead, cacheWrite].every((value) => Number.isFinite(value) && value >= 0)) return null;
  const totalInput = input + cacheRead + cacheWrite;
  if (totalInput <= 0) return null;
  return Math.max(0, Math.min(1, cacheRead / totalInput));
}

export function formatThreadCacheHitPercent(usage: FlowerContextUsage, unavailable: string): string {
  const ratio = threadCacheHitRatio(usage);
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
  // An estimate can exceed the next native measurement. Show only confirmed
  // input so switching measurement sources never makes usage jump backwards.
  const ratio = usage.confirmed ? contextUsageRatio(usage.confirmed) : null;
  const progressValue = ratio === null ? null : Math.round(ratio * 100);
  const percentLabel = progressValue === null ? labels.unknownPercent : formatCompactContextPercent(progressValue);
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
  const cacheHitValue = formatThreadCacheHitPercent(usage, labels.unknownPercent);
  const accessibleUsage = progressValue === null ? labels.unavailable : ratioValue;
  const accessibleCache = formatThreadCacheHitPercent(usage, labels.unavailable);
  return {
    ariaLabel: labels.label,
    ariaValueText: `${labels.label}: ${accessibleUsage}, ${labels.cacheHitLabel}: ${accessibleCache}${warning ? `, ${warning}` : ''}`,
    percentLabel,
    ratioValue,
    tone: contextPressureTone(pressure?.pressure_status ?? 'estimated'),
    ratio,
    progressValue,
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
  const before = formatContextTokenCount(compaction.tokens_before);
  const after = formatContextTokenCount(compaction.tokens_after_estimate);
  const labels = copy.chat.compactionDivider ?? DEFAULT_FLOWER_SURFACE_COPY.chat.compactionDivider;
  if (before && after) return labels.tokenChange(before, after);
  return trimString(compaction.error) || trimString(compaction.reason) || trimString(compaction.trigger);
}
