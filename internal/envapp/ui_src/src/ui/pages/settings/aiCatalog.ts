import type {
  AIProviderModelPreset,
  AIProviderPreset,
  AIProviderRow,
  AIProviderType,
} from './types';

export const DEFAULT_OPENAI_COMPAT_CONTEXT_WINDOW = 128000;
export const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;

export const AI_PROVIDER_TYPE_OPTIONS: ReadonlyArray<{ value: AIProviderType; label: string }> = [
  { value: 'openai', label: 'openai' },
  { value: 'anthropic', label: 'anthropic' },
  { value: 'moonshot', label: 'moonshot' },
  { value: 'chatglm', label: 'chatglm' },
  { value: 'deepseek', label: 'deepseek' },
  { value: 'qwen', label: 'qwen' },
  { value: 'openai_compatible', label: 'openai_compatible' },
];

export const AI_PROVIDER_PRESET_CATALOG: Record<AIProviderType, AIProviderPreset> = {
  openai: {
    type: 'openai',
    name: 'OpenAI',
    default_base_url: 'https://api.openai.com/v1',
    models: [
      { model_name: 'gpt-5.5', context_window: 1050000, max_output_tokens: 128000, note: 'Latest frontier model for complex reasoning and coding' },
      { model_name: 'gpt-5.4', context_window: 1050000, max_output_tokens: 128000, note: 'Affordable frontier model for professional work' },
      { model_name: 'gpt-5.4-mini', context_window: 400000, max_output_tokens: 128000, note: 'Fast, cost-effective GPT-5.4 variant' },
      { model_name: 'gpt-5.4-nano', context_window: 400000, max_output_tokens: 128000, note: 'Low-cost option for simple high-volume tasks' },
      { model_name: 'gpt-5.2', context_window: 400000, max_output_tokens: 128000, note: 'Previous flagship model' },
      { model_name: 'gpt-5.2-mini', context_window: 400000, max_output_tokens: 128000, note: 'Cost-effective flagship variant' },
      { model_name: 'gpt-5', context_window: 400000, max_output_tokens: 128000, note: 'Stable flagship' },
      { model_name: 'gpt-5-mini', context_window: 400000, max_output_tokens: 128000, note: 'Stable lightweight option' },
    ],
  },
  anthropic: {
    type: 'anthropic',
    name: 'Anthropic',
    default_base_url: 'https://api.anthropic.com/v1',
    models: [
      { model_name: 'claude-opus-4-7', context_window: 1000000, max_output_tokens: 128000, note: 'Most capable Claude model for complex agentic coding' },
      { model_name: 'claude-sonnet-4-6', context_window: 1000000, max_output_tokens: 64000, note: 'Best balance of speed and intelligence' },
      { model_name: 'claude-haiku-4-5-20251001', context_window: 200000, max_output_tokens: 64000, note: 'Fastest current Claude model' },
    ],
  },
  moonshot: {
    type: 'moonshot',
    name: 'Moonshot',
    default_base_url: 'https://api.moonshot.cn/v1',
    models: [
      { model_name: 'kimi-k2.6', context_window: 256000, max_output_tokens: 96000, note: 'Current Kimi flagship with built-in web search' },
    ],
  },
  chatglm: {
    type: 'chatglm',
    name: 'ChatGLM',
    default_base_url: 'https://api.z.ai/api/paas/v4/',
    models: [
      { model_name: 'glm-5.1', context_window: 200000, max_output_tokens: 128000, note: 'Current GLM flagship with built-in web search' },
    ],
  },
  deepseek: {
    type: 'deepseek',
    name: 'DeepSeek',
    default_base_url: 'https://api.deepseek.com',
    models: [
      { model_name: 'deepseek-v4-pro', context_window: 1000000, max_output_tokens: 384000, note: 'Current V4 flagship model' },
      { model_name: 'deepseek-v4-flash', context_window: 1000000, max_output_tokens: 384000, note: 'Current V4 fast model' },
    ],
  },
  qwen: {
    type: 'qwen',
    name: 'Qwen',
    default_base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: [
      { model_name: 'qwen3.6-plus', context_window: 1000000, max_output_tokens: 65536, note: 'Current Qwen3.6 Plus with built-in web search' },
      { model_name: 'qwen3.6-plus-2026-04-02', context_window: 1000000, max_output_tokens: 65536, note: 'Pinned Qwen3.6 Plus snapshot with built-in web search' },
      { model_name: 'qwen3.6-flash', context_window: 1000000, max_output_tokens: 65536, note: 'Current Qwen3.6 Flash with built-in web search' },
      { model_name: 'qwen3.6-flash-2026-04-16', context_window: 1000000, max_output_tokens: 65536, note: 'Pinned Qwen3.6 Flash snapshot with built-in web search' },
    ],
  },
  openai_compatible: {
    type: 'openai_compatible',
    name: 'OpenAI compatible',
    default_base_url: 'https://api.example.com/v1',
    web_search: { mode: 'disabled' },
    models: [],
  },
};

