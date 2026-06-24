import type { FlowerContextCompaction, FlowerContextUsage } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import { trimString } from '../flowerSurfaceModel';

export type FlowerContextTone = 'stable' | 'warning' | 'danger' | 'estimated';

export type FlowerContextMeterView = Readonly<{
  label: string;
  percentLabel: string;
  detailLabel: string;
  pressureLabel: string;
  tone: FlowerContextTone;
  ratio: number | null;
  progressValue: number | null;
  title: string;
  updatedAtMs: number;
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
  const labels = copy.chat.contextMeter ?? DEFAULT_FLOWER_SURFACE_COPY.chat.contextMeter;
  const fallback = DEFAULT_FLOWER_SURFACE_COPY.chat.contextMeter;
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

export function buildFlowerContextMeterView(usage: FlowerContextUsage, copy: FlowerSurfaceCopy): FlowerContextMeterView {
  const labels = copy.chat.contextMeter ?? DEFAULT_FLOWER_SURFACE_COPY.chat.contextMeter;
  const fallback = DEFAULT_FLOWER_SURFACE_COPY.chat.contextMeter;
  const label = trimString(labels.label) || fallback.label;
  const pressureLabel = contextPressureLabel(usage.pressure_status, copy);
  const ratio = contextUsageRatio(usage);
  const progressValue = ratio === null ? null : Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const percentLabel = progressValue === null ? '' : labels.percent(progressValue);
  const used = formatContextTokenCount(usage.input_tokens);
  const total = formatContextTokenCount(usage.context_window_tokens);
  const detailLabel = used && total ? labels.usage(used, total) : pressureLabel;
  return {
    label,
    percentLabel,
    detailLabel,
    pressureLabel,
    tone: contextPressureTone(usage.pressure_status),
    ratio,
    progressValue,
    title: `${label}: ${detailLabel}`,
    updatedAtMs: Math.max(0, Math.floor(Number(usage.updated_at_ms ?? 0))),
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
