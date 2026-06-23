import type {
  FlowerReasoningCapability,
  FlowerReasoningLevel,
  FlowerReasoningSelection,
} from './contracts/flowerSurfaceContracts';

type JsonRecord = Record<string, unknown>;

const REASONING_LEVELS = new Set<FlowerReasoningLevel>(['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function unsupportedReasoningLevelError(raw: unknown): Error {
  return new Error(`Flower contract error: reasoning level is unsupported: ${trim(raw) || '<empty>'}.`);
}

function stringList(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map(trim).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

export function normalizeFlowerReasoningLevel(raw: unknown): FlowerReasoningLevel | undefined {
  const value = trim(raw).toLowerCase();
  return REASONING_LEVELS.has(value as FlowerReasoningLevel) ? value as FlowerReasoningLevel : undefined;
}

export function parseFlowerReasoningLevel(raw: unknown): FlowerReasoningLevel | undefined {
  const value = trim(raw);
  if (!value) return undefined;
  const level = normalizeFlowerReasoningLevel(value);
  if (!level) throw unsupportedReasoningLevelError(value);
  return level;
}

export function normalizeFlowerReasoningSelection(raw: unknown): FlowerReasoningSelection | undefined {
  const record = recordValue(raw);
  if (!record) return undefined;
  const level = parseFlowerReasoningLevel(record.level);
  const budget = Math.floor(Number(record.budget_tokens ?? 0));
  const out: FlowerReasoningSelection = {
    ...(level ? { level } : {}),
    ...(Number.isSafeInteger(budget) && budget > 0 ? { budget_tokens: budget } : {}),
  };
  return out.level || out.budget_tokens ? out : undefined;
}

export function normalizeFlowerReasoningCapability(raw: unknown): FlowerReasoningCapability | undefined {
  const record = recordValue(raw);
  if (!record) return undefined;
  const kind = trim(record.kind).toLowerCase();
  const wireShape = trim(record.wire_shape).toLowerCase();
  const supportedLevels = Array.isArray(record.supported_levels)
    ? record.supported_levels.map(parseFlowerReasoningLevel).filter((level): level is FlowerReasoningLevel => Boolean(level))
    : [];
  const sourceURLs = stringList(record.source_urls);
  if (!kind && !wireShape && supportedLevels.length === 0 && !record.disable_supported && !record.dynamic_provider_metadata) {
    return undefined;
  }
  const minBudget = Math.floor(Number(record.min_budget_tokens ?? 0));
  const maxBudget = Math.floor(Number(record.max_budget_tokens ?? 0));
  const defaultLevel = parseFlowerReasoningLevel(record.default_level);
  return {
    ...(kind ? { kind } : {}),
    ...(supportedLevels.length > 0 ? { supported_levels: [...new Set(supportedLevels)] } : {}),
    ...(defaultLevel ? { default_level: defaultLevel } : {}),
    ...(record.disable_supported !== undefined ? { disable_supported: Boolean(record.disable_supported) } : {}),
    ...(record.default_enabled !== undefined && record.default_enabled !== null ? { default_enabled: Boolean(record.default_enabled) } : {}),
    ...(wireShape ? { wire_shape: wireShape } : {}),
    ...(trim(record.disable_shape) ? { disable_shape: trim(record.disable_shape).toLowerCase() } : {}),
    ...(trim(record.budget_shape) ? { budget_shape: trim(record.budget_shape).toLowerCase() } : {}),
    ...(Number.isSafeInteger(minBudget) && minBudget > 0 ? { min_budget_tokens: minBudget } : {}),
    ...(Number.isSafeInteger(maxBudget) && maxBudget > 0 ? { max_budget_tokens: maxBudget } : {}),
    ...(record.dynamic_provider_metadata !== undefined ? { dynamic_provider_metadata: Boolean(record.dynamic_provider_metadata) } : {}),
    ...(stringList(record.response_reasoning_fields) ? { response_reasoning_fields: stringList(record.response_reasoning_fields) } : {}),
    ...(stringList(record.history_replay_requirements) ? { history_replay_requirements: stringList(record.history_replay_requirements) } : {}),
    ...(sourceURLs ? { source_urls: sourceURLs } : {}),
    ...(trim(record.source_checked_at) ? { source_checked_at: trim(record.source_checked_at) } : {}),
    ...(trim(record.fixture) ? { fixture: trim(record.fixture) } : {}),
  };
}

export function serializeFlowerReasoningSelection(selection: FlowerReasoningSelection | null | undefined): FlowerReasoningSelection | undefined {
  const record = recordValue(selection);
  if (record && Object.prototype.hasOwnProperty.call(record, 'level')) {
    parseFlowerReasoningLevel(record.level);
  }
  return normalizeFlowerReasoningSelection(selection);
}

export function reasoningCapabilitySupportsControl(capability: FlowerReasoningCapability | null | undefined): boolean {
  if (!capability) return false;
  return Boolean(
    capability.disable_supported
    || (capability.supported_levels?.length ?? 0) > 0
    || capability.budget_shape
    || capability.min_budget_tokens
    || capability.max_budget_tokens,
  );
}

export function defaultReasoningSelectionForCapability(capability: FlowerReasoningCapability | null | undefined): FlowerReasoningSelection | undefined {
  const level = normalizeFlowerReasoningLevel(capability?.default_level);
  return level ? { level } : undefined;
}

export function sameFlowerReasoningSelection(
  left: FlowerReasoningSelection | null | undefined,
  right: FlowerReasoningSelection | null | undefined,
): boolean {
  const a = normalizeFlowerReasoningSelection(left);
  const b = normalizeFlowerReasoningSelection(right);
  return (a?.level ?? '') === (b?.level ?? '')
    && Math.max(0, Math.floor(Number(a?.budget_tokens ?? 0))) === Math.max(0, Math.floor(Number(b?.budget_tokens ?? 0)));
}

export function sameFlowerReasoningCapability(
  left: FlowerReasoningCapability | null | undefined,
  right: FlowerReasoningCapability | null | undefined,
): boolean {
  return JSON.stringify(normalizeFlowerReasoningCapability(left) ?? null) === JSON.stringify(normalizeFlowerReasoningCapability(right) ?? null);
}

export function flowerReasoningLevelLabel(level: FlowerReasoningLevel | string | null | undefined): string {
  switch (normalizeFlowerReasoningLevel(level)) {
    case 'off':
      return 'Off';
    case 'minimal':
      return 'Min';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Med';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'XHigh';
    case 'max':
      return 'Max';
    default:
      return 'Default';
  }
}

export function effectiveFlowerReasoningSelection(
  capability: FlowerReasoningCapability | null | undefined,
  selection: FlowerReasoningSelection | null | undefined,
): FlowerReasoningSelection | undefined {
  return normalizeFlowerReasoningSelection(selection) ?? defaultReasoningSelectionForCapability(capability);
}
