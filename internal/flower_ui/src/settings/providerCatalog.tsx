import type { Component } from 'solid-js';
import { For, Match, Switch } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import type { FlowerProvider, FlowerProviderModel, FlowerProviderType, FlowerWebSearchMode } from '../contracts/flowerSurfaceContracts';
import { FLOWER_PROVIDER_ICON_DEFINITIONS } from './providerBrandIcons';
import type { FlowerProviderModelNoteKey } from './providerModelNotes';

export type FlowerProviderModelPreset = FlowerProviderModel & Readonly<{ note_key?: FlowerProviderModelNoteKey }>;

type FlowerProviderPreset = Readonly<{
  type: FlowerProviderType;
  name: string;
  default_base_url: string;
  web_search?: Readonly<{ mode: FlowerWebSearchMode }>;
  models: readonly FlowerProviderModelPreset[];
}>;

const TEXT_MODALITIES: readonly string[] = ['text'];
const VISION_MODALITIES: readonly string[] = ['text', 'image'];

export const FLOWER_PROVIDER_TYPES: readonly { value: FlowerProviderType; label: string; hint: string }[] = [
  { value: 'openai', label: 'OpenAI', hint: 'Native connection' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Native connection' },
  { value: 'moonshot', label: 'Moonshot', hint: 'Native connection' },
  { value: 'chatglm', label: 'ChatGLM', hint: 'Native connection' },
  { value: 'deepseek', label: 'DeepSeek', hint: 'Native connection' },
  { value: 'qwen', label: 'Qwen', hint: 'Native connection' },
  { value: 'openai_compatible', label: 'OpenAI-compatible', hint: 'Custom gateway' },
];

export function flowerProviderTypeLabel(type: FlowerProviderType): string {
  return FLOWER_PROVIDER_TYPES.find((item) => item.value === type)?.label ?? type;
}

export const FLOWER_PROVIDER_PRESETS: Record<FlowerProviderType, FlowerProviderPreset> = {
  openai: {
    type: 'openai',
    name: 'OpenAI',
    default_base_url: 'https://api.openai.com/v1',
    models: [
      { model_name: 'gpt-5.5', context_window: 1_050_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, note_key: 'openai_gpt_55_frontier' },
      { model_name: 'gpt-5.4', context_window: 1_050_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, note_key: 'openai_gpt_54_professional' },
      { model_name: 'gpt-5.4-mini', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, note_key: 'openai_gpt_54_mini' },
      { model_name: 'gpt-5.4-nano', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, note_key: 'openai_gpt_54_nano' },
      { model_name: 'gpt-5.2', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, note_key: 'openai_gpt_52_previous_flagship' },
      { model_name: 'gpt-5.2-mini', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, note_key: 'openai_gpt_52_mini' },
      { model_name: 'gpt-5', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, note_key: 'openai_gpt_5_stable' },
      { model_name: 'gpt-5-mini', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, note_key: 'openai_gpt_5_mini' },
    ],
  },
  anthropic: {
    type: 'anthropic',
    name: 'Anthropic',
    default_base_url: 'https://api.anthropic.com/v1',
    models: [
      { model_name: 'claude-opus-4-7', context_window: 1_000_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, note_key: 'claude_opus_47_note' },
      { model_name: 'claude-sonnet-4-6', context_window: 1_000_000, max_output_tokens: 64_000, input_modalities: VISION_MODALITIES, note_key: 'anthropic_sonnet_46' },
      { model_name: 'claude-haiku-4-5-20251001', context_window: 200_000, max_output_tokens: 64_000, input_modalities: VISION_MODALITIES, note_key: 'claude_haiku_45_note' },
    ],
  },
  moonshot: {
    type: 'moonshot',
    name: 'Moonshot',
    default_base_url: 'https://api.moonshot.cn/v1',
    models: [
      { model_name: 'kimi-k2.6', context_window: 256_000, max_output_tokens: 96_000, input_modalities: TEXT_MODALITIES, note_key: 'moonshot_kimi_k26' },
    ],
  },
  chatglm: {
    type: 'chatglm',
    name: 'ChatGLM',
    default_base_url: 'https://api.z.ai/api/paas/v4/',
    models: [
      { model_name: 'glm-5.1', context_window: 200_000, max_output_tokens: 128_000, input_modalities: TEXT_MODALITIES, note_key: 'chatglm_glm_51' },
    ],
  },
  deepseek: {
    type: 'deepseek',
    name: 'DeepSeek',
    default_base_url: 'https://api.deepseek.com',
    models: [
      { model_name: 'deepseek-v4-pro', context_window: 1_000_000, max_output_tokens: 384_000, input_modalities: TEXT_MODALITIES, note_key: 'deepseek_v4_pro' },
      { model_name: 'deepseek-v4-flash', context_window: 1_000_000, max_output_tokens: 384_000, input_modalities: TEXT_MODALITIES, note_key: 'deepseek_v4_flash' },
    ],
  },
  qwen: {
    type: 'qwen',
    name: 'Qwen',
    default_base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: [
      { model_name: 'qwen3.6-plus', context_window: 1_000_000, max_output_tokens: 65_536, input_modalities: TEXT_MODALITIES, note_key: 'qwen36_plus' },
      { model_name: 'qwen3.6-plus-2026-04-02', context_window: 1_000_000, max_output_tokens: 65_536, input_modalities: TEXT_MODALITIES, note_key: 'qwen36_plus_snapshot' },
      { model_name: 'qwen3.6-flash', context_window: 1_000_000, max_output_tokens: 65_536, input_modalities: TEXT_MODALITIES, note_key: 'qwen36_flash' },
      { model_name: 'qwen3.6-flash-2026-04-16', context_window: 1_000_000, max_output_tokens: 65_536, input_modalities: TEXT_MODALITIES, note_key: 'qwen36_flash_snapshot' },
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
  return type === 'moonshot' || type === 'chatglm' || type === 'deepseek' || type === 'qwen' || type === 'openai_compatible';
}

export function flowerProviderUsesCustomName(type: FlowerProviderType): boolean {
  return type === 'openai_compatible';
}

export function flowerProviderSupportsCustomModels(type: FlowerProviderType): boolean {
  return type === 'openai' || type === 'anthropic' || type === 'openai_compatible';
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
  return type === 'openai_compatible' ? 128_000 : undefined;
}

export const FlowerProviderBrandIcon: Component<{ type: FlowerProviderType; class?: string }> = (props) => {
  const icon = () => FLOWER_PROVIDER_ICON_DEFINITIONS[props.type] ?? FLOWER_PROVIDER_ICON_DEFINITIONS.openai_compatible;
  const iconClass = () => cn('inline-flex shrink-0 items-center justify-center', props.class);

  return (
    <Switch>
      <Match when={icon().svgContent}>
        <span
          class={iconClass()}
          role="img"
          aria-label={icon().title}
          data-flower-provider-brand={props.type}
          innerHTML={icon().svgContent}
        />
      </Match>
      <Match when={icon().paths}>
        <svg
          viewBox={icon().viewBox}
          role="img"
          aria-label={icon().title}
          data-flower-provider-brand={props.type}
          class={iconClass()}
          style={{ color: icon().color }}
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>{icon().title}</title>
          <For each={icon().paths}>
            {(path, index) => (
              <path
                d={path}
                fill={icon().fills ? icon().fills![index()] : 'currentColor'}
                fill-rule={icon().fillRule}
                clip-rule={icon().fillRule}
              />
            )}
          </For>
        </svg>
      </Match>
    </Switch>
  );
};
