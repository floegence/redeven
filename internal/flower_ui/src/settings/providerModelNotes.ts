export const FLOWER_PROVIDER_MODEL_NOTE_KEYS = [
  'openai_gpt_55_frontier',
  'openai_gpt_54_professional',
  'openai_gpt_54_mini',
  'openai_gpt_54_nano',
  'openai_gpt_52_previous_flagship',
  'openai_gpt_52_mini',
  'openai_gpt_5_stable',
  'openai_gpt_5_mini',
  'claude_opus_47_note',
  'anthropic_sonnet_46',
  'claude_haiku_45_note',
  'moonshot_kimi_k26',
  'chatglm_glm_51',
  'deepseek_v4_pro',
  'deepseek_v4_flash',
  'qwen36_plus',
  'qwen36_plus_snapshot',
  'qwen36_flash',
  'qwen36_flash_snapshot',
  'openrouter_dynamic_metadata',
  'xai_grok_43',
  'groq_qwen_reasoning',
  'groq_gpt_oss',
  'ollama_local_reasoning_metadata',
] as const;

export type FlowerProviderModelNoteKey = typeof FLOWER_PROVIDER_MODEL_NOTE_KEYS[number];

const EN_US_MODEL_NOTES: Readonly<Record<FlowerProviderModelNoteKey, string>> = {
  openai_gpt_55_frontier: 'Latest frontier model for complex reasoning and coding',
  openai_gpt_54_professional: 'Affordable frontier model for professional work',
  openai_gpt_54_mini: 'Fast, cost-effective GPT-5.4 variant',
  openai_gpt_54_nano: 'Low-cost option for simple high-volume tasks',
  openai_gpt_52_previous_flagship: 'Previous flagship model',
  openai_gpt_52_mini: 'Cost-effective flagship variant',
  openai_gpt_5_stable: 'Stable flagship',
  openai_gpt_5_mini: 'Stable lightweight option',
  claude_opus_47_note: 'Most capable Claude model for complex agentic coding',
  anthropic_sonnet_46: 'Best balance of speed and intelligence',
  claude_haiku_45_note: 'Fastest current Claude model',
  moonshot_kimi_k26: 'Current Kimi flagship with built-in web search',
  chatglm_glm_51: 'Current GLM flagship with built-in web search',
  deepseek_v4_pro: 'Current V4 flagship model',
  deepseek_v4_flash: 'Current V4 fast model',
  qwen36_plus: 'Current Qwen3.6 Plus with built-in web search',
  qwen36_plus_snapshot: 'Pinned Qwen3.6 Plus snapshot with built-in web search',
  qwen36_flash: 'Current Qwen3.6 Flash with built-in web search',
  qwen36_flash_snapshot: 'Pinned Qwen3.6 Flash snapshot with built-in web search',
  openrouter_dynamic_metadata: 'Uses OpenRouter model metadata for reasoning controls',
  xai_grok_43: 'xAI Grok model with official reasoning effort controls',
  groq_qwen_reasoning: 'Groq Qwen reasoning model with default/off reasoning',
  groq_gpt_oss: 'Groq GPT-OSS model with low, medium, and high reasoning',
  ollama_local_reasoning_metadata: 'Local Ollama model family with dynamic thinking support',
};

