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
  const sample = usage.confirmed;
  const input = sample?.input_tokens;
  if (!sample?.available || !sample.measured || input === undefined || !Number.isSafeInteger(input) || input < 0) return null;
  const capacity = sample.context_window_tokens && sample.context_window_tokens > 0 ? sample.context_window_tokens : null;
  return { input, capacity, share: capacity ? Math.min(1, input / capacity) * 100 : 0 };
}

export const FLOWER_CONTEXT_SOURCES = [
  'system_prompt', 'system_tools', 'mcp_tools', 'provider_tools', 'messages',
  'tool_outputs', 'skills', 'rule_files', 'environment', 'summary', 'reasoning',
  'hosted_context', 'context_framing', 'unattributed_tools', 'unattributed_context', 'unlabelled',
] as const;
export type FlowerContextSource = typeof FLOWER_CONTEXT_SOURCES[number];
export type FlowerContextSourceRow = { key: FlowerContextSource; characters: number; share: number;
  items: { key: string; label?: string; category?: FlowerContextCategory; characters: number; share: number }[] };

// Only the confirmed frozen request owns visible-input distribution. Characters
// never participate in token accounting, pressure, or native-usage reconciliation.
export function buildFlowerContextComposition(usage: FlowerContextUsage) {
  const sample = usage.confirmed;
  const breakdown = sample?.characters;
  if (!sample?.available || !sample.measured || !sample.characters_available || !breakdown) return null;
  const rows = new Map<FlowerContextSource, FlowerContextSourceRow>();
  const add = (key: FlowerContextSource, characters: number, item?: Omit<FlowerContextSourceRow['items'][number], 'share'>) => {
    if (characters <= 0) return;
    const row = rows.get(key) ?? { key, characters: 0, share: 0, items: [] };
    row.characters += characters;
    if (item) row.items.push({ ...item, share: 0 });
    rows.set(key, row);
  };
  for (const category of breakdown.categories) {
    const characters = category.characters;
    switch (category.category) {
      case 'tool_definition':
      case 'model_context': {
        if (!category.details?.length) {
          add(category.category === 'tool_definition' ? 'unattributed_tools' : 'unattributed_context', characters);
          break;
        }
        for (const item of category.details) {
          const source = category.category === 'tool_definition'
            ? item.source === 'mcp' ? 'mcp_tools' : item.source === 'provider' ? 'provider_tools'
              : item.source === 'builtin' || item.source === 'floret' ? 'system_tools' : 'unattributed_tools'
            : item.key === 'skills' ? 'skills' : item.key === 'repository_rules' ? 'rule_files'
              : ['execution_environment', 'local_time', 'repository', 'delegation'].includes(item.key) ? 'environment'
                : item.key ? 'unattributed_context' : 'context_framing';
          add(source, item.characters, { key: category.category === 'model_context' ? item.key : JSON.stringify([item.key, item.source, item.namespace]),
            label: item.namespace ? item.namespace + ' · ' + item.key : item.key, characters: item.characters });
        }
        break;
      }
      case 'user': case 'assistant': case 'tool_call':
        add('messages', characters, { key: category.category, category: category.category, characters }); break;
      default: {
        const source = { system: 'system_prompt', tool_result: 'tool_outputs', compaction: 'summary', reasoning: 'reasoning', hosted_context: 'hosted_context', unlabelled: 'unlabelled' } as const;
        add(source[category.category], characters);
      }
    }
  }
  const total = breakdown.total_characters;
  const ordered = [...rows.values()].sort((a, b) => b.characters - a.characters || FLOWER_CONTEXT_SOURCES.indexOf(a.key) - FLOWER_CONTEXT_SOURCES.indexOf(b.key));
  for (const row of ordered) {
    row.share = total > 0 ? row.characters / total * 100 : 0;
    row.items.sort((a, b) => b.characters - a.characters || a.key.localeCompare(b.key));
    for (const item of row.items) item.share = total > 0 ? item.characters / total * 100 : 0;
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
  return formatContextAmount(value);
}

export function contextUsageRatio(usage: FlowerContextSample): number | null {
  if (!usage.available || !usage.measured) return null;
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
  const sample = usage.confirmed;
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
  const recentCacheHitValue = formatCacheHitPercent(sample?.available ? usage.recent_request_usage : undefined, labels.unknownPercent);
  const accessibleRecentCache = formatCacheHitPercent(sample?.available ? usage.recent_request_usage : undefined, labels.unavailable);
  const accessibleUsage = progressValue === null ? labels.unavailable : ratioValue;
  const accessibleCache = formatCacheHitPercent(usage.thread_usage, labels.unavailable);
  return {
    ariaLabel: labels.label,
    ariaValueText: labels.label + ': ' + (sample?.available && sample.measured && sample.input_tokens !== undefined ? '= ' + labels.tokens(String(sample.input_tokens)) + ', ' + labels.measured + ', ' + labels.lastRequest + ', ' : '') + accessibleUsage + ', ' + labels.recentCacheHitLabel + ': ' + accessibleRecentCache + ', ' + labels.cacheHitLabel + ': ' + accessibleCache + (warning ? ', ' + warning : ''),
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
  if (compaction.status === 'compacted' && before && after) return labels.tokenChange(before, after);
  const error = trimString(compaction.error);
  if (error) return error;
  switch (compaction.status) {
    case 'compacting':
      return before ? labels.compactingDetail + ' · ' + copy.chat.contextIndicator.tokens(before) : labels.compactingDetail;
    case 'cancelled': return labels.cancelledDetail;
    case 'failed': return labels.failedDetail;
    case 'compacted': return labels.unavailableDetail;
    default: return '';
  }
}
