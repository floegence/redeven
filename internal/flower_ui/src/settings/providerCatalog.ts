import type { FlowerProvider, FlowerProviderType } from '../contracts/flowerSurfaceContracts';

type FlowerProviderPreset = Readonly<{
  type: FlowerProviderType;
  name: string;
  default_base_url: string;
}>;

export const FLOWER_PROVIDER_TYPES: readonly { value: FlowerProviderType; label: string; hint: string }[] = [
  { value: 'openai', label: 'OpenAI', hint: 'Native connection' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Native connection' },
  { value: 'google', label: 'Gemini', hint: 'Native connection' },
  { value: 'kimi_code', label: 'Kimi Code', hint: 'Subscription API key' },
  { value: 'moonshot', label: 'Moonshot', hint: 'Native connection' },
  { value: 'chatglm', label: 'Z.ai', hint: 'Native connection' },
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
  openai: { type: 'openai', name: 'OpenAI', default_base_url: 'https://api.openai.com/v1' },
  anthropic: { type: 'anthropic', name: 'Anthropic', default_base_url: 'https://api.anthropic.com' },
  google: { type: 'google', name: 'Gemini', default_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  kimi_code: { type: 'kimi_code', name: 'Kimi Code', default_base_url: 'https://api.kimi.com/coding/v1' },
  moonshot: { type: 'moonshot', name: 'Moonshot', default_base_url: 'https://api.moonshot.cn/v1' },
  chatglm: { type: 'chatglm', name: 'Z.ai', default_base_url: 'https://api.z.ai/api/paas/v4/' },
  deepseek: { type: 'deepseek', name: 'DeepSeek', default_base_url: 'https://api.deepseek.com' },
  qwen: { type: 'qwen', name: 'Qwen', default_base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  openrouter: { type: 'openrouter', name: 'OpenRouter', default_base_url: 'https://openrouter.ai/api/v1' },
  xai: { type: 'xai', name: 'xAI', default_base_url: 'https://api.x.ai/v1' },
  groq: { type: 'groq', name: 'Groq', default_base_url: 'https://api.groq.com/openai/v1' },
  ollama: { type: 'ollama', name: 'Ollama', default_base_url: 'http://127.0.0.1:11434/v1' },
  openai_compatible: { type: 'openai_compatible', name: 'OpenAI compatible', default_base_url: 'https://api.example.com/v1' },
};

export function flowerProviderPresetForType(type: FlowerProviderType): FlowerProviderPreset {
  return FLOWER_PROVIDER_PRESETS[type] ?? FLOWER_PROVIDER_PRESETS.openai_compatible;
}

export function defaultBaseURLForFlowerProviderType(type: FlowerProviderType): string {
  return flowerProviderPresetForType(type).default_base_url;
}

export function flowerProviderTypeRequiresBaseURL(type: FlowerProviderType): boolean {
  return type === 'kimi_code' || type === 'moonshot' || type === 'chatglm' || type === 'deepseek' || type === 'qwen' || type === 'openrouter' || type === 'xai' || type === 'groq' || type === 'ollama' || type === 'openai_compatible';
}

export function flowerProviderSupportsCustomModels(type: FlowerProviderType): boolean {
  return type !== 'ollama' && type !== 'kimi_code';
}

export function flowerProviderDisplayName(provider: Pick<FlowerProvider, 'name' | 'type'>, fallback = flowerProviderTypeLabel(provider.type)): string {
  return String(provider.name ?? '').trim() || fallback;
}

export function flowerModelID(providerID: string, modelName: string): string {
  const cleanProviderID = String(providerID ?? '').trim();
  const cleanModelName = String(modelName ?? '').trim();
  return cleanProviderID && cleanModelName ? `${cleanProviderID}/${cleanModelName}` : '';
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