const ZH_CN_MODEL_NOTES: Readonly<Record<FlowerProviderModelNoteKey, string>> = {
  openai_gpt_55_frontier: '适合复杂推理和代码任务的最新前沿 model',
  openai_gpt_54_professional: '适合专业工作的高性价比前沿 model',
  openai_gpt_54_mini: '快速且成本友好的 GPT-5.4 变体',
  openai_gpt_54_nano: '适合简单高频任务的低成本选项',
  openai_gpt_52_previous_flagship: '上一代旗舰 model',
  openai_gpt_52_mini: '高性价比旗舰变体',
  openai_gpt_5_stable: '稳定旗舰 model',
  openai_gpt_5_mini: '稳定轻量选项',
  claude_opus_47_note: '适合复杂 agentic coding 的最强 Claude model',
  anthropic_sonnet_46: '速度与智能平衡最佳',
  claude_haiku_45_note: '当前最快的 Claude model',
  moonshot_kimi_k26: '内置 web search 的当前 Kimi 旗舰',
  chatglm_glm_51: '内置 web search 的当前 GLM 旗舰',
  deepseek_v4_pro: '当前 V4 旗舰 model',
  deepseek_v4_flash: '当前 V4 快速 model',
  qwen36_plus: '内置 web search 的当前 Qwen3.6 Plus',
  qwen36_plus_snapshot: '内置 web search 的 Qwen3.6 Plus 固定快照',
  qwen36_flash: '内置 web search 的当前 Qwen3.6 Flash',
  qwen36_flash_snapshot: '内置 web search 的 Qwen3.6 Flash 固定快照',
  openrouter_dynamic_metadata: '使用 OpenRouter model metadata 展示 reasoning 控制',
  xai_grok_43: '支持官方 reasoning effort 控制的 xAI Grok model',
  groq_qwen_reasoning: '支持 default/off reasoning 的 Groq Qwen reasoning model',
  groq_gpt_oss: '支持 low、medium、high reasoning 的 Groq GPT-OSS model',
  ollama_local_reasoning_metadata: '通过动态 thinking 支持识别的本地 Ollama model family',
};

const ZH_TW_MODEL_NOTES: Readonly<Record<FlowerProviderModelNoteKey, string>> = {
  openai_gpt_55_frontier: '適合複雜推理和程式碼任務的最新前沿 model',
  openai_gpt_54_professional: '適合專業工作的高性價比前沿 model',
  openai_gpt_54_mini: '快速且成本友善的 GPT-5.4 變體',
  openai_gpt_54_nano: '適合簡單高頻任務的低成本選項',
  openai_gpt_52_previous_flagship: '上一代旗艦 model',
  openai_gpt_52_mini: '高性價比旗艦變體',
  openai_gpt_5_stable: '穩定旗艦 model',
  openai_gpt_5_mini: '穩定輕量選項',
  claude_opus_47_note: '適合複雜 agentic coding 的最強 Claude model',
  anthropic_sonnet_46: '速度與智慧平衡最佳',
  claude_haiku_45_note: '目前最快的 Claude model',
  moonshot_kimi_k26: '內建 web search 的目前 Kimi 旗艦',
  chatglm_glm_51: '內建 web search 的目前 GLM 旗艦',
  deepseek_v4_pro: '目前 V4 旗艦 model',
  deepseek_v4_flash: '目前 V4 快速 model',
  qwen36_plus: '內建 web search 的目前 Qwen3.6 Plus',
  qwen36_plus_snapshot: '內建 web search 的 Qwen3.6 Plus 固定快照',
  qwen36_flash: '內建 web search 的目前 Qwen3.6 Flash',
  qwen36_flash_snapshot: '內建 web search 的 Qwen3.6 Flash 固定快照',
  openrouter_dynamic_metadata: '使用 OpenRouter model metadata 顯示 reasoning 控制',
  xai_grok_43: '支援官方 reasoning effort 控制的 xAI Grok model',
  groq_qwen_reasoning: '支援 default/off reasoning 的 Groq Qwen reasoning model',
  groq_gpt_oss: '支援 low、medium、high reasoning 的 Groq GPT-OSS model',
  ollama_local_reasoning_metadata: '透過動態 thinking 支援識別的本機 Ollama model family',
};

function modelNotesForLocale(locale: string | undefined): Readonly<Record<FlowerProviderModelNoteKey, string>> {
  const normalized = String(locale ?? '').toLowerCase();
  if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hant') || normalized.startsWith('zh-hk')) return ZH_TW_MODEL_NOTES;
  if (normalized.startsWith('zh')) return ZH_CN_MODEL_NOTES;
  return EN_US_MODEL_NOTES;
}

export function localizedFlowerProviderModelNote(
  locale: string | undefined,
  noteKey: FlowerProviderModelNoteKey | undefined,
): string {
  if (!noteKey) return '';
  return modelNotesForLocale(locale)[noteKey] ?? EN_US_MODEL_NOTES[noteKey] ?? '';
}