export function modelID(providerID: string, modelName: string): string {
  const pid = String(providerID ?? '').trim();
  const mn = String(modelName ?? '').trim();
  if (!pid || !mn) return '';
  return `${pid}/${mn}`;
}

export function providerTypeRequiresBaseURL(providerType: AIProviderType): boolean {
  return providerType === 'moonshot' || providerType === 'chatglm' || providerType === 'deepseek' || providerType === 'qwen' || providerType === 'openai_compatible';
}

export function providerPresetForType(providerType: AIProviderType): AIProviderPreset {
  return AI_PROVIDER_PRESET_CATALOG[providerType] ?? AI_PROVIDER_PRESET_CATALOG.openai;
}

export function recommendedModelsForProviderType(providerType: AIProviderType): readonly AIProviderModelPreset[] {
  return providerPresetForType(providerType).models;
}

export function formatTokenCount(tokenCount: number): string {
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) return 'N/A';
  return new Intl.NumberFormat('en-US').format(Math.trunc(tokenCount));
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
  if (providerType === 'openai_compatible') return DEFAULT_OPENAI_COMPAT_CONTEXT_WINDOW;
  return undefined;
}

export function normalizeEffectiveContextPercent(raw: unknown): number | undefined {
  const parsed = normalizePositiveInteger(raw);
  if (parsed == null) return undefined;
  if (parsed < 1 || parsed > 100) return undefined;
  return parsed;
}

export function defaultBaseURLForProviderType(providerType: AIProviderType): string {
  return providerPresetForType(providerType).default_base_url;
}

export function providerNeedsWebSearchConfig(providerType: AIProviderType): boolean {
  return providerType === 'openai_compatible';
}

export function providerBuiltInWebSearchLabel(providerType: AIProviderType): string | undefined {
  switch (providerType) {
    case 'openai':
      return 'OpenAI built-in web search';
    case 'moonshot':
      return 'Kimi built-in web search';
    case 'chatglm':
      return 'GLM built-in web search';
    case 'deepseek':
      return 'DeepSeek built-in web search';
    case 'qwen':
      return 'Qwen built-in web search';
    default:
      return undefined;
  }
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
    })),
  };
}

export function normalizeAIProviderRowDraft(row: AIProviderRow): AIProviderRow {
  const out = cloneAIProviderRow(row);
  const models = Array.isArray(out.models) ? out.models : [];
  if (models.length === 0) {
    out.models = [{ model_name: '', context_window: defaultContextWindowForProviderType(out.type) }];
  } else {
    out.models = models.map((m) => ({
      model_name: String(m?.model_name ?? ''),
      context_window: normalizeContextWindowByProvider(out.type, m?.context_window),
      max_output_tokens: normalizePositiveInteger(m?.max_output_tokens),
      effective_context_window_percent: normalizeEffectiveContextPercent(m?.effective_context_window_percent),
    }));
  }
  return out;
}
