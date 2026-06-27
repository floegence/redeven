import type { FlowerContextCompaction, FlowerContextUsage } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import { trimString } from '../flowerSurfaceModel';

export type FlowerContextTone = 'stable' | 'warning' | 'danger' | 'estimated';

export type FlowerComposerContextIndicatorView = Readonly<{
  ariaLabel: string;
  ariaValueText: string;
  percentLabel: string;
  tone: FlowerContextTone;
  ratio: number | null;
  progressValue: number | null;
  tooltipTitle: string;
  usedLabel: string;
  usedValue: string;
  ratioLabel: string;
  ratioValue: string;
  thresholdLabel: string;
  thresholdValue: string;
  safeLimitLabel: string;
  safeLimitValue: string;
  statusLabel: string;
  statusValue: string;
}>;

export function formatContextTokenCount(tokens: number | undefined): string {
  const value = Math.max(0, Math.floor(Number(tokens ?? 0)));
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

export function contextUsageRatio(usage: FlowerContextUsage): number | null {
  const direct = Number(usage.used_ratio);
  if (Number.isFinite(direct) && direct >= 0) return Math.min(1, direct);
  const input = Number(usage.input_tokens ?? 0);
  const windowTokens = Number(usage.context_window_tokens ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(windowTokens) || input <= 0 || windowTokens <= 0) return null;
  return Math.min(1, input / windowTokens);
}

export function contextUsagePercent(usage: FlowerContextUsage): number | null {
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

export function contextPressureLabel(pressure: string, copy: FlowerSurfaceCopy): string {
  const labels = copy.chat.contextIndicator ?? DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator;
  const fallback = DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator;
  switch (trimString(pressure)) {
    case 'stable':
      return trimString(labels.stable) || fallback.stable;
    case 'near_threshold':
      return trimString(labels.nearThreshold) || fallback.nearThreshold;
    case 'will_compact':
      return trimString(labels.willCompact) || fallback.willCompact;
    case 'hard_limit':
      return trimString(labels.hardLimit) || fallback.hardLimit;
    case 'estimated':
      return trimString(labels.estimated) || fallback.estimated;
    default:
      return trimString(labels.unknown) || fallback.unknown;
  }
}

export function formatFullContextTokenCount(tokens: number | undefined): string {
  const value = Math.max(0, Math.floor(Number(tokens ?? 0)));
  if (!Number.isFinite(value) || value <= 0) return '';
  return value.toLocaleString('en-US');
}

function formatCompactContextPercent(percent: number): string {
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

export function buildFlowerComposerContextIndicatorView(usage: FlowerContextUsage, copy: FlowerSurfaceCopy): FlowerComposerContextIndicatorView {
  const labels = copy.chat.contextIndicator ?? DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator;
  const fallback = DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator;
  const label = trimString(labels.label) || fallback.label;
  const statusValue = contextPressureLabel(usage.pressure_status, copy);
  const ratio = contextUsageRatio(usage);
  const progressValue = ratio === null ? null : Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const unknownPercent = trimString(labels.unknownPercent) || fallback.unknownPercent;
  const percentLabel = progressValue === null ? unknownPercent : formatCompactContextPercent(progressValue);
  const ratioValue = progressValue === null ? unknownPercent : labels.percent(progressValue);
  const used = formatFullContextTokenCount(usage.input_tokens);
  const total = formatFullContextTokenCount(usage.context_window_tokens);
  const threshold = formatFullContextTokenCount(usage.threshold_tokens);
  const safeLimit = formatFullContextTokenCount(usage.request_safe_limit_tokens);
  const usedValue = used && total ? labels.usage(used, total) : trimString(labels.unavailable) || fallback.unavailable;
  const ariaValueText = progressValue === null
    ? `${label}: ${statusValue}`
    : `${label}: ${ratioValue}, ${usedValue}`;
  return {
    ariaLabel: label,
    ariaValueText,
    percentLabel,
    tone: contextPressureTone(usage.pressure_status),
    ratio,
    progressValue,
    tooltipTitle: label,
    usedLabel: trimString(labels.usedLabel) || fallback.usedLabel,
    usedValue,
    ratioLabel: trimString(labels.ratioLabel) || fallback.ratioLabel,
    ratioValue,
    thresholdLabel: trimString(labels.thresholdLabel) || fallback.thresholdLabel,
    thresholdValue: threshold,
    safeLimitLabel: trimString(labels.safeLimitLabel) || fallback.safeLimitLabel,
    safeLimitValue: safeLimit,
    statusLabel: trimString(labels.statusLabel) || fallback.statusLabel,
    statusValue,
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
