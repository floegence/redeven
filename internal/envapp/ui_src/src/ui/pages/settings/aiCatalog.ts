import type {
  AIInputModality,
  AIProviderModelPreset,
  AIProviderPreset,
  AIProviderRow,
  AIProviderType,
} from './types';
import { AI_PROVIDER_ICON_DEFINITIONS, type AIProviderIconDefinition } from './providerBrandIcons';
import {
  FLOWER_PROVIDER_PRESETS,
  FLOWER_PROVIDER_TYPES,
  defaultFlowerContextWindowForProviderType,
  flowerBuiltInWebSearchLabel,
  flowerProviderNeedsWebSearchConfig,
  flowerProviderSupportsCustomModels,
  flowerProviderTypeRequiresBaseURL,
  flowerProviderUsesCustomName,
} from '../../../../../../flower_ui/src/settings/providerCatalog';
import { localizedFlowerProviderTypeLabels } from '../../../../../../flower_ui/src/settings/providerTypeLabels';

export const DEFAULT_OPENAI_COMPAT_CONTEXT_WINDOW = defaultFlowerContextWindowForProviderType('openai_compatible') ?? 128000;
export const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;
export const DEFAULT_INPUT_MODALITIES: readonly AIInputModality[] = ['text'];

export type AIProviderBrand = Readonly<{
  type: AIProviderType;
  label: string;
  description: string;
  customConnectionName: boolean;
  icon: AIProviderIconDefinition;
}>;

const AI_PROVIDER_TYPE_ORDER = FLOWER_PROVIDER_TYPES.map((item) => item.value as AIProviderType);

function toAIInputModalities(raw: readonly string[] | undefined): readonly AIInputModality[] {
  const modalities = (raw ?? DEFAULT_INPUT_MODALITIES)
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter((item): item is AIInputModality => item === 'text' || item === 'image');
  return modalities.length > 0 ? [...new Set(modalities)] : DEFAULT_INPUT_MODALITIES;
}

function toAIProviderPreset(providerType: AIProviderType): AIProviderPreset {
  const preset = FLOWER_PROVIDER_PRESETS[providerType];
  return {
    type: providerType,
    name: preset.name,
    default_base_url: preset.default_base_url,
    web_search: preset.web_search,
    models: preset.models.map((model) => ({
      model_name: model.model_name,
      context_window: Number(model.context_window ?? 0),
      ...(model.max_output_tokens ? { max_output_tokens: model.max_output_tokens } : {}),
      ...(model.effective_context_window_percent ? { effective_context_window_percent: model.effective_context_window_percent } : {}),
      input_modalities: toAIInputModalities(model.input_modalities),
      ...(model.note_key ? { note_key: model.note_key } : {}),
    })),
  };
}

export const AI_PROVIDER_BRANDS: Record<AIProviderType, AIProviderBrand> = Object.fromEntries(
  FLOWER_PROVIDER_TYPES.map((item) => {
    const providerType = item.value as AIProviderType;
    return [providerType, {
      type: providerType,
      label: item.label,
      description: item.hint,
      customConnectionName: providerType === 'openai_compatible',
      icon: AI_PROVIDER_ICON_DEFINITIONS[providerType],
    }];
  }),
) as Record<AIProviderType, AIProviderBrand>;

export const AI_PROVIDER_TYPE_OPTIONS: ReadonlyArray<{ value: AIProviderType; label: string; description: string }> = AI_PROVIDER_TYPE_ORDER.map((providerType) => {
  const brand = AI_PROVIDER_BRANDS[providerType];
  return { value: brand.type, label: brand.label, description: brand.description };
});

export const AI_PROVIDER_PRESET_CATALOG: Record<AIProviderType, AIProviderPreset> = Object.fromEntries(
  AI_PROVIDER_TYPE_ORDER.map((providerType) => [providerType, toAIProviderPreset(providerType)]),
) as Record<AIProviderType, AIProviderPreset>;

export function modelID(providerID: string, modelName: string): string {
  const pid = String(providerID ?? '').trim();
  const mn = String(modelName ?? '').trim();
  if (!pid || !mn) return '';
  return `${pid}/${mn}`;
}

export function providerTypeRequiresBaseURL(providerType: AIProviderType): boolean {
  return flowerProviderTypeRequiresBaseURL(providerType);
}

export function providerPresetForType(providerType: AIProviderType): AIProviderPreset {
  return AI_PROVIDER_PRESET_CATALOG[providerType] ?? AI_PROVIDER_PRESET_CATALOG.openai;
}

export function providerBrandForType(providerType: AIProviderType): AIProviderBrand {
  return AI_PROVIDER_BRANDS[providerType];
}

export function providerTypeLabel(providerType: AIProviderType): string {
  return providerBrandForType(providerType).label;
}

export function localizedProviderTypeLabel(providerType: AIProviderType, locale: string | undefined): string {
  return localizedFlowerProviderTypeLabels(locale)[providerType] ?? providerTypeLabel(providerType);
}

export function providerUsesCustomConnectionName(providerType: AIProviderType): boolean {
  return flowerProviderUsesCustomName(providerType);
}

