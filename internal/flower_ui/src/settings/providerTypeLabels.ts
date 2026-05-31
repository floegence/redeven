import type { FlowerProviderType } from '../contracts/flowerSurfaceContracts';

export type FlowerProviderTypeLabels = Readonly<Record<FlowerProviderType, string>>;

const EN_US_PROVIDER_TYPE_LABELS: FlowerProviderTypeLabels = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  moonshot: 'Moonshot',
  chatglm: 'ChatGLM',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  openai_compatible: 'OpenAI-compatible',
};

const LOCALE_PROVIDER_TYPE_LABELS: Readonly<Record<string, FlowerProviderTypeLabels>> = {
  'zh-CN': {
    ...EN_US_PROVIDER_TYPE_LABELS,
    openai_compatible: 'OpenAI 兼容',
  },
  'zh-TW': {
    ...EN_US_PROVIDER_TYPE_LABELS,
    openai_compatible: 'OpenAI 相容',
  },
  'ja-JP': {
    ...EN_US_PROVIDER_TYPE_LABELS,
    openai_compatible: 'OpenAI 互換',
  },
  'ko-KR': {
    ...EN_US_PROVIDER_TYPE_LABELS,
    openai_compatible: 'OpenAI 호환',
  },
  'de-DE': {
    ...EN_US_PROVIDER_TYPE_LABELS,
    openai_compatible: 'OpenAI-kompatibel',
  },
  'fr-FR': {
    ...EN_US_PROVIDER_TYPE_LABELS,
    openai_compatible: 'Compatible OpenAI',
  },
  'es-ES': {
    ...EN_US_PROVIDER_TYPE_LABELS,
    openai_compatible: 'Compatible con OpenAI',
  },
  'pt-BR': {
    ...EN_US_PROVIDER_TYPE_LABELS,
    openai_compatible: 'Compatível com OpenAI',
  },
  'ru-RU': {
    ...EN_US_PROVIDER_TYPE_LABELS,
    openai_compatible: 'OpenAI-совместимый',
  },
};

export function localizedFlowerProviderTypeLabels(locale: string | undefined): FlowerProviderTypeLabels {
  return LOCALE_PROVIDER_TYPE_LABELS[String(locale ?? '')] ?? EN_US_PROVIDER_TYPE_LABELS;
}
