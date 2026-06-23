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
const SOURCE_CHECKED_AT = '2026-06-23';

const OPENAI_GPT_55_REASONING = {
  kind: 'effort',
  supported_levels: ['low', 'medium', 'high', 'xhigh'],
  default_level: 'medium',
  disable_supported: true,
  wire_shape: 'openai_responses_reasoning_effort',
  disable_shape: 'openai_reasoning_effort_none',
  response_reasoning_fields: ['completion_tokens_details.reasoning_tokens'],
  source_urls: [
    'https://developers.openai.com/api/docs/models/gpt-5.5',
    'https://developers.openai.com/api/docs/guides/latest-model',
    'https://developers.openai.com/api/docs/guides/reasoning',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'openai_gpt_55_reasoning_effort',
} as const;

const OPENAI_GPT_54_REASONING = {
  kind: 'effort',
  supported_levels: ['low', 'medium', 'high', 'xhigh'],
  default_level: 'off',
  disable_supported: true,
  wire_shape: 'openai_responses_reasoning_effort',
  disable_shape: 'openai_reasoning_effort_none',
  response_reasoning_fields: ['completion_tokens_details.reasoning_tokens'],
  source_urls: [
    'https://developers.openai.com/api/docs/guides/reasoning',
    'https://developers.openai.com/api/docs/models/gpt-5.4',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'openai_gpt_54_reasoning_effort',
} as const;

const OPENAI_GPT_54_MINI_REASONING = {
  ...OPENAI_GPT_54_REASONING,
  source_urls: [
    'https://developers.openai.com/api/docs/guides/reasoning',
    'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
  ],
} as const;

const OPENAI_GPT_54_NANO_REASONING = {
  ...OPENAI_GPT_54_REASONING,
  source_urls: [
    'https://developers.openai.com/api/docs/guides/reasoning',
    'https://developers.openai.com/api/docs/models/gpt-5.4-nano',
  ],
} as const;

const OPENAI_GPT_52_REASONING = {
  ...OPENAI_GPT_54_REASONING,
  source_urls: [
    'https://developers.openai.com/api/docs/guides/reasoning',
    'https://developers.openai.com/api/docs/models/gpt-5.2',
  ],
  fixture: 'openai_gpt_52_reasoning_effort',
} as const;

const OPENAI_GPT_52_CODEX_REASONING = {
  kind: 'effort',
  supported_levels: ['low', 'medium', 'high', 'xhigh'],
  default_level: 'medium',
  wire_shape: 'openai_responses_reasoning_effort',
  disable_shape: 'openai_reasoning_effort_none',
  response_reasoning_fields: ['completion_tokens_details.reasoning_tokens'],
  source_urls: [
    'https://developers.openai.com/api/docs/models/gpt-5.2-codex',
    'https://developers.openai.com/api/docs/guides/reasoning',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'openai_gpt_52_codex_reasoning_effort',
} as const;

const OPENAI_GPT_52_PRO_REASONING = {
  kind: 'effort',
  supported_levels: ['medium', 'high', 'xhigh'],
  default_level: 'medium',
  wire_shape: 'openai_responses_reasoning_effort',
  disable_shape: 'openai_reasoning_effort_none',
  response_reasoning_fields: ['completion_tokens_details.reasoning_tokens'],
  source_urls: [
    'https://developers.openai.com/api/docs/models/gpt-5.2-pro',
    'https://developers.openai.com/api/docs/guides/reasoning',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'openai_gpt_52_pro_reasoning_effort',
} as const;

const OPENAI_GPT_5_REASONING = {
  kind: 'effort',
  supported_levels: ['minimal', 'low', 'medium', 'high'],
  default_level: 'medium',
  wire_shape: 'openai_responses_reasoning_effort',
  disable_shape: 'openai_reasoning_effort_none',
  response_reasoning_fields: ['completion_tokens_details.reasoning_tokens'],
  source_urls: [
    'https://developers.openai.com/api/docs/guides/reasoning',
    'https://developers.openai.com/api/docs/models/gpt-5',
    'https://developers.openai.com/api/docs/models/gpt-5-mini',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'openai_gpt_5_reasoning_effort',
} as const;

const ANTHROPIC_OPUS_REASONING = {
  kind: 'effort',
  supported_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  default_level: 'off',
  disable_supported: true,
  wire_shape: 'anthropic_output_config_effort',
  disable_shape: 'anthropic_thinking_disabled',
  source_urls: [
    'https://platform.claude.com/docs/en/build-with-claude/effort',
    'https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking',
    'https://platform.claude.com/docs/en/api/messages/create',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'anthropic_opus_47_adaptive_effort',
} as const;

const ANTHROPIC_SONNET_REASONING = {
  kind: 'effort_budget',
  supported_levels: ['low', 'medium', 'high', 'max'],
  default_level: 'high',
  disable_supported: true,
  wire_shape: 'anthropic_output_config_effort',
  disable_shape: 'anthropic_thinking_disabled',
  budget_shape: 'anthropic_thinking_budget',
  min_budget_tokens: 1024,
  source_urls: [
    'https://platform.claude.com/docs/en/build-with-claude/effort',
    'https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking',
    'https://platform.claude.com/docs/en/api/messages/create',
    'https://platform.claude.com/docs/en/about-claude/models/migration-guide',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'anthropic_sonnet_46_adaptive_effort_budget',
} as const;

const KIMI_TOGGLE_REASONING = {
  kind: 'toggle',
  default_level: 'default',
  disable_supported: true,
  default_enabled: true,
  wire_shape: 'kimi_thinking_type',
  disable_shape: 'kimi_thinking_disabled',
  response_reasoning_fields: ['reasoning_content'],
  history_replay_requirements: ['reasoning_content'],
  source_urls: [
    'https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart',
    'https://platform.moonshot.cn/docs/guide/use-kimi-k2-thinking-model',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'kimi_thinking_type',
} as const;

const GLM_TOGGLE_REASONING = {
  kind: 'toggle',
  default_level: 'default',
  disable_supported: true,
  default_enabled: true,
  wire_shape: 'glm_thinking_type',
  disable_shape: 'glm_thinking_disabled',
  source_urls: [
    'https://docs.z.ai/guides/capabilities/thinking',
    'https://docs.z.ai/api-reference/llm/chat-completion',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'glm_thinking_type',
} as const;

const GLM_EFFORT_REASONING = {
  kind: 'effort',
  supported_levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  default_level: 'default',
  disable_supported: true,
  wire_shape: 'glm_reasoning_effort',
  disable_shape: 'glm_reasoning_effort_none',
  response_reasoning_fields: ['reasoning_content', 'completion_tokens_details.reasoning_tokens'],
  history_replay_requirements: ['reasoning_content'],
  source_urls: [
    'https://docs.z.ai/guides/capabilities/thinking',
    'https://docs.z.ai/api-reference/llm/chat-completion',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'glm_reasoning_effort',
} as const;

const DEEPSEEK_REASONING = {
  kind: 'effort',
  supported_levels: ['high', 'max'],
  default_level: 'high',
  disable_supported: true,
  wire_shape: 'deepseek_reasoning_effort',
  disable_shape: 'deepseek_thinking_disabled',
  response_reasoning_fields: ['reasoning_content', 'completion_tokens_details.reasoning_tokens'],
  history_replay_requirements: ['reasoning_content'],
  source_urls: [
    'https://api-docs.deepseek.com/api/create-chat-completion',
    'https://api-docs.deepseek.com/guides/thinking_mode',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'deepseek_reasoning_effort',
} as const;

const QWEN_REASONING = {
  kind: 'toggle_budget',
  default_level: 'default',
  disable_supported: true,
  default_enabled: true,
  wire_shape: 'qwen_enable_thinking',
  disable_shape: 'qwen_enable_thinking_false',
  budget_shape: 'qwen_thinking_budget',
  response_reasoning_fields: ['reasoning_content', 'completion_tokens_details.reasoning_tokens'],
  history_replay_requirements: ['reasoning_content', 'preserve_thinking'],
  source_urls: [
    'https://help.aliyun.com/zh/model-studio/deep-thinking',
    'https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope',
    'https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'qwen_enable_thinking_budget',
} as const;

const OPENROUTER_DYNAMIC_REASONING = {
  kind: 'dynamic',
  dynamic_provider_metadata: true,
  wire_shape: 'openrouter_reasoning_metadata',
  source_urls: [
    'https://openrouter.ai/docs/api-reference/parameters',
    'https://openrouter.ai/docs/guides/best-practices/reasoning-tokens',
    'https://openrouter.ai/api/v1/models',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'openrouter_model_reasoning_metadata',
} as const;

const XAI_REASONING = {
  kind: 'effort',
  supported_levels: ['low', 'medium', 'high'],
  default_level: 'low',
  disable_supported: true,
  wire_shape: 'xai_reasoning_effort',
  disable_shape: 'xai_reasoning_effort_none',
  source_urls: ['https://docs.x.ai/developers/model-capabilities/text/reasoning'],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'xai_grok_4_3_reasoning_effort',
} as const;

const GROQ_QWEN_REASONING = {
  kind: 'effort',
  default_level: 'default',
  disable_supported: true,
  wire_shape: 'groq_qwen_reasoning_effort',
  disable_shape: 'groq_reasoning_none',
  source_urls: [
    'https://console.groq.com/docs/reasoning',
    'https://console.groq.com/docs/api-reference',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'groq_qwen_reasoning_default',
} as const;

const GROQ_GPT_OSS_REASONING = {
  kind: 'effort',
  supported_levels: ['low', 'medium', 'high'],
  default_level: 'medium',
  wire_shape: 'groq_gpt_oss_reasoning_effort',
  source_urls: [
    'https://console.groq.com/docs/reasoning',
    'https://console.groq.com/docs/api-reference',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'groq_gpt_oss_reasoning_effort',
} as const;

const OLLAMA_DYNAMIC_REASONING = {
  kind: 'dynamic',
  dynamic_provider_metadata: true,
  wire_shape: 'ollama_model_family_think',
  source_urls: [
    'https://docs.ollama.com/capabilities/thinking',
    'https://docs.ollama.com/api/chat',
  ],
  source_checked_at: SOURCE_CHECKED_AT,
  fixture: 'ollama_model_family_think',
} as const;

export const FLOWER_PROVIDER_TYPES: readonly { value: FlowerProviderType; label: string; hint: string }[] = [
  { value: 'openai', label: 'OpenAI', hint: 'Native connection' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Native connection' },
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
  openai: {
    type: 'openai',
    name: 'OpenAI',
    default_base_url: 'https://api.openai.com/v1',
    models: [
      { model_name: 'gpt-5.5', context_window: 1_050_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_55_REASONING, default_reasoning_selection: { level: 'medium' }, note_key: 'openai_gpt_55_frontier' },
      { model_name: 'gpt-5.4', context_window: 1_050_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_54_REASONING, default_reasoning_selection: { level: 'off' }, note_key: 'openai_gpt_54_professional' },
      { model_name: 'gpt-5.4-mini', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_54_MINI_REASONING, default_reasoning_selection: { level: 'off' }, note_key: 'openai_gpt_54_mini' },
      { model_name: 'gpt-5.4-nano', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_54_NANO_REASONING, default_reasoning_selection: { level: 'off' }, note_key: 'openai_gpt_54_nano' },
      { model_name: 'gpt-5.2', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_52_REASONING, default_reasoning_selection: { level: 'off' }, note_key: 'openai_gpt_52_previous_flagship' },
      { model_name: 'gpt-5.2-mini', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_52_REASONING, default_reasoning_selection: { level: 'off' }, note_key: 'openai_gpt_52_mini' },
      { model_name: 'gpt-5.2-codex', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_52_CODEX_REASONING, default_reasoning_selection: { level: 'medium' }, note_key: 'openai_gpt_52_previous_flagship' },
      { model_name: 'gpt-5.2-pro', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_52_PRO_REASONING, default_reasoning_selection: { level: 'medium' }, note_key: 'openai_gpt_52_previous_flagship' },
      { model_name: 'gpt-5', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_5_REASONING, default_reasoning_selection: { level: 'medium' }, note_key: 'openai_gpt_5_stable' },
      { model_name: 'gpt-5-mini', context_window: 400_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: OPENAI_GPT_5_REASONING, default_reasoning_selection: { level: 'medium' }, note_key: 'openai_gpt_5_mini' },
    ],
  },
  anthropic: {
    type: 'anthropic',
    name: 'Anthropic',
    default_base_url: 'https://api.anthropic.com/v1',
    models: [
      { model_name: 'claude-opus-4-7', context_window: 1_000_000, max_output_tokens: 128_000, input_modalities: VISION_MODALITIES, reasoning_capability: ANTHROPIC_OPUS_REASONING, default_reasoning_selection: { level: 'off' }, note_key: 'claude_opus_47_note' },
      { model_name: 'claude-sonnet-4-6', context_window: 1_000_000, max_output_tokens: 64_000, input_modalities: VISION_MODALITIES, reasoning_capability: ANTHROPIC_SONNET_REASONING, default_reasoning_selection: { level: 'high' }, note_key: 'anthropic_sonnet_46' },
      { model_name: 'claude-haiku-4-5-20251001', context_window: 200_000, max_output_tokens: 64_000, input_modalities: VISION_MODALITIES, note_key: 'claude_haiku_45_note' },
    ],
  },
  moonshot: {
    type: 'moonshot',
    name: 'Moonshot',
    default_base_url: 'https://api.moonshot.cn/v1',
    models: [
      { model_name: 'kimi-k2.6', context_window: 256_000, max_output_tokens: 96_000, input_modalities: TEXT_MODALITIES, reasoning_capability: KIMI_TOGGLE_REASONING, default_reasoning_selection: { level: 'default' }, note_key: 'moonshot_kimi_k26' },
    ],
  },
  chatglm: {
    type: 'chatglm',
    name: 'ChatGLM',
    default_base_url: 'https://api.z.ai/api/paas/v4/',
    models: [
      { model_name: 'glm-5.2', context_window: 200_000, max_output_tokens: 128_000, input_modalities: TEXT_MODALITIES, reasoning_capability: GLM_EFFORT_REASONING, default_reasoning_selection: { level: 'default' }, note_key: 'chatglm_glm_51' },
      { model_name: 'glm-5.1', context_window: 200_000, max_output_tokens: 128_000, input_modalities: TEXT_MODALITIES, reasoning_capability: GLM_TOGGLE_REASONING, default_reasoning_selection: { level: 'default' }, note_key: 'chatglm_glm_51' },
    ],
  },
  deepseek: {
    type: 'deepseek',
    name: 'DeepSeek',
    default_base_url: 'https://api.deepseek.com',
    models: [
      { model_name: 'deepseek-v4-pro', context_window: 1_000_000, max_output_tokens: 384_000, input_modalities: TEXT_MODALITIES, reasoning_capability: DEEPSEEK_REASONING, default_reasoning_selection: { level: 'high' }, note_key: 'deepseek_v4_pro' },
      { model_name: 'deepseek-v4-flash', context_window: 1_000_000, max_output_tokens: 384_000, input_modalities: TEXT_MODALITIES, reasoning_capability: DEEPSEEK_REASONING, default_reasoning_selection: { level: 'high' }, note_key: 'deepseek_v4_flash' },
    ],
  },
  qwen: {
    type: 'qwen',
    name: 'Qwen',
    default_base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: [
      { model_name: 'qwen3.6-plus', context_window: 1_000_000, max_output_tokens: 65_536, input_modalities: TEXT_MODALITIES, reasoning_capability: QWEN_REASONING, default_reasoning_selection: { level: 'default' }, note_key: 'qwen36_plus' },
      { model_name: 'qwen3.6-plus-2026-04-02', context_window: 1_000_000, max_output_tokens: 65_536, input_modalities: TEXT_MODALITIES, reasoning_capability: QWEN_REASONING, default_reasoning_selection: { level: 'default' }, note_key: 'qwen36_plus_snapshot' },
      { model_name: 'qwen3.6-flash', context_window: 1_000_000, max_output_tokens: 65_536, input_modalities: TEXT_MODALITIES, reasoning_capability: QWEN_REASONING, default_reasoning_selection: { level: 'default' }, note_key: 'qwen36_flash' },
      { model_name: 'qwen3.6-flash-2026-04-16', context_window: 1_000_000, max_output_tokens: 65_536, input_modalities: TEXT_MODALITIES, reasoning_capability: QWEN_REASONING, default_reasoning_selection: { level: 'default' }, note_key: 'qwen36_flash_snapshot' },
    ],
  },
  openrouter: {
    type: 'openrouter',
    name: 'OpenRouter',
    default_base_url: 'https://openrouter.ai/api/v1',
    models: [
      { model_name: 'gpt-oss-120b', context_window: 128_000, max_output_tokens: 32_768, input_modalities: TEXT_MODALITIES, reasoning_capability: OPENROUTER_DYNAMIC_REASONING, note_key: 'openrouter_dynamic_metadata' },
    ],
  },
  xai: {
    type: 'xai',
    name: 'xAI',
    default_base_url: 'https://api.x.ai/v1',
    models: [
      { model_name: 'grok-4.3', context_window: 256_000, max_output_tokens: 65_536, input_modalities: TEXT_MODALITIES, reasoning_capability: XAI_REASONING, default_reasoning_selection: { level: 'low' }, note_key: 'xai_grok_43' },
    ],
  },
  groq: {
    type: 'groq',
    name: 'Groq',
    default_base_url: 'https://api.groq.com/openai/v1',
    models: [
      { model_name: 'qwen3-32b', wire_model_name: 'qwen/qwen3-32b', context_window: 131_072, max_output_tokens: 32_768, input_modalities: TEXT_MODALITIES, reasoning_capability: GROQ_QWEN_REASONING, default_reasoning_selection: { level: 'default' }, note_key: 'groq_qwen_reasoning' },
      { model_name: 'gpt-oss-120b', wire_model_name: 'openai/gpt-oss-120b', context_window: 131_072, max_output_tokens: 32_768, input_modalities: TEXT_MODALITIES, reasoning_capability: GROQ_GPT_OSS_REASONING, default_reasoning_selection: { level: 'medium' }, note_key: 'groq_gpt_oss' },
    ],
  },
  ollama: {
    type: 'ollama',
    name: 'Ollama',
    default_base_url: 'http://127.0.0.1:11434/v1',
    models: [
      { model_name: 'gpt-oss', context_window: 128_000, max_output_tokens: 32_768, input_modalities: TEXT_MODALITIES, reasoning_capability: OLLAMA_DYNAMIC_REASONING, note_key: 'ollama_local_reasoning_metadata' },
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
  return type === 'moonshot' || type === 'chatglm' || type === 'deepseek' || type === 'qwen' || type === 'openrouter' || type === 'xai' || type === 'groq' || type === 'ollama' || type === 'openai_compatible';
}

export function flowerProviderUsesCustomName(type: FlowerProviderType): boolean {
  return type === 'openrouter' || type === 'xai' || type === 'groq' || type === 'ollama' || type === 'openai_compatible';
}

export function flowerProviderSupportsCustomModels(type: FlowerProviderType): boolean {
  return type === 'openai' || type === 'anthropic' || type === 'openrouter' || type === 'xai' || type === 'groq' || type === 'ollama' || type === 'openai_compatible';
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
