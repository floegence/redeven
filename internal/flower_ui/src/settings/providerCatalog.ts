import type { FlowerProvider, FlowerProviderModel, FlowerProviderType, FlowerWebSearchMode } from '../contracts/flowerSurfaceContracts';
import type { FlowerProviderModelNoteKey } from './providerModelNotes';

export type FlowerProviderModelPreset = FlowerProviderModel & Readonly<{ note_key?: FlowerProviderModelNoteKey }>;

type FlowerProviderPreset = Readonly<{
  type: FlowerProviderType;
  name: string;
  default_base_url: string;
  web_search?: Readonly<{ mode: FlowerWebSearchMode }>;
  models: readonly FlowerProviderModelPreset[];
}>;

import modelCatalog from '../../../config/model_catalog.generated.json';
const generatedModels = modelCatalog.providers as Record<string, readonly FlowerProviderModelPreset[]>;

export const FLOWER_PROVIDER_TYPES: readonly { value: FlowerProviderType; label: string; hint: string }[] = [
  { value: 'openai', label: 'OpenAI', hint: 'Native connection' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Native connection' },
  { value: 'google', label: 'Gemini', hint: 'Native connection' },
  { value: 'moonshot', label: 'Moonshot', hint: 'Native connection' },
  { value: 'chatglm', label: 'ChatGLM', hint: 'Native connection' },
  { value: 'deepseek', label: 'DeepSeek', hint: 'Native connection' },
  { value: 'qwen', label: 'Qwen', hint: 'Native connection' },
  { value: 'openrouter', label: 'OpenRouter', hint: 'Dynamic model metadata' },
  { value: 'xai', label: 'xAI', hint: 'OpenAI-compatible native endpoint' },
  { value: 'groq', label: 'Groq', hint: 'OpenAI-compatible native endpoint' },
  { value: 'ollama', label: 'Ollama', hint: 'Local OpenAI-compatible endpoint' },
  { value: 'openai_compatible', label: 'OpenAI-compatible', hint: 'Custom endpoint' },
];

export function flowerProviderTypeLabel(type: FlowerProviderType): string {
  return FLOWER_PROVIDER_TYPES.find((item) => item.value === type)?.label ?? type;
}

export const FLOWER_PROVIDER_PRESETS: Record<FlowerProviderType, FlowerProviderPreset> = {
  openai: { type: 'openai', name: 'OpenAI', default_base_url: 'https://api.openai.com/v1', models: generatedModels.openai ?? [] },
  anthropic: { type: 'anthropic', name: 'Anthropic', default_base_url: 'https://api.anthropic.com/v1', models: generatedModels.anthropic ?? [] },
  google: { type: 'google', name: 'Gemini', default_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', models: generatedModels.google ?? [] },
  moonshot: { type: 'moonshot', name: 'Moonshot', default_base_url: 'https://api.moonshot.cn/v1', models: generatedModels.moonshot ?? [] },
  chatglm: { type: 'chatglm', name: 'ChatGLM', default_base_url: 'https://api.z.ai/api/paas/v4/', models: generatedModels.chatglm ?? [] },
  deepseek: { type: 'deepseek', name: 'DeepSeek', default_base_url: 'https://api.deepseek.com', models: generatedModels.deepseek ?? [] },
  qwen: { type: 'qwen', name: 'Qwen', default_base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', models: generatedModels.qwen ?? [] },
  openrouter: { type: 'openrouter', name: 'OpenRouter', default_base_url: 'https://openrouter.ai/api/v1', models: generatedModels.openrouter ?? [] },
  xai: { type: 'xai', name: 'xAI', default_base_url: 'https://api.x.ai/v1', models: generatedModels.xai ?? [] },
  groq: { type: 'groq', name: 'Groq', default_base_url: 'https://api.groq.com/openai/v1', models: generatedModels.groq ?? [] },
  ollama: { type: 'ollama', name: 'Ollama', default_base_url: 'http://127.0.0.1:11434/v1', models: generatedModels.ollama ?? [] },
  openai_compatible: { type: 'openai_compatible', name: 'OpenAI compatible', default_base_url: 'https://api.example.com/v1', models: generatedModels.openai_compatible ?? [], web_search: { mode: 'disabled' } },
};

export function flowerProviderPresetForType(type: FlowerProviderType): FlowerProviderPreset {
  return FLOWER_PROVIDER_PRESETS[type] ?? FLOWER_PROVIDER_PRESETS.openai_compatible;
}

export function defaultBaseURLForFlowerProviderType(type: FlowerProviderType): string {
  return flowerProviderPresetForType(type).default_base_url;
}

export function recommendedModelsForFlowerProviderType(type: FlowerProviderType): readonly FlowerProviderModelPreset[] {
  return flowerProviderPresetForType(type).models;
}

export function flowerProviderTypeRequiresBaseURL(type: FlowerProviderType): boolean {
  return type === 'moonshot' || type === 'chatglm' || type === 'deepseek' || type === 'qwen' || type === 'openrouter' || type === 'xai' || type === 'groq' || type === 'ollama' || type === 'openai_compatible';
}

export function flowerProviderUsesCustomName(type: FlowerProviderType): boolean {
  return type === 'openrouter' || type === 'xai' || type === 'groq' || type === 'ollama' || type === 'openai_compatible';
}

export function flowerProviderSupportsCustomModels(type: FlowerProviderType): boolean {
  return type !== 'ollama';
}

export function flowerProviderNeedsWebSearchConfig(type: FlowerProviderType): boolean {
  return type === 'openai_compatible';
}

export function flowerBuiltInWebSearchLabel(type: FlowerProviderType): string {
  switch (type) {
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
      return '';
  }
}

export function flowerProviderDisplayName(provider: Pick<FlowerProvider, 'id' | 'name' | 'type'>): string {
  const name = String(provider.name ?? '').trim();
  if (flowerProviderUsesCustomName(provider.type)) return name || provider.id || flowerProviderTypeLabel(provider.type);
  return flowerProviderTypeLabel(provider.type);
}

export function flowerModelID(providerID: string, modelName: string): string {
  const cleanProviderID = String(providerID ?? '').trim();
  const cleanModelName = String(modelName ?? '').trim();
  return cleanProviderID && cleanModelName ? `${cleanProviderID}/${cleanModelName}` : '';
}

export function flowerModelSupportsImage(raw: readonly string[] | string | undefined): boolean {
  const source = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return source.some((item) => String(item ?? '').trim().toLowerCase() === 'image');
}

export function formatFlowerTokenCount(value: number | undefined): string {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return 'N/A';
  return new Intl.NumberFormat(undefined).format(Math.trunc(Number(value)));
}

export function normalizeFlowerPositiveInteger(raw: unknown): number | undefined {
  const value = Math.floor(Number(raw));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function normalizeFlowerEffectiveContextPercent(raw: unknown): number | undefined {
  const value = normalizeFlowerPositiveInteger(raw);
  return value != null && value >= 1 && value <= 100 ? value : undefined;
}

export function normalizeFlowerInputModalities(raw: unknown): string[] {
  const source = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const values = source.map((item) => String(item ?? '').trim().toLowerCase()).filter((item) => item === 'text' || item === 'image');
  const unique = [...new Set(values)];
  if (!unique.includes('text')) unique.unshift('text');
  return unique.length > 0 ? unique : ['text'];
}

export function defaultFlowerContextWindowForProviderType(type: FlowerProviderType): number | undefined {
  switch (type) {
    case 'openai_compatible':
    case 'openrouter':
    case 'xai':
    case 'groq':
    case 'ollama':
      return 128_000;
    default:
      return undefined;
  }
}