export function providerDisplayName(row: Pick<AIProviderRow, 'name' | 'type'>, fallback = 'Provider'): string {
  if (providerUsesCustomConnectionName(row.type)) {
    return String(row.name ?? '').trim() || fallback;
  }
  return providerTypeLabel(row.type);
}

export function localizedProviderDisplayName(
  row: Pick<AIProviderRow, 'name' | 'type'>,
  locale: string | undefined,
  fallback = 'Provider',
): string {
  if (providerUsesCustomConnectionName(row.type)) {
    return String(row.name ?? '').trim() || fallback;
  }
  return localizedProviderTypeLabel(row.type, locale);
}

export function recommendedModelsForProviderType(providerType: AIProviderType): readonly AIProviderModelPreset[] {
  return providerPresetForType(providerType).models;
}

export function formatTokenCount(tokenCount: number): string {
  return formatTokenCountForLocale(tokenCount);
}

export function formatTokenCountForLocale(tokenCount: number, locale = 'en-US'): string {
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) return 'N/A';
  return new Intl.NumberFormat(locale).format(Math.trunc(tokenCount));
}

export function normalizePositiveInteger(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const value = Math.floor(n);
  if (value <= 0) return undefined;
  return value;
}

export function normalizeContextWindowByProvider(providerType: AIProviderType, raw: unknown): number | undefined {
  const parsed = normalizePositiveInteger(raw);
  if (parsed != null) return parsed;
  if (providerType === 'openai_compatible') return DEFAULT_OPENAI_COMPAT_CONTEXT_WINDOW;
  return undefined;
}

export function defaultContextWindowForProviderType(providerType: AIProviderType): number | undefined {
  return defaultFlowerContextWindowForProviderType(providerType);
}

export function normalizeEffectiveContextPercent(raw: unknown): number | undefined {
  const parsed = normalizePositiveInteger(raw);
  if (parsed == null) return undefined;
  if (parsed < 1 || parsed > 100) return undefined;
  return parsed;
}

export function normalizeInputModalities(raw: unknown): AIInputModality[] {
  const source = Array.isArray(raw) ? raw : DEFAULT_INPUT_MODALITIES;
  const out: AIInputModality[] = [];
  for (const item of source) {
    const modality = String(item ?? '').trim().toLowerCase();
    if (modality !== 'text' && modality !== 'image') continue;
    if (!out.includes(modality)) out.push(modality);
  }
  if (!out.includes('text')) out.unshift('text');
  return out.length > 0 ? out : ['text'];
}

export function modelSupportsImageInput(raw: unknown): boolean {
  return normalizeInputModalities(raw).includes('image');
}

export function modalitySummary(raw: unknown): string {
  return modelSupportsImageInput(raw) ? 'Text + Image' : 'Text only';
}

export function defaultBaseURLForProviderType(providerType: AIProviderType): string {
  return providerPresetForType(providerType).default_base_url;
}

export function providerNeedsWebSearchConfig(providerType: AIProviderType): boolean {
  return flowerProviderNeedsWebSearchConfig(providerType);
}

export function providerSupportsCustomModelNames(providerType: AIProviderType): boolean {
  return flowerProviderSupportsCustomModels(providerType);
}

export function providerBuiltInWebSearchLabel(providerType: AIProviderType): string | undefined {
  return flowerBuiltInWebSearchLabel(providerType) || undefined;
}

export function cloneAIProviderRow(row: AIProviderRow): AIProviderRow {
  return {
    id: String(row?.id ?? ''),
    name: String(row?.name ?? ''),
    type: (row?.type as AIProviderType) || 'openai',
    base_url: String(row?.base_url ?? ''),
    web_search: providerNeedsWebSearchConfig((row?.type as AIProviderType) || 'openai')
      ? { mode: row?.web_search?.mode === 'openai_builtin' || row?.web_search?.mode === 'brave' ? row.web_search.mode : 'disabled' }
      : undefined,
    models: (Array.isArray(row?.models) ? row.models : []).map((m) => ({
      model_name: String(m?.model_name ?? ''),
      context_window: normalizePositiveInteger(m?.context_window),
      max_output_tokens: normalizePositiveInteger(m?.max_output_tokens),
      effective_context_window_percent: normalizeEffectiveContextPercent(m?.effective_context_window_percent),
      input_modalities: normalizeInputModalities(m?.input_modalities),
    })),
  };
}

export function normalizeAIProviderRowDraft(row: AIProviderRow): AIProviderRow {
  const out = cloneAIProviderRow(row);
  const models = Array.isArray(out.models) ? out.models : [];
  out.models = models.map((m) => ({
    model_name: String(m?.model_name ?? ''),
    context_window: normalizeContextWindowByProvider(out.type, m?.context_window),
    max_output_tokens: normalizePositiveInteger(m?.max_output_tokens),
    effective_context_window_percent: normalizeEffectiveContextPercent(m?.effective_context_window_percent),
    input_modalities: normalizeInputModalities(m?.input_modalities),
  }));
  return out;
}
