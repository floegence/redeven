import type { FlowerProviderType } from '../contracts/flowerSurfaceContracts';

export type FlowerProviderIconDefinition = Readonly<{
  title: string;
  src: string;
  monochrome: boolean;
}>;

// Exact theSVG assets, pinned and audited in assets/flower_provider_icons.json.
// Static URLs let both Vite carriers bundle the same marks for offline use.
const OPENAI_ICON: FlowerProviderIconDefinition = {
  title: 'OpenAI', src: new URL('../assets/provider-icons/openai.svg?inline', import.meta.url).href, monochrome: true,
};
const KIMI_ICON: FlowerProviderIconDefinition = {
  title: 'Kimi', src: new URL('../assets/provider-icons/kimi.svg?inline', import.meta.url).href, monochrome: false,
};

export const FLOWER_PROVIDER_ICON_DEFINITIONS: Record<FlowerProviderType, FlowerProviderIconDefinition> = {
  openai: OPENAI_ICON,
  anthropic: { title: 'Anthropic', src: new URL('../assets/provider-icons/anthropic.svg?inline', import.meta.url).href, monochrome: true },
  google: { title: 'Gemini', src: new URL('../assets/provider-icons/gemini.svg?inline', import.meta.url).href, monochrome: false },
  kimi_code: KIMI_ICON,
  moonshot: KIMI_ICON,
  chatglm: { title: 'Z.ai', src: new URL('../assets/provider-icons/zdotai.svg?inline', import.meta.url).href, monochrome: true },
  deepseek: { title: 'DeepSeek', src: new URL('../assets/provider-icons/deepseek.svg?inline', import.meta.url).href, monochrome: false },
  qwen: { title: 'Qwen', src: new URL('../assets/provider-icons/qwen.svg?inline', import.meta.url).href, monochrome: true },
  openrouter: { title: 'OpenRouter', src: new URL('../assets/provider-icons/openrouter.svg?inline', import.meta.url).href, monochrome: true },
  xai: { title: 'xAI', src: new URL('../assets/provider-icons/xai.svg?inline', import.meta.url).href, monochrome: true },
  groq: { title: 'Groq', src: new URL('../assets/provider-icons/groq.svg?inline', import.meta.url).href, monochrome: false },
  ollama: { title: 'Ollama', src: new URL('../assets/provider-icons/ollama.svg?inline', import.meta.url).href, monochrome: true },
  openai_compatible: { ...OPENAI_ICON, title: 'OpenAI-compatible' },
};
