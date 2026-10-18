import type { FlowerContextCompaction, FlowerContextUsage, FlowerContextSample, FlowerThreadTokenUsage, FlowerContextCategory } from '../contracts/flowerSurfaceContracts';
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
  if (!sample?.available || input === undefined || !Number.isFinite(input) || input < 0
    || capacity === undefined || !Number.isFinite(capacity) || capacity <= 0) return null;
  const used = Math.min(input, capacity);
  return {
    input,
    capacity,
    estimated: !sample.measured,
    segments: [
      { key: 'input' as const, tokens: input },
      { key: 'freeSpace' as const, tokens: capacity - used },
    ].map((segment) => ({ ...segment, share: Math.min(1, segment.tokens / capacity) * 100 })),
  };
}

export const FLOWER_CONTEXT_SOURCES = [
  'system_prompt', 'system_tools', 'mcp_tools', 'provider_tools', 'messages',
  'tool_outputs', 'skills', 'rule_files', 'environment', 'summary', 'reasoning',
  'attachments', 'protocol_framing', 'context_framing', 'unattributed_tools', 'unattributed_context', 'unattributed_usage',
] as const;
export type FlowerContextSource = typeof FLOWER_CONTEXT_SOURCES[number];
export type FlowerContextSourceRow = { key: FlowerContextSource; tokens: number; share: number;
  items: { key: string; label?: string; category?: FlowerContextCategory; tokens: number; share: number }[] };

// Attribution always belongs to the displayed request. Current snapshot text
// and newer projected requests cannot be used to allocate confirmed usage.
export function buildFlowerContextComposition(usage: FlowerContextUsage) {
  const sample = usage.confirmed ?? usage.estimate;
  const breakdown = sample?.breakdown;
  if (!sample?.available || !sample.breakdown_available || !breakdown?.source) return null;
  const rows = new Map<FlowerContextSource, FlowerContextSourceRow>();
  const add = (key: FlowerContextSource, tokens: number, item?: Omit<FlowerContextSourceRow['items'][number], 'share'>) => {
    if (!Number.isSafeInteger(tokens) || tokens <= 0) return;
    const row = rows.get(key) ?? { key, tokens: 0, share: 0, items: [] };
    row.tokens += tokens;
    if (item) row.items.push({ ...item, share: 0 });
    rows.set(key, row);
  };
  add('system_prompt', breakdown.system_tokens ?? 0);
  for (const category of ['user_tokens', 'assistant_tokens', 'tool_call_tokens'] as const) {
    const tokens = breakdown[category] ?? 0;
    add('messages', tokens, { key: category, category, tokens });
  }
  add('tool_outputs', breakdown.tool_result_tokens ?? 0);
  add('summary', breakdown.compaction_tokens ?? 0);
  add('reasoning', breakdown.reasoning_tokens ?? 0);
  add('attachments', breakdown.attachment_tokens ?? 0);
  add('protocol_framing', breakdown.framing_tokens ?? 0);
  if (breakdown.details) {
    for (const item of breakdown.details.items) {
      if (item.category === 'tool_definition') {
        const source = item.source === 'mcp' ? 'mcp_tools'
          : item.source === 'provider' ? 'provider_tools'
          : item.source === 'builtin' || item.source === 'floret' ? 'system_tools' : 'unattributed_tools';
        add(source, item.tokens, { key: JSON.stringify([item.key, item.source, item.namespace]),
          label: item.namespace ? item.namespace + ' · ' + item.key : item.key, tokens: item.tokens });
      } else {
        const source = item.key === 'skills' ? 'skills' : item.key === 'repository_rules' ? 'rule_files'
          : ['execution_environment', 'local_time', 'repository', 'delegation'].includes(item.key) ? 'environment' : item.key ? 'unattributed_context' : 'context_framing';
        add(source, item.tokens, { key: item.key, label: item.key || undefined, tokens: item.tokens });
      }
    }
  } else {
    add('unattributed_tools', breakdown.tool_definition_tokens ?? 0);
    add('unattributed_context', breakdown.model_context_tokens ?? 0);
  }
  add('unattributed_usage', sample.unattributed_tokens ?? 0);
  const total = sample.input_tokens ?? 0;
  const ordered = [...rows.values()].sort((a, b) => b.tokens - a.tokens || FLOWER_CONTEXT_SOURCES.indexOf(a.key) - FLOWER_CONTEXT_SOURCES.indexOf(b.key));
  for (const row of ordered) {
    row.share = total > 0 ? row.tokens / total * 100 : 0;
    row.items.sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
    for (const item of row.items) item.share = row.tokens > 0 ? item.tokens / row.tokens * 100 : 0;
  }
  return { total, rows: ordered };
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
  if (!usage.available) return null;
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
  const pressureWarning = (() => {
    switch (pressure?.pressure_status) {
      case 'near_threshold': return labels.nearThreshold;
      case 'will_compact': return labels.willCompact;
      case 'hard_limit': return labels.hardLimit;
      default: return '';
    }
  })();
  const warning = pressureWarning && pressure !== sample ? labels.currentRequest + ': ' + pressureWarning : pressureWarning;
  const cacheHitValue = formatCacheHitPercent(usage.thread_usage, labels.unknownPercent);
  const recentCacheHitValue = formatCacheHitPercent(usage.recent_request_usage, labels.unknownPercent);
  const accessibleRecentCache = formatCacheHitPercent(usage.recent_request_usage, labels.unavailable);
  const accessibleUsage = progressValue === null ? labels.unavailable : ratioValue;
  const accessibleCache = formatCacheHitPercent(usage.thread_usage, labels.unavailable);
  return {
    ariaLabel: labels.label,
    ariaValueText: `${labels.label}: ${sample?.available && sample.input_tokens !== undefined ? (sample.measured ? "= " + labels.measured : "≈ " + labels.estimated) + ", " + (sample.measured ? labels.lastRequest : labels.currentRequest) + ", " : ""}${accessibleUsage}, ${labels.recentCacheHitLabel}: ${accessibleRecentCache}, ${labels.cacheHitLabel}: ${accessibleCache}${warning ? `, ${warning}` : ''}`,
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
